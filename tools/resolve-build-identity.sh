#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=release-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-common.sh"

require_release_env CONSUMED_RELEASE_VERSION EVENT_NAME EVENT_REF GITHUB_OUTPUT REPOSITORY

commit_sha="$(git rev-parse HEAD)"
[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'Commit identity must be a full 40-character SHA.' >&2
  exit 1
}
source_epoch="$(git show --no-patch --format=%ct "$commit_sha")"
[[ "$source_epoch" =~ ^[1-9][0-9]*$ ]] || {
  echo 'Commit timestamp must be a positive SOURCE_DATE_EPOCH.' >&2
  exit 1
}

version="$(./mvnw -q -DforceStdout help:evaluate -Dexpression=project.version)"
[[ -n "$version" && "$version" != *$'\n'* ]] || {
  echo 'Unable to resolve one Maven project version.' >&2
  exit 1
}

read_current_default_identity
default_branch="$CURRENT_DEFAULT_BRANCH"
default_head="$CURRENT_DEFAULT_HEAD"
publish_mode=none
release_tag=
source_branch=
if [[ "$EVENT_REF" == refs/heads/* ]]; then
  source_branch="${EVENT_REF#refs/heads/}"
fi

if [[ "$EVENT_NAME" == 'push' && -n "$source_branch" && "$source_branch" == "$default_branch" && "$commit_sha" == "$default_head" ]]; then
  publish_mode=default
elif [[ "$EVENT_NAME" == 'push' && "$EVENT_REF" == refs/tags/* ]]; then
  release_tag="${EVENT_REF#refs/tags/}"
  COMMIT_SHA="$commit_sha"
  RELEASE_TAG="$release_tag"
  VERSION="$version"
  # A tag run is rejected before any package write unless its exact identity,
  # default-branch ancestry, and active update+deletion ruleset all verify.
  assert_version_publication_ready
  publish_mode=version
fi

image_name="$(printf '%s' "$REPOSITORY" | tr '[:upper:]' '[:lower:]')"
[[ "$image_name" =~ ^[a-z0-9._/-]+$ ]] || {
  echo 'Container image name is malformed.' >&2
  exit 1
}

{
  echo "commit_sha=$commit_sha"
  echo "image_name=$image_name"
  echo "publish_mode=$publish_mode"
  echo "release_tag=$release_tag"
  echo "source_branch=$source_branch"
  echo "source_epoch=$source_epoch"
  echo "version=$version"
} >> "$GITHUB_OUTPUT"
