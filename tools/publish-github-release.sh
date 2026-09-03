#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=release-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-common.sh"

require_release_env AMD64_IMAGE_DIGEST API_URL ARM64_IMAGE_DIGEST COMMIT_SHA CONSUMED_RELEASE_VERSION EXPECTED_SHA256 GH_TOKEN GRAPHQL_URL IMAGE JAR_NAME MANIFEST_DIGEST RELEASE_TAG REPOSITORY RUNNER_TEMP VERSION
assert_release_version_shape
for digest in "$AMD64_IMAGE_DIGEST" "$ARM64_IMAGE_DIGEST" "$MANIFEST_DIGEST"; do
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
done

assert_version_publication_ready
jar="$RUNNER_TEMP/wallet-release/$JAR_NAME"
[[ -f "$jar" && ! -L "$jar" ]] || {
  echo 'Verified release JAR is missing or is a symlink.' >&2
  exit 1
}
[[ "$(sha256sum "$jar" | awk '{print $1}')" == "$EXPECTED_SHA256" ]] || {
  echo 'Release JAR SHA-256 mismatch.' >&2
  exit 1
}
jar_size="$(stat --format '%s' "$jar")"
asset_label="GoldenEra Wallet $VERSION"

notes="$RUNNER_TEMP/release-notes.md"
printf '%s\n' \
  "Verified commit: \`$COMMIT_SHA\`" \
  "Verified production JAR SHA-256: \`$EXPECTED_SHA256\`" \
  '' \
  "Immutable multi-platform image: \`$IMAGE@$MANIFEST_DIGEST\`" \
  "Immutable aliases: \`$IMAGE:sha-$COMMIT_SHA\`, \`$IMAGE:$VERSION\`" \
  '' \
  "linux/amd64 runnable manifest: \`$AMD64_IMAGE_DIGEST\`" \
  "linux/arm64 runnable manifest: \`$ARM64_IMAGE_DIGEST\`" \
  '' \
  'BuildKit provenance and SPDX SBOM attestations were verified for both platform manifests.' > "$notes"

release_api="$API_URL/repos/$REPOSITORY/releases/tags/$RELEASE_TAG"
release_json="$RUNNER_TEMP/release.json"
release_state="$RUNNER_TEMP/release-state.json"
fetch_release() {
  local output="$1"
  curl --silent --show-error \
    --header "Authorization: Bearer $GH_TOKEN" \
    --header 'Accept: application/vnd.github+json' \
    --header 'X-GitHub-Api-Version: 2022-11-28' \
    --output "$output" \
    --write-out '%{http_code}' \
    "$release_api"
}

verify_release_state() {
  local release_json="$1" asset_kind asset_url downloaded
  python3 - "$release_json" "$notes" "$RELEASE_TAG" "$JAR_NAME" "$asset_label" "$jar_size" "$EXPECTED_SHA256" "$release_state" <<'PY' || return 1
import json
from pathlib import Path
import sys

release_path, notes_path, tag, asset_name, asset_label, asset_size, sha256, state_path = sys.argv[1:]
release = json.loads(Path(release_path).read_text())
expected_body = Path(notes_path).read_text()
assets = release.get('assets')
draft = release.get('draft')
checks = {
    'tag': release.get('tag_name') == tag,
    'title': release.get('name') == tag,
    'body': release.get('body') == expected_body,
    'draft boolean': isinstance(draft, bool),
    'prerelease state': release.get('prerelease') is False,
    'asset collection': isinstance(assets, list),
}
state = {
    'draft': draft,
    'asset_count': len(assets) if isinstance(assets, list) else -1,
    'asset_kind': 'invalid',
    'asset_id': None,
    'asset_url': None,
}
if isinstance(assets, list):
    checks['recoverable asset cardinality'] = len(assets) in (0, 1)
    if len(assets) == 0:
        state['asset_kind'] = 'none'
        checks['published release completeness'] = draft is True
    elif len(assets) == 1:
        asset = assets[0]
        asset_state = asset.get('state')
        common = {
            'asset name': asset.get('name') == asset_name,
            'asset label': asset.get('label') == asset_label,
            'asset ID': isinstance(asset.get('id'), int) and asset.get('id') > 0,
            'asset URL': isinstance(asset.get('url'), str) and bool(asset.get('url')),
        }
        checks.update(common)
        state.update({
            'asset_kind': asset_state,
            'asset_id': asset.get('id'),
            'asset_url': asset.get('url'),
        })
        if asset_state == 'uploaded':
            checks.update({
                'uploaded asset size': asset.get('size') == int(asset_size),
                'uploaded asset API digest': asset.get('digest') in (None, f'sha256:{sha256}'),
            })
            checks['published release completeness'] = True
        elif asset_state == 'starter':
            checks.update({
                'starter exists only in draft': draft is True,
                'starter has no bytes': asset.get('size') == 0,
                'starter has no digest': asset.get('digest') is None,
            })
            checks['published release completeness'] = draft is True
        else:
            checks['asset state'] = False
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit('Existing release conflicts in: ' + ', '.join(failed))
Path(state_path).write_text(json.dumps(state, sort_keys=True))
PY
  asset_kind="$(jq -er '.asset_kind' "$release_state")"
  if [[ "$asset_kind" == 'uploaded' ]]; then
    asset_url="$(jq -er '.asset_url' "$release_state")"
    downloaded="$RUNNER_TEMP/existing-release-asset.jar"
    curl --fail --silent --show-error --retry 3 --location \
      --header "Authorization: Bearer $GH_TOKEN" \
      --header 'Accept: application/octet-stream' \
      "$asset_url" > "$downloaded"
    [[ "$(sha256sum "$downloaded" | awk '{print $1}')" == "$EXPECTED_SHA256" ]] || {
      echo 'Existing release asset bytes conflict with the verified JAR digest.' >&2
      return 1
    }
  fi
}

status="$(fetch_release "$release_json")"
if [[ "$status" == '404' ]]; then
  assert_version_publication_ready
  create_error="$RUNNER_TEMP/release-create.err"
  if gh release create "$RELEASE_TAG" \
    --repo "$REPOSITORY" \
    --verify-tag \
    --target "$COMMIT_SHA" \
    --draft \
    --title "$RELEASE_TAG" \
    --notes-file "$notes" 2> "$create_error"; then
    create_status=0
  else
    create_status=$?
  fi
  for attempt in 1 2 3 4 5; do
    status="$(fetch_release "$release_json")"
    [[ "$status" == '200' ]] && break
    [[ "$attempt" -eq 5 ]] || sleep 2
  done
  if [[ "$status" != '200' ]]; then
    if [[ "$create_status" -ne 0 ]]; then
      while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$create_error"
    fi
    echo 'Draft release creation did not produce a recoverable exact release.' >&2
    exit 1
  fi
  verify_release_state "$release_json" || {
    echo 'A create race produced a conflicting release; it was not mutated.' >&2
    exit 1
  }
  assert_version_publication_ready
elif [[ "$status" == '200' ]]; then
  verify_release_state "$release_json" || {
    echo 'Existing release is not the exact verified tag/commit/body/asset/digest identity; it was not mutated.' >&2
    exit 1
  }
else
  echo "Unable to prove release state for $RELEASE_TAG (HTTP $status)." >&2
  exit 1
fi

draft="$(jq -er '.draft' "$release_state")"
asset_count="$(jq -er '.asset_count' "$release_state")"
asset_kind="$(jq -er '.asset_kind' "$release_state")"
if [[ "$draft" == 'false' ]]; then
  [[ "$asset_count" == '1' && "$asset_kind" == 'uploaded' ]] || exit 1
  assert_version_publication_ready
  echo "Verified existing exact published release: $RELEASE_TAG"
  exit 0
fi
[[ "$draft" == 'true' ]] || exit 1

if [[ "$asset_kind" == 'starter' ]]; then
  echo 'Existing starter/partial release asset requires manual operator review; refusing to delete, overwrite, upload, or publish.' >&2
  exit 1
fi

if [[ "$asset_count" == '0' && "$asset_kind" == 'none' ]]; then
  assert_version_publication_ready
  upload_error="$RUNNER_TEMP/release-upload.err"
  if gh release upload "$RELEASE_TAG" "$jar#$asset_label" \
    --repo "$REPOSITORY" 2> "$upload_error"; then
    upload_status=0
  else
    upload_status=$?
  fi
  for attempt in 1 2 3 4 5; do
    status="$(fetch_release "$release_json")"
    if [[ "$status" == '200' ]] && verify_release_state "$release_json"; then
      asset_count="$(jq -er '.asset_count' "$release_state")"
      asset_kind="$(jq -er '.asset_kind' "$release_state")"
      [[ "$asset_count" == '1' && "$asset_kind" == 'uploaded' ]] && break
    fi
    [[ "$attempt" -eq 5 ]] || sleep 2
  done
  if [[ "$asset_kind" != 'uploaded' ]]; then
    status="$(fetch_release "$release_json")"
    if [[ "$status" != '200' ]] || ! verify_release_state "$release_json"; then
      echo 'JAR upload left a conflicting partial release; it was not deleted, replaced, or published.' >&2
      exit 1
    fi
    asset_count="$(jq -er '.asset_count' "$release_state")"
    asset_kind="$(jq -er '.asset_kind' "$release_state")"
    if [[ "$upload_status" -ne 0 ]]; then
      while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$upload_error"
    fi
    [[ "$asset_kind" == 'none' || "$asset_kind" == 'starter' ]] || exit 1
    echo 'Create-only JAR upload did not complete; the starter/partial draft requires manual operator review and was not deleted, overwritten, or published.' >&2
    exit 1
  fi
  assert_version_publication_ready
fi

# Refetch and verify the complete exact draft immediately before its
# only publication mutation. A concurrently published exact release is
# accepted; a conflicting state is never edited.
status="$(fetch_release "$release_json")"
[[ "$status" == '200' ]] && verify_release_state "$release_json" || {
  echo 'Release changed before publication; refusing to edit it.' >&2
  exit 1
}
draft="$(jq -er '.draft' "$release_state")"
asset_count="$(jq -er '.asset_count' "$release_state")"
asset_kind="$(jq -er '.asset_kind' "$release_state")"
[[ "$asset_count" == '1' && "$asset_kind" == 'uploaded' ]] || exit 1
if [[ "$draft" == 'false' ]]; then
  assert_version_publication_ready
  echo "Verified concurrently published exact release: $RELEASE_TAG"
  exit 0
fi
[[ "$draft" == 'true' ]] || exit 1

assert_version_publication_ready
publish_error="$RUNNER_TEMP/release-publish.err"
if gh release edit "$RELEASE_TAG" --repo "$REPOSITORY" --draft=false 2> "$publish_error"; then
  publish_status=0
else
  publish_status=$?
fi
for attempt in 1 2 3 4 5; do
  status="$(fetch_release "$release_json")"
  if [[ "$status" == '200' ]] && verify_release_state "$release_json"; then
    draft="$(jq -er '.draft' "$release_state")"
    [[ "$draft" == 'false' ]] && break
  fi
  [[ "$attempt" -eq 5 ]] || sleep 2
done
if [[ "$draft" != 'false' ]]; then
  status="$(fetch_release "$release_json")"
  if [[ "$status" != '200' ]] || ! verify_release_state "$release_json"; then
    echo 'Release publication raced with conflicting state; no delete or recreation was attempted.' >&2
    exit 1
  fi
  draft="$(jq -er '.draft' "$release_state")"
  if [[ "$publish_status" -ne 0 ]]; then
    while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$publish_error"
  fi
  [[ "$draft" == 'true' ]] || exit 1
  echo 'Exact complete draft was not published; it remains recoverable and was not recreated.' >&2
  exit 1
fi
assert_version_publication_ready
echo "Created or recovered exact published release: $RELEASE_TAG"
