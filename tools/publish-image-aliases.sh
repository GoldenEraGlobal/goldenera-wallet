#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=release-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-common.sh"

require_release_env API_URL COMMIT_SHA CONSUMED_RELEASE_VERSION GH_TOKEN GITHUB_OUTPUT IMAGE IMAGE_NAME JAR_SHA256 MODE REGISTRY_HOST REGISTRY_USER REPOSITORY RUNNER_TEMP

response_header() {
  python3 - "$1" "$2" <<'PY'
from pathlib import Path
import sys

wanted = sys.argv[2].lower()
value = None
for line in Path(sys.argv[1]).read_text(errors='replace').splitlines():
    name, separator, candidate = line.partition(':')
    if separator and name.strip().lower() == wanted:
        value = candidate.strip()
if value is None:
    raise SystemExit(1)
print(value)
PY
}

assert_package_write_identity() {
  case "$MODE" in
    default)
      assert_current_default_head
      ;;
    dev)
      assert_current_source_branch_head
      ;;
    version)
      assert_version_publication_ready
      ;;
    *)
      echo 'A non-publishing mode reached a registry write boundary.' >&2
      return 1
      ;;
  esac
}

put_manifest() {
  local reference="$1" body="$2" prefix="$3"
  local -a arguments
  # Every registry PUT rechecks the observable Git ref, default-branch ancestry,
  # and (for versions) tag ruleset immediately before sending bytes.
  assert_package_write_identity || return 1
  arguments=(
    --silent --show-error
    --request PUT
    --header "Authorization: Bearer $registry_token"
    --header 'Content-Type: application/vnd.oci.image.index.v1+json'
    --data-binary "@$body"
    --dump-header "$prefix.headers"
    --output "$prefix.body"
    --write-out '%{http_code}'
  )
  curl "${arguments[@]}" "https://$REGISTRY_HOST/v2/$IMAGE_NAME/manifests/$reference"
}

fetch_manifest_reference() {
  local reference="$1" prefix="$2"
  curl --silent --show-error \
    --header "Authorization: Bearer $registry_token" \
    --header 'Accept: application/vnd.oci.image.index.v1+json' \
    --dump-header "$prefix.headers" \
    --output "$prefix.body" \
    --write-out '%{http_code}' \
    "https://$REGISTRY_HOST/v2/$IMAGE_NAME/manifests/$reference"
}

verify_attested_index() {
  local index="$1" prefix="$2" expected_image attestation_digest descriptor_size
  local attestation_manifest attestation_prefix status actual_header actual_bytes predicate_type layer_digest statement
  jq -e \
    --arg amd64 "$amd64_image_digest" \
    --arg arm64 "$arm64_image_digest" '
      .schemaVersion == 2 and
      .mediaType == "application/vnd.oci.image.index.v1+json" and
      (.manifests | length) == 4 and
      ([.manifests[] | select(.platform.os == "linux") |
          {digest, os: .platform.os, architecture: .platform.architecture, mediaType}] | sort_by(.architecture)) ==
        ([
          {digest: $amd64, os: "linux", architecture: "amd64", mediaType: "application/vnd.oci.image.manifest.v1+json"},
          {digest: $arm64, os: "linux", architecture: "arm64", mediaType: "application/vnd.oci.image.manifest.v1+json"}
        ] | sort_by(.architecture)) and
      ([.manifests[] | select(
          .platform.os == "unknown" and
          .platform.architecture == "unknown" and
          .mediaType == "application/vnd.oci.image.manifest.v1+json" and
          .annotations["vnd.docker.reference.type"] == "attestation-manifest"
        ) | .annotations["vnd.docker.reference.digest"]] | sort) == ([$amd64, $arm64] | sort) and
      all(.manifests[];
        (.digest | test("^sha256:[0-9a-f]{64}$")) and
        (.size | type == "number" and . > 0))
    ' "$index" > /dev/null || {
      echo 'Final image index does not contain exactly two expected runnable manifests and their two linked attestation manifests.' >&2
      exit 1
    }

  for expected_image in "$amd64_image_digest" "$arm64_image_digest"; do
    IFS=$'\t' read -r attestation_digest descriptor_size < <(
      jq -er --arg image "$expected_image" '
        .manifests[] |
        select(
          .platform.os == "unknown" and
          .platform.architecture == "unknown" and
          .annotations["vnd.docker.reference.type"] == "attestation-manifest" and
          .annotations["vnd.docker.reference.digest"] == $image
        ) |
        [.digest, (.size | tostring)] | @tsv
      ' "$index"
    )
    attestation_prefix="$prefix-${attestation_digest#sha256:}"
    attestation_manifest="$attestation_prefix.manifest"
    status="$(curl --silent --show-error \
      --header "Authorization: Bearer $registry_token" \
      --header 'Accept: application/vnd.oci.image.manifest.v1+json' \
      --dump-header "$attestation_prefix.headers" \
      --output "$attestation_manifest" \
      --write-out '%{http_code}' \
      "https://$REGISTRY_HOST/v2/$IMAGE_NAME/manifests/$attestation_digest")"
    [[ "$status" == '200' ]] || {
      echo "Unable to fetch linked attestation manifest $attestation_digest (HTTP $status)." >&2
      exit 1
    }
    actual_header="$(response_header "$attestation_prefix.headers" 'Docker-Content-Digest')"
    actual_bytes="sha256:$(sha256sum "$attestation_manifest" | awk '{print $1}')"
    [[ "$actual_header" == "$attestation_digest" && "$actual_bytes" == "$attestation_digest" ]] || {
      echo 'Linked attestation manifest digest verification failed.' >&2
      exit 1
    }
    [[ "$(stat --format='%s' "$attestation_manifest")" == "$descriptor_size" ]] || {
      echo 'Linked attestation descriptor size does not match its manifest bytes.' >&2
      exit 1
    }
    jq -e '
      .schemaVersion == 2 and
      .mediaType == "application/vnd.oci.image.manifest.v1+json" and
      (.layers | length) == 2 and
      all(.layers[];
        .mediaType == "application/vnd.in-toto+json" and
        (.digest | test("^sha256:[0-9a-f]{64}$"))) and
      ([.layers[].annotations["in-toto.io/predicate-type"]] | sort) ==
        ["https://slsa.dev/provenance/v1", "https://spdx.dev/Document"]
    ' "$attestation_manifest" > /dev/null || {
      echo 'Linked attestation manifest lacks the exact provenance and SPDX SBOM layer set.' >&2
      exit 1
    }

    while IFS=$'\t' read -r predicate_type layer_digest; do
      statement="$RUNNER_TEMP/final-attestation-${layer_digest#sha256:}.json"
      curl --fail --location --proto '=https' --proto-redir '=https' --silent --show-error --retry 3 \
        --header "Authorization: Bearer $registry_token" \
        "https://$REGISTRY_HOST/v2/$IMAGE_NAME/blobs/$layer_digest" > "$statement"
      [[ "$(sha256sum "$statement" | awk '{print $1}')" == "${layer_digest#sha256:}" ]] || {
        echo 'Final attestation statement digest verification failed.' >&2
        exit 1
      }
      jq -e --arg predicate "$predicate_type" --arg subject "${expected_image#sha256:}" '
        .predicateType == $predicate and
        any(.subject[]?; .digest.sha256 == $subject)
      ' "$statement" > /dev/null || {
        echo 'Final attestation statement is not linked to its expected runnable manifest.' >&2
        exit 1
      }
    done < <(jq -r '.layers[] | [.annotations["in-toto.io/predicate-type"], .digest] | @tsv' "$attestation_manifest")
  done
}

inspect_existing_stable_alias() {
  local alias="$1" prefix status actual_header actual_bytes
  prefix="$RUNNER_TEMP/existing-${alias//[^A-Za-z0-9_.-]/_}"
  status="$(fetch_manifest_reference "$alias" "$prefix")"
  if [[ "$status" == '404' ]]; then
    return 1
  fi
  [[ "$status" == '200' ]] || {
    echo "Unable to inspect stable image alias $IMAGE:$alias (HTTP $status)." >&2
    exit 1
  }
  actual_header="$(response_header "$prefix.headers" 'Docker-Content-Digest')"
  actual_bytes="sha256:$(sha256sum "$prefix.body" | awk '{print $1}')"
  [[ "$actual_header" =~ ^sha256:[0-9a-f]{64}$ && "$actual_bytes" == "$actual_header" ]] || {
    echo "Stable image alias $IMAGE:$alias returned inconsistent manifest identity." >&2
    exit 1
  }
  verify_attested_index "$prefix.body" "$prefix-verify"
  existing_manifest_file="$prefix.body"
  existing_manifest_digest="$actual_header"
}

adopt_existing_manifest() {
  local alias="$1"
  if [[ -z "$selected_manifest_digest" ]]; then
    cp -- "$existing_manifest_file" "$selected_manifest"
    selected_manifest_digest="$existing_manifest_digest"
  else
    [[ "$existing_manifest_digest" == "$selected_manifest_digest" ]] && cmp -s -- "$existing_manifest_file" "$selected_manifest" || {
      echo "Stable image alias $IMAGE:$alias conflicts with the other stable alias for this release." >&2
      exit 1
    }
  fi
  echo "Verified existing stable image alias for exact-state recovery: $IMAGE:$alias"
}

verify_manifest_reference() {
  local reference="$1" prefix="$2" status actual_header actual_bytes
  status="$(fetch_manifest_reference "$reference" "$prefix")"
  [[ "$status" == '200' ]] || {
    echo "Unable to verify manifest reference $reference (HTTP $status)." >&2
    exit 1
  }
  actual_header="$(response_header "$prefix.headers" 'Docker-Content-Digest')"
  actual_bytes="sha256:$(sha256sum "$prefix.body" | awk '{print $1}')"
  [[ "$actual_header" == "$manifest_digest" && "$actual_bytes" == "$manifest_digest" ]] && cmp -s -- "$prefix.body" "$final_manifest" || {
    echo "Manifest reference $reference conflicts with the verified image identity." >&2
    exit 1
  }
}

publish_stable_alias() {
  local alias="$1" already_exists="$2" prefix status
  [[ "$alias" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$ ]] || exit 1
  prefix="$RUNNER_TEMP/stable-${alias//[^A-Za-z0-9_.-]/_}"
  if [[ "$already_exists" == 'true' ]]; then
    verify_manifest_reference "$alias" "$prefix-existing-verify"
    echo "Verified existing stable image alias: $IMAGE:$alias"
    return
  fi
  status="$(put_manifest "$alias" "$final_manifest" "$prefix")"
  [[ "$status" == '201' ]] || {
    echo "Publishing stable image alias $IMAGE:$alias failed (HTTP $status)." >&2
    exit 1
  }
  verify_manifest_reference "$alias" "$prefix-verify"
  echo "Published stable image alias: $IMAGE:$alias"
}

publish_mutable_alias() {
  local alias="$1" prefix status
  [[ "$alias" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$ ]] || exit 1
  prefix="$RUNNER_TEMP/mutable-${alias//[^A-Za-z0-9_.-]/_}"
  status="$(put_manifest "$alias" "$final_manifest" "$prefix")"
  [[ "$status" == '201' ]] || {
    echo "Publishing mutable image alias $IMAGE:$alias failed (HTTP $status)." >&2
    exit 1
  }
  verify_manifest_reference "$alias" "$prefix-verify"
  echo "Published mutable image alias: $IMAGE:$alias"
}

metadata_dir="$RUNNER_TEMP/image-metadata"
mapfile -t metadata_files < <(find "$metadata_dir" -maxdepth 1 -type f -name '*.json' -printf '%f\n' | sort)
[[ "${metadata_files[*]}" == 'amd64.json arm64.json' ]] || {
  echo 'Expected exactly amd64.json and arm64.json platform metadata.' >&2
  exit 1
}

for architecture in amd64 arm64; do
  metadata="$metadata_dir/$architecture.json"
  jq -e \
    --arg architecture "$architecture" \
    --arg commit "$COMMIT_SHA" \
    --arg jar "$JAR_SHA256" '
      .os == "linux" and
      .architecture == $architecture and
      .commit_sha == $commit and
      .jar_sha256 == $jar and
      .provenance == true and
      .sbom == true and
      (.build_digest | test("^sha256:[0-9a-f]{64}$")) and
      (.image_digest | test("^sha256:[0-9a-f]{64}$")) and
      (.attestation_digest | test("^sha256:[0-9a-f]{64}$")) and
      .runnable_descriptor.digest == .image_digest and
      .runnable_descriptor.mediaType == "application/vnd.oci.image.manifest.v1+json" and
      .runnable_descriptor.platform == {os: "linux", architecture: $architecture} and
      (.runnable_descriptor.size | type == "number" and . > 0) and
      .attestation_descriptor.digest == .attestation_digest and
      .attestation_descriptor.mediaType == "application/vnd.oci.image.manifest.v1+json" and
      .attestation_descriptor.platform == {os: "unknown", architecture: "unknown"} and
      .attestation_descriptor.annotations["vnd.docker.reference.type"] == "attestation-manifest" and
      .attestation_descriptor.annotations["vnd.docker.reference.digest"] == .image_digest and
      (.attestation_descriptor.size | type == "number" and . > 0)
    ' "$metadata" > /dev/null || {
      echo "Platform metadata for $architecture is not the exact verified runnable/attestation descriptor pair." >&2
      exit 1
    }
done

amd64_image_digest="$(jq -er '.image_digest' "$metadata_dir/amd64.json")"
arm64_image_digest="$(jq -er '.image_digest' "$metadata_dir/arm64.json")"
[[ "$amd64_image_digest" != "$arm64_image_digest" ]] || {
  echo 'Platform image digests must be distinct.' >&2
  exit 1
}

new_manifest="$RUNNER_TEMP/new-final-image-index.json"
jq -S -c -n \
  --slurpfile amd64 "$metadata_dir/amd64.json" \
  --slurpfile arm64 "$metadata_dir/arm64.json" '
    {
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: [
        $amd64[0].runnable_descriptor,
        $amd64[0].attestation_descriptor,
        $arm64[0].runnable_descriptor,
        $arm64[0].attestation_descriptor
      ]
    }
  ' > "$new_manifest"

token_response="$RUNNER_TEMP/registry-push-token.json"
curl --fail --silent --show-error --retry 3 --get \
  --user "$REGISTRY_USER:$GH_TOKEN" \
  --data-urlencode "service=$REGISTRY_HOST" \
  --data-urlencode "scope=repository:$IMAGE_NAME:pull,push" \
  "https://$REGISTRY_HOST/token" > "$token_response"
registry_token="$(jq -er '.token // .access_token' "$token_response")"

selected_manifest="$RUNNER_TEMP/selected-final-image-index.json"
selected_manifest_digest=
existing_manifest_file=
existing_manifest_digest=
sha_alias_exists=false
version_alias_exists=false
case "$MODE" in
  default)
    require_release_env GRAPHQL_URL SOURCE_BRANCH
    if inspect_existing_stable_alias "sha-$COMMIT_SHA"; then
      sha_alias_exists=true
      adopt_existing_manifest "sha-$COMMIT_SHA"
    fi
    ;;
  dev)
    require_release_env GRAPHQL_URL SOURCE_BRANCH
    assert_current_source_branch_head
    if inspect_existing_stable_alias "sha-$COMMIT_SHA"; then
      sha_alias_exists=true
      adopt_existing_manifest "sha-$COMMIT_SHA"
    fi
    ;;
  version)
    require_release_env API_URL GRAPHQL_URL RELEASE_TAG VERSION
    assert_version_publication_ready
    if inspect_existing_stable_alias "sha-$COMMIT_SHA"; then
      sha_alias_exists=true
      adopt_existing_manifest "sha-$COMMIT_SHA"
    fi
    if inspect_existing_stable_alias "$VERSION"; then
      version_alias_exists=true
      adopt_existing_manifest "$VERSION"
    fi
    ;;
  *)
    echo 'Pull requests, manual runs, and stale branch runs must never publish.' >&2
    exit 1
    ;;
esac

if [[ -z "$selected_manifest_digest" ]]; then
  cp -- "$new_manifest" "$selected_manifest"
  selected_manifest_digest="sha256:$(sha256sum "$selected_manifest" | awk '{print $1}')"
fi
final_manifest="$selected_manifest"
manifest_digest="$selected_manifest_digest"
verify_attested_index "$final_manifest" "$RUNNER_TEMP/selected-final-verify"

# The first write addresses the manifest by its own digest. A registry
# can only accept these exact bytes at this reference, so this staging
# operation cannot move a tag or replace different content.
stage_prefix="$RUNNER_TEMP/content-addressed-stage"
stage_status="$(put_manifest "$manifest_digest" "$final_manifest" "$stage_prefix")"
[[ "$stage_status" == '201' ]] || {
  echo "Content-addressed manifest staging failed (HTTP $stage_status)." >&2
  exit 1
}
[[ "$(response_header "$stage_prefix.headers" 'Docker-Content-Digest')" == "$manifest_digest" ]] || {
  echo 'Registry returned the wrong digest for content-addressed staging.' >&2
  exit 1
}
verify_manifest_reference "$manifest_digest" "$RUNNER_TEMP/content-addressed-verify"

case "$MODE" in
  default)
    assert_current_default_head
    publish_stable_alias "sha-$COMMIT_SHA" "$sha_alias_exists"
    assert_current_default_head
    ;;
  dev)
    assert_current_source_branch_head
    publish_stable_alias "sha-$COMMIT_SHA" "$sha_alias_exists"
    assert_current_source_branch_head
    publish_mutable_alias "dev"
    assert_current_source_branch_head
    ;;
  version)
    assert_release_version_identity
    publish_stable_alias "sha-$COMMIT_SHA" "$sha_alias_exists"
    assert_release_version_identity
    # The put_manifest boundary guard repeats ruleset and identity verification
    # immediately before creating a missing stable alias.
    publish_stable_alias "$VERSION" "$version_alias_exists"
    assert_release_version_identity
    ;;
esac

{
  echo "amd64_image_digest=$amd64_image_digest"
  echo "arm64_image_digest=$arm64_image_digest"
  echo "manifest_digest=$manifest_digest"
} >> "$GITHUB_OUTPUT"
