#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=release-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-common.sh"

require_release_env MODE
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
    echo 'A non-publishing run reached an image builder.' >&2
    exit 1
    ;;
esac
