#!/usr/bin/env bash
# Shared fail-closed GitHub ref checks for release workflow tooling.

require_release_env() {
  local name
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || {
      printf 'Required environment variable %s is missing.\n' "$name" >&2
      return 1
    }
  done
}

read_current_default_identity() {
  require_release_env GH_TOKEN GRAPHQL_URL REPOSITORY RUNNER_TEMP || return 1
  local owner repository_name payload response
  IFS='/' read -r owner repository_name <<< "$REPOSITORY"
  [[ -n "$owner" && -n "$repository_name" && "$repository_name" != */* ]] || {
    echo 'GitHub repository identity is malformed.' >&2
    return 1
  }
  payload="$(jq -nc --arg owner "$owner" --arg name "$repository_name" '{
    query: "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){defaultBranchRef{name target{oid}}}}",
    variables: {owner: $owner, name: $name}
  }')" || return 1
  response="$RUNNER_TEMP/default-branch-identity.json"
  curl --fail --silent --show-error --retry 3 \
    --request POST \
    --header "Authorization: Bearer $GH_TOKEN" \
    --header 'Content-Type: application/json' \
    --data "$payload" \
    "$GRAPHQL_URL" > "$response" || return 1
  jq -e '((.errors // []) | length) == 0 and .data.repository.defaultBranchRef != null' "$response" > /dev/null || return 1
  CURRENT_DEFAULT_BRANCH="$(jq -er '.data.repository.defaultBranchRef.name' "$response")" || return 1
  CURRENT_DEFAULT_HEAD="$(jq -er '.data.repository.defaultBranchRef.target.oid' "$response")" || return 1
  [[ -n "$CURRENT_DEFAULT_BRANCH" && "$CURRENT_DEFAULT_BRANCH" != *$'\n'* && "$CURRENT_DEFAULT_BRANCH" != *$'\r'* ]] || {
    echo 'Current default branch returned by GitHub is malformed.' >&2
    return 1
  }
  git check-ref-format "refs/heads/$CURRENT_DEFAULT_BRANCH" > /dev/null || {
    echo 'Current default branch returned by GitHub is not a valid Git branch ref.' >&2
    return 1
  }
  [[ "$CURRENT_DEFAULT_HEAD" =~ ^[0-9a-f]{40}$ ]] || {
    echo 'Current default-branch head is not a full commit SHA.' >&2
    return 1
  }
}

assert_current_default_head() {
  require_release_env COMMIT_SHA SOURCE_BRANCH || return 1
  read_current_default_identity || return 1
  [[ "$CURRENT_DEFAULT_BRANCH" == "$SOURCE_BRANCH" && "$CURRENT_DEFAULT_HEAD" == "$COMMIT_SHA" ]] || {
    echo 'Publication is no longer running for the current default-branch head.' >&2
    return 1
  }
}

read_current_source_branch_identity() {
  require_release_env GH_TOKEN GRAPHQL_URL REPOSITORY RUNNER_TEMP SOURCE_BRANCH || return 1
  local owner repository_name qualified payload response
  IFS='/' read -r owner repository_name <<< "$REPOSITORY"
  [[ -n "$owner" && -n "$repository_name" && "$repository_name" != */* ]] || {
    echo 'GitHub repository identity is malformed.' >&2
    return 1
  }
  git check-ref-format "refs/heads/$SOURCE_BRANCH" > /dev/null || {
    echo 'Source branch is not a valid Git branch ref.' >&2
    return 1
  }
  qualified="refs/heads/$SOURCE_BRANCH"
  payload="$(jq -nc --arg owner "$owner" --arg name "$repository_name" --arg qualified "$qualified" '{
    query: "query($owner:String!,$name:String!,$qualified:String!){repository(owner:$owner,name:$name){ref(qualifiedName:$qualified){target{oid}}}}",
    variables: {owner: $owner, name: $name, qualified: $qualified}
  }')" || return 1
  response="$RUNNER_TEMP/source-branch-identity.json"
  curl --fail --silent --show-error --retry 3 \
    --request POST \
    --header "Authorization: Bearer $GH_TOKEN" \
    --header 'Content-Type: application/json' \
    --data "$payload" \
    "$GRAPHQL_URL" > "$response" || return 1
  jq -e '((.errors // []) | length) == 0 and .data.repository.ref != null' "$response" > /dev/null || return 1
  CURRENT_SOURCE_BRANCH_HEAD="$(jq -er '.data.repository.ref.target.oid' "$response")" || return 1
  [[ "$CURRENT_SOURCE_BRANCH_HEAD" =~ ^[0-9a-f]{40}$ ]] || {
    echo 'Current source-branch head is not a full commit SHA.' >&2
    return 1
  }
}

assert_current_source_branch_head() {
  require_release_env COMMIT_SHA SOURCE_BRANCH || return 1
  read_current_source_branch_identity || return 1
  [[ "$CURRENT_SOURCE_BRANCH_HEAD" == "$COMMIT_SHA" ]] || {
    echo 'Development publication is no longer running for the current source-branch head.' >&2
    return 1
  }
}

assert_release_version_shape() {
  require_release_env COMMIT_SHA CONSUMED_RELEASE_VERSION RELEASE_TAG VERSION || return 1
  [[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || {
    echo 'Version publication requires one full lowercase commit SHA.' >&2
    return 1
  }
  [[ "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
    echo 'Version publication requires an exact non-SNAPSHOT X.Y.Z POM version.' >&2
    return 1
  }
  [[ "$RELEASE_TAG" == "v$VERSION" ]] || {
    echo 'Release tag does not exactly match the verified POM version.' >&2
    return 1
  }
  [[ "$VERSION" != "$CONSUMED_RELEASE_VERSION" ]] || {
    echo "Release identity v$CONSUMED_RELEASE_VERSION is already consumed and must never be selected again." >&2
    return 1
  }
}

resolve_release_tag_commit() {
  require_release_env API_URL GH_TOKEN RELEASE_TAG REPOSITORY RUNNER_TEMP || return 1
  local encoded_tag ref_response object_type object_sha tag_response depth
  encoded_tag="$(python3 - "$RELEASE_TAG" <<'PY'
import sys
from urllib.parse import quote
print(quote(sys.argv[1], safe=''))
PY
)" || return 1
  ref_response="$RUNNER_TEMP/release-tag-ref.json"
  curl --fail --silent --show-error --retry 3 \
    --header "Authorization: Bearer $GH_TOKEN" \
    --header 'Accept: application/vnd.github+json' \
    --header 'X-GitHub-Api-Version: 2022-11-28' \
    "$API_URL/repos/$REPOSITORY/git/ref/tags/$encoded_tag" > "$ref_response" || return 1
  object_type="$(jq -er '.object.type' "$ref_response")" || return 1
  object_sha="$(jq -er '.object.sha' "$ref_response")" || return 1
  [[ "$object_sha" =~ ^[0-9a-f]{40}$ ]] || {
    echo 'Release tag object does not have a full lowercase SHA.' >&2
    return 1
  }
  for depth in 1 2 3 4; do
    [[ "$object_type" == 'tag' ]] || break
    tag_response="$RUNNER_TEMP/release-annotated-tag-$depth.json"
    curl --fail --silent --show-error --retry 3 \
      --header "Authorization: Bearer $GH_TOKEN" \
      --header 'Accept: application/vnd.github+json' \
      --header 'X-GitHub-Api-Version: 2022-11-28' \
      "$API_URL/repos/$REPOSITORY/git/tags/$object_sha" > "$tag_response" || return 1
    object_type="$(jq -er '.object.type' "$tag_response")" || return 1
    object_sha="$(jq -er '.object.sha' "$tag_response")" || return 1
    [[ "$object_sha" =~ ^[0-9a-f]{40}$ ]] || {
      echo 'Annotated release tag object does not have a full lowercase SHA.' >&2
      return 1
    }
  done
  [[ "$object_type" == 'commit' ]] || {
    echo 'Release tag does not resolve to a commit within four annotated-tag objects.' >&2
    return 1
  }
  RESOLVED_RELEASE_COMMIT="$object_sha"
}

assert_release_tag_commit() {
  require_release_env COMMIT_SHA || return 1
  resolve_release_tag_commit || return 1
  [[ "$RESOLVED_RELEASE_COMMIT" == "$COMMIT_SHA" ]] || {
    echo 'Release tag no longer resolves to the verified commit.' >&2
    return 1
  }
}

assert_release_commit_on_current_default() {
  require_release_env API_URL COMMIT_SHA GH_TOKEN REPOSITORY RUNNER_TEMP || return 1
  local observed_default_head compare
  read_current_default_identity || return 1
  observed_default_head="$CURRENT_DEFAULT_HEAD"
  if [[ "$COMMIT_SHA" != "$observed_default_head" ]]; then
    compare="$RUNNER_TEMP/release-default-ancestry.json"
    curl --fail --silent --show-error --retry 3 \
      --header "Authorization: Bearer $GH_TOKEN" \
      --header 'Accept: application/vnd.github+json' \
      --header 'X-GitHub-Api-Version: 2022-11-28' \
      "$API_URL/repos/$REPOSITORY/compare/$COMMIT_SHA...$observed_default_head" > "$compare" || return 1
    jq -e --arg commit "$COMMIT_SHA" --arg head "$observed_default_head" '
      .base_commit.sha == $commit and
      .merge_base_commit.sha == $commit and
      (.status == "ahead" or (.status == "identical" and $commit == $head))
    ' "$compare" > /dev/null || {
      echo 'Release commit is not equal to or an ancestor of the current default-branch head.' >&2
      return 1
    }
  fi
  read_current_default_identity || return 1
  [[ "$CURRENT_DEFAULT_HEAD" == "$observed_default_head" ]] || {
    echo 'Default-branch head changed during release ancestry verification; retry from a fresh workflow run.' >&2
    return 1
  }
}

assert_release_version_identity() {
  assert_release_version_shape || return 1
  assert_release_tag_commit || return 1
  assert_release_commit_on_current_default || return 1
  assert_release_tag_commit || return 1
}

ruleset_protects_release_tag() {
  local ruleset="$1"
  python3 - "$ruleset" "$RELEASE_TAG" <<'PY'
import json
from pathlib import Path
import sys

ruleset = json.loads(Path(sys.argv[1]).read_text())
tag = sys.argv[2]
ref = f"refs/tags/{tag}"
if ruleset.get("target") != "tag" or ruleset.get("enforcement") != "active":
    raise SystemExit(1)
# GitHub omits bypass_actors unless the caller can write rulesets. An omitted
# field is therefore not proof of no bypass. If GitHub does expose the field,
# fail closed unless it is exactly an empty list.
if "bypass_actors" in ruleset and ruleset["bypass_actors"] != []:
    raise SystemExit(1)
conditions = ruleset.get("conditions")
if not isinstance(conditions, dict):
    raise SystemExit(1)
ref_name = conditions.get("ref_name")
if not isinstance(ref_name, dict):
    raise SystemExit(1)
includes = ref_name.get("include")
excludes = ref_name.get("exclude")
if not isinstance(includes, list) or not all(isinstance(item, str) for item in includes):
    raise SystemExit(1)
# Unknown exclusions are fail-closed because an excluded release tag would not
# be protected. Requiring none avoids approximating GitHub's ref glob dialect.
if excludes != []:
    raise SystemExit(1)
recognized = {"~ALL", ref}
if tag.startswith("v") and "/" not in tag:
    recognized.add("refs/tags/v*")
if not any(pattern in recognized for pattern in includes):
    raise SystemExit(1)
rules = ruleset.get("rules")
if not isinstance(rules, list):
    raise SystemExit(1)
types = {rule.get("type") for rule in rules if isinstance(rule, dict)}
if not {"deletion", "update"}.issubset(types):
    raise SystemExit(1)
PY
}

assert_release_tag_immutable() {
  require_release_env API_URL GH_TOKEN RELEASE_TAG REPOSITORY RUNNER_TEMP || return 1
  local list response id detail
  list="$RUNNER_TEMP/tag-rulesets.json"
  curl --fail --silent --show-error --retry 3 \
    --header "Authorization: Bearer $GH_TOKEN" \
    --header 'Accept: application/vnd.github+json' \
    --header 'X-GitHub-Api-Version: 2022-11-28' \
    "$API_URL/repos/$REPOSITORY/rulesets?targets=tag&per_page=100" > "$list" || return 1
  jq -e 'type == "array"' "$list" > /dev/null || return 1
  while IFS= read -r id; do
    [[ "$id" =~ ^[1-9][0-9]*$ ]] || continue
    detail="$RUNNER_TEMP/tag-ruleset-$id.json"
    curl --fail --silent --show-error --retry 3 \
      --header "Authorization: Bearer $GH_TOKEN" \
      --header 'Accept: application/vnd.github+json' \
      --header 'X-GitHub-Api-Version: 2022-11-28' \
      "$API_URL/repos/$REPOSITORY/rulesets/$id" > "$detail" || return 1
    if ruleset_protects_release_tag "$detail"; then
      echo 'Verified active release-tag update and deletion protection. Residual limitation: GitHub may hide bypass actors without ruleset-write authority, and repository administrators can still alter policy outside this workflow.' >&2
      return 0
    fi
  done < <(jq -r '.[] | select(.target == "tag" and .enforcement == "active") | .id' "$list")
  echo 'No active matching tag ruleset proves that this release tag forbids both update and deletion. No remote state was changed.' >&2
  echo 'Residual limitation: GitHub may hide bypass actors without ruleset-write authority; visible nonempty bypass actors are always rejected.' >&2
  return 1
}

assert_version_publication_ready() {
  # Bound the ruleset observation with exact tag/default-branch identity checks.
  # This cannot make independent GitHub policy/ref updates atomic, but every
  # irreversible write boundary fails closed on the freshest observable state.
  assert_release_version_identity || return 1
  assert_release_tag_immutable || return 1
  assert_release_version_identity || return 1
}
