#!/usr/bin/env python3
"""Deterministically verify release/image behavior for representative Git refs."""

import json
import re
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/build-and-release.yml"


def sanitized_branch(ref: str) -> str:
    name = ref.removeprefix("refs/heads/").lower().replace("/", "-")
    name = re.sub(r"[^a-z0-9_.-]+", "-", name).strip(".-")
    if not name:
        raise ValueError(f"Ref has no valid Docker tag characters: {ref}")
    return name[:128]


def policy(ref: str) -> dict[str, object]:
    default_branch = ref in {"refs/heads/main", "refs/heads/master"}
    version_tag = ref.startswith("refs/tags/v")
    release = default_branch or version_tag
    if default_branch:
        primary = "latest"
    elif version_tag:
        primary = ref.removeprefix("refs/tags/v")
    elif ref.startswith("refs/heads/"):
        primary = sanitized_branch(ref)
    else:
        raise ValueError(f"Unsupported push ref: {ref}")
    auxiliary = (["latest", "sha-abcdef0"] if version_tag else ["sha-abcdef0"]) if release else []
    return {"ref": ref, "release": release, "primaryImageTag": primary, "auxiliaryImageTags": auxiliary}


def main() -> None:
    text = WORKFLOW.read_text()
    required = [
        '- "**"',
        "needs: build",
        "github.ref == 'refs/heads/main'",
        "github.ref == 'refs/heads/master'",
        "startsWith(github.ref, 'refs/tags/v')",
        "type=ref,event=branch",
        "type=semver,pattern={{version}}",
        "type=raw,value=latest",
        "ascii_downcase",
    ]
    missing = [marker for marker in required if marker not in text]
    if missing:
        raise SystemExit(f"Workflow policy markers missing: {missing}")
    merge_metadata = text.split("- name: Docker meta", 1)[1].split("- name: Normalize image tags", 1)[0]
    if "latest=false" not in merge_metadata:
        raise SystemExit("Merge metadata must explicitly disable implicit latest tags")
    if "startsWith(github.ref, 'refs/tags/v')" not in merge_metadata.split("type=raw,value=latest", 1)[1].splitlines()[0]:
        raise SystemExit("Version tags must explicitly preserve the historical latest tag")

    matrix = [
        policy("refs/heads/feature/updates"),
        policy("refs/heads/main"),
        policy("refs/heads/master"),
        policy("refs/tags/v1.2.3"),
    ]
    assert matrix[0] == {
        "ref": "refs/heads/feature/updates",
        "release": False,
        "primaryImageTag": "feature-updates",
        "auxiliaryImageTags": [],
    }
    assert matrix[1]["release"] is True and matrix[1]["primaryImageTag"] == "latest"
    assert matrix[2]["release"] is True and matrix[2]["primaryImageTag"] == "latest"
    assert matrix[3]["release"] is True and matrix[3]["primaryImageTag"] == "1.2.3"
    assert matrix[3]["auxiliaryImageTags"] == ["latest", "sha-abcdef0"]
    print(json.dumps(matrix, indent=2))


if __name__ == "__main__":
    main()
