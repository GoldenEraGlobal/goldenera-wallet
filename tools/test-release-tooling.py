#!/usr/bin/env python3
"""Local fixture and adversarial tests for extracted release workflow scripts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import tempfile
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
SCRIPTS = {
    "common": TOOLS / "release-common.sh",
    "identity": TOOLS / "resolve-build-identity.sh",
    "recheck": TOOLS / "recheck-publishing-ref.sh",
    "images": TOOLS / "publish-image-aliases.sh",
    "release": TOOLS / "publish-github-release.sh",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def active_lines(script: str) -> list[list[str]]:
    result: list[list[str]] = []
    for raw in script.splitlines():
        try:
            tokens = shlex.split(raw, comments=True, posix=True)
        except ValueError:
            continue
        if tokens:
            result.append(tokens)
    return result


def has_active(script: str, tokens: list[str]) -> bool:
    return tokens in active_lines(script)


def assignment_values(script: str, variable: str) -> list[str]:
    pattern = re.compile(rf"{re.escape(variable)}=([^\s]+)$")
    values: list[str] = []
    for tokens in active_lines(script):
        if len(tokens) == 1 and (match := pattern.fullmatch(tokens[0])):
            values.append(match.group(1))
    return values


def verify_scripts(scripts: dict[str, str]) -> None:
    common = scripts["common"]
    identity = scripts["identity"]
    recheck = scripts["recheck"]
    images = scripts["images"]
    release = scripts["release"]

    require("defaultBranchRef{name target{oid}}" in common, "Default branch and head must come from one current GraphQL response")
    require("github.event.repository.default_branch" not in common, "Stale event default-branch metadata is forbidden")
    require('git check-ref-format "refs/heads/$CURRENT_DEFAULT_BRANCH"' in common, "All valid Git default branch names must be accepted")
    require("for depth in 1 2 3 4" in common, "Annotated release tags must resolve with a fail-closed depth bound")
    require('if "bypass_actors" in ruleset and ruleset["bypass_actors"] != []:' in common, "Visible nonempty ruleset bypass actors must fail closed")
    require('{"deletion", "update"}.issubset(types)' in common and "excludes != []" in common, "Tag ruleset proof must require active update+deletion protection with no exclusions")
    require("may hide bypass actors" in common and "administrators can still alter policy" in common, "Ruleset proof must name the residual hidden-bypass/admin limitation")
    require("compare/$COMMIT_SHA...$observed_default_head" in common and ".merge_base_commit.sha == $commit" in common, "Version identity must use GitHub's current default head and prove ancestry")
    require("Default-branch head changed during release ancestry verification" in common, "Version ancestry must fail closed if the observed head changes")
    ready = common.split("assert_version_publication_ready()", 1)[1]
    require(ready.count("assert_release_version_identity") == 2 and "assert_release_tag_immutable" in ready, "Write readiness must bound ruleset proof with exact identity/ancestry checks")

    require(assignment_values(identity, "publish_mode") == ["none", "default", "version"], "Publication modes must be active assignments none/default/version")
    require("EVENT_NAME" in identity and "EVENT_REF" in identity and "git rev-parse HEAD" in identity, "Identity must bind publication to push event and full checked-out commit")
    require("assert_version_publication_ready" in identity and identity.index("assert_version_publication_ready") < identity.index("publish_mode=version"), "Version mode must be rejected before it can enable publication")
    require('echo "default_branch=' not in identity, "Unused default-branch workflow output must not be emitted")
    require("SOURCE_DATE_EPOCH" in identity and "git show --no-patch --format=%ct" in identity, "Commit timestamp must define reproducible build time")

    require("assert_current_default_head" in recheck and "assert_version_publication_ready" in recheck, "Native builders must recheck either publication identity")
    require("A non-publishing run reached an image builder" in recheck, "Non-publish modes must fail closed in image builders")

    require(has_active(images, ["arguments+=(--header", "If-None-Match: *)"]), "Immutable aliases require an active If-None-Match create-only header")
    put_body = images.split("put_manifest() {", 1)[1].split("\n}", 1)[0]
    put_active = active_lines(put_body)
    guarded_call = ["assert_package_write_identity", "||", "return", "1"]
    require(guarded_call in put_active, "Every registry PUT must actively fail before curl when publication identity cannot be rechecked")
    guard_index = put_active.index(guarded_call)
    curl_index = next(index for index, tokens in enumerate(put_active) if tokens[0] == "curl")
    require(guard_index < curl_index, "Every registry PUT must recheck publication identity before sending bytes")
    require("assert_version_publication_ready" in images.split("assert_package_write_identity()", 1)[1].split("\n}", 1)[0], "Every version registry PUT must recheck tag, ancestry, and ruleset")
    require(has_active(images, ["probe_status=$(put_manifest $manifest_digest $final_manifest true $probe_prefix)"]), "Conditional semantics must be probed at a content digest")
    require("no aliases were published" in images and "unconditional digest replay" in images, "Registry capability proof must fail before aliases and distinguish duplicate rejection")
    require("(.manifests | length) == 4" in images, "Final aliases must contain two runnable and two attestation descriptors")
    require("runnable_descriptor" in images and "attestation_descriptor" in images, "Final index must preserve verified platform descriptors")
    require(images.count('inspect_existing_immutable_alias "sha-$COMMIT_SHA"') == 2, "Both modes must inspect the immutable SHA alias for exact recovery")
    require(images.count('inspect_existing_immutable_alias "$VERSION"') == 1, "Version recovery must inspect the semantic alias")
    require("adopt_existing_manifest" in images and "cmp -s" in images, "Existing immutable aliases must be adopted only when their exact bytes agree")
    require("verify_attested_index" in images and "https://slsa.dev/provenance/v0.2" in images and "https://spdx.dev/Document" in images, "Adopted and new indexes must verify linked provenance and SBOM")
    require(images.count('publish_immutable_alias "sha-$COMMIT_SHA"') == 2, "Default and version modes must both ensure full-SHA alias")
    require(images.count('publish_immutable_alias "$VERSION"') == 1, "Version mode must ensure exactly one semantic alias")
    require("publish_latest" not in images and "manifests/latest" not in images, "Immutable publication must never read or move latest")

    forbidden_release = ("gh release delete", "--request DELETE", "--clobber", "git push --delete", "git tag -d")
    require(not any(value in release for value in forbidden_release), "Release recovery must never delete releases/assets/tags or clobber assets")
    require(release.count("gh release create") == 1 and "--draft" in release, "Release creation must be one draft-first operation")
    require(release.count("gh release upload") == 1, "Exact empty drafts may use one create-only asset upload")
    require(release.count("gh release edit") == 1 and "--draft=false" in release, "Only exact complete drafts may publish")
    require("asset_state == 'starter'" in release and "manual operator review" in release, "Starter/partial uploads must fail closed for manual review")
    starter_branch = release.split("if [[ \"$asset_kind\" == 'starter' ]]; then", 1)[1].split("\nfi", 1)[0]
    require(has_active(starter_branch, ["exit", "1"]), "Starter/partial uploads must actively terminate before any recovery mutation")
    require("starter_stale" not in release and "asset_updated_at" not in release, "Automatic stale-starter recovery is forbidden")
    create_index = release.index("gh release create")
    upload_index = release.index("gh release upload")
    publish_index = release.index("gh release edit")
    for operation, index in (("release creation", create_index), ("asset upload", upload_index), ("release publication", publish_index)):
        require(release.rfind("assert_version_publication_ready", 0, index) >= 0, f"Version identity/ruleset must be rechecked before {operation}")
    require("Existing release asset bytes conflict" in release and "Accept: application/octet-stream" in release, "Existing uploaded asset bytes must be downloaded and verified")
    require("len(assets) in (0, 1)" in release, "Release state must reject extra assets")


def extract_release_policy_python(script: str) -> str:
    marker = "python3 - \"$release_json\""
    start_line = next(i for i, line in enumerate(script.splitlines()) if marker in line and "<<'PY'" in line)
    lines = script.splitlines()
    end = next(i for i in range(start_line + 1, len(lines)) if lines[i] == "PY")
    return "\n".join(lines[start_line + 1 : end]) + "\n"


def run_ruleset_fixture(payload: dict, expected: bool) -> None:
    with tempfile.TemporaryDirectory(prefix="wallet-ruleset-fixture-") as temporary:
        fixture = Path(temporary) / "ruleset.json"
        fixture.write_text(json.dumps(payload))
        result = subprocess.run(
            [
                "bash",
                "-c",
                'set -euo pipefail; source "$1"; RELEASE_TAG=v1.2.3; ruleset_protects_release_tag "$2"',
                "fixture",
                str(SCRIPTS["common"]),
                str(fixture),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        require((result.returncode == 0) == expected, f"Ruleset fixture returned {result.returncode}, expected success={expected}: {result.stderr}")


def run_version_identity_fixture(
    *,
    commit: str,
    default_head: str,
    tag_commit: str,
    expected: bool,
    compare: dict | None = None,
    second_head: str | None = None,
    version: str = "1.2.3",
    release_tag: str = "v1.2.3",
    consumed: str = "0.0.1",
) -> None:
    with tempfile.TemporaryDirectory(prefix="wallet-version-identity-") as temporary:
        directory = Path(temporary)
        fake_bin = directory / "bin"
        fake_bin.mkdir()
        fake_jq = fake_bin / "jq"
        fake_jq.write_text(
            """#!/usr/bin/env python3
import json
from pathlib import Path
import sys
args = sys.argv[1:]
values = {}
for index, item in enumerate(args):
    if item == '--arg':
        values[args[index + 1]] = args[index + 2]
payload = json.loads(Path(args[-1]).read_text())
valid = (
    payload.get('base_commit', {}).get('sha') == values.get('commit')
    and payload.get('merge_base_commit', {}).get('sha') == values.get('commit')
    and (
        payload.get('status') == 'ahead'
        or (payload.get('status') == 'identical' and values.get('commit') == values.get('head'))
    )
)
raise SystemExit(0 if valid else 1)
"""
        )
        fake_jq.chmod(0o755)
        comparison = compare or {
            "base_commit": {"sha": commit},
            "merge_base_commit": {"sha": commit},
            "status": "ahead",
        }
        env = {
            **dict(__import__("os").environ),
            "API_URL": "https://api.github.test",
            "COMMIT_SHA": commit,
            "CONSUMED_RELEASE_VERSION": consumed,
            "DEFAULT_HEAD": default_head,
            "GH_TOKEN": "token",
            "GRAPHQL_URL": "https://api.github.test/graphql",
            "MOCK_COMPARE_JSON": json.dumps(comparison),
            "MOCK_SECOND_HEAD": second_head or default_head,
            "MOCK_TAG_COMMIT": tag_commit,
            "RELEASE_TAG": release_tag,
            "REPOSITORY": "owner/repository",
            "RUNNER_TEMP": str(directory),
            "VERSION": version,
        }
        result = subprocess.run(
            [
                "bash",
                "-c",
                r'''set -euo pipefail
source "$1"
PATH="$2:$PATH"
READ_COUNT=0
read_current_default_identity() {
  READ_COUNT=$((READ_COUNT + 1))
  CURRENT_DEFAULT_BRANCH=trunk
  if [[ "$READ_COUNT" -eq 1 ]]; then
    CURRENT_DEFAULT_HEAD="$DEFAULT_HEAD"
  else
    CURRENT_DEFAULT_HEAD="$MOCK_SECOND_HEAD"
  fi
}
resolve_release_tag_commit() {
  RESOLVED_RELEASE_COMMIT="$MOCK_TAG_COMMIT"
}
curl() {
  printf '%s' "$MOCK_COMPARE_JSON"
}
assert_release_version_identity
''',
                "fixture",
                str(SCRIPTS["common"]),
                str(fake_bin),
            ],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        require(
            (result.returncode == 0) == expected,
            f"Version identity fixture returned {result.returncode}, expected success={expected}: {result.stderr}",
        )


def run_ready_order_fixture() -> None:
    result = subprocess.run(
        [
            "bash",
            "-c",
            r'''set -euo pipefail
source "$1"
CALLS=
assert_release_version_identity() { CALLS="${CALLS}I"; }
assert_release_tag_immutable() { CALLS="${CALLS}R"; }
assert_version_publication_ready
[[ "$CALLS" == IRI ]]
''',
            "fixture",
            str(SCRIPTS["common"]),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    require(result.returncode == 0, f"Write-readiness ordering fixture failed: {result.stderr}")


def run_release_fixture(source: str, release: dict, expected: bool, expected_kind: str | None = None) -> None:
    with tempfile.TemporaryDirectory(prefix="wallet-release-fixture-") as temporary:
        directory = Path(temporary)
        release_path = directory / "release.json"
        notes = directory / "notes.md"
        state = directory / "state.json"
        notes.write_text("exact notes\n")
        release_path.write_text(json.dumps(release))
        result = subprocess.run(
            [
                "python3",
                "-",
                str(release_path),
                str(notes),
                "v1.2.3",
                "wallet.jar",
                "GoldenEra Wallet 1.2.3",
                "7",
                "a" * 64,
                str(state),
            ],
            input=source,
            text=True,
            capture_output=True,
            check=False,
        )
        require((result.returncode == 0) == expected, f"Release fixture returned {result.returncode}, expected success={expected}: {result.stderr}")
        if expected_kind is not None:
            require(json.loads(state.read_text())["asset_kind"] == expected_kind, "Release fixture emitted wrong asset kind")


def python_jq_fixture(filter_source: str, payload: dict, args: tuple[str, ...]) -> bool:
    digest_pattern = re.compile(r"^sha256:[0-9a-f]{64}$")
    if "(.manifests | length) == 4" in filter_source:
        variables = {args[index + 1]: args[index + 2] for index in range(0, len(args), 3)}
        manifests = payload.get("manifests")
        if payload.get("schemaVersion") != 2 or payload.get("mediaType") != "application/vnd.oci.image.index.v1+json" or not isinstance(manifests, list) or len(manifests) != 4:
            return False
        runnable = sorted(
            (item.get("digest"), item.get("platform", {}).get("os"), item.get("platform", {}).get("architecture"), item.get("mediaType"))
            for item in manifests if item.get("platform", {}).get("os") == "linux"
        )
        expected_runnable = sorted([
            (variables["amd64"], "linux", "amd64", "application/vnd.oci.image.manifest.v1+json"),
            (variables["arm64"], "linux", "arm64", "application/vnd.oci.image.manifest.v1+json"),
        ])
        linked = sorted(
            item.get("annotations", {}).get("vnd.docker.reference.digest")
            for item in manifests
            if item.get("platform") == {"os": "unknown", "architecture": "unknown"}
            and item.get("mediaType") == "application/vnd.oci.image.manifest.v1+json"
            and item.get("annotations", {}).get("vnd.docker.reference.type") == "attestation-manifest"
        )
        return runnable == expected_runnable and linked == sorted([variables["amd64"], variables["arm64"]]) and all(
            isinstance(item.get("digest"), str) and digest_pattern.fullmatch(item["digest"])
            and isinstance(item.get("size"), (int, float)) and not isinstance(item.get("size"), bool) and item["size"] > 0
            for item in manifests
        )
    layers = payload.get("layers")
    return (
        payload.get("schemaVersion") == 2
        and payload.get("mediaType") == "application/vnd.oci.image.manifest.v1+json"
        and isinstance(layers, list)
        and len(layers) == 2
        and all(layer.get("mediaType") == "application/vnd.in-toto+json" and isinstance(layer.get("digest"), str) and digest_pattern.fullmatch(layer["digest"]) for layer in layers)
        and sorted(layer.get("annotations", {}).get("in-toto.io/predicate-type") for layer in layers)
        == ["https://slsa.dev/provenance/v0.2", "https://spdx.dev/Document"]
    )


def run_jq_fixture(filter_source: str, payload: dict, expected: bool, *args: str) -> None:
    if shutil.which("jq"):
        result = subprocess.run(
            ["jq", "-e", *args, filter_source],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            check=False,
        )
        success = result.returncode == 0
        detail = result.stderr
    else:
        success = python_jq_fixture(filter_source, payload, args)
        detail = "Python-equivalent fallback used because jq is unavailable"
    require(success == expected, f"OCI jq fixture expected success={expected}: {detail}")


def run_oci_fixtures(script: str) -> None:
    section = script.split("verify_attested_index() {", 1)[1].split("\n}\n\ninspect_existing_immutable_alias", 1)[0]
    index_marker = '--arg arm64 "$arm64_image_digest" \'\n'
    index_start = section.index(index_marker) + len(index_marker)
    index_end = section.index('\n    \' "$index"', index_start)
    index_filter = section[index_start:index_end]
    amd64 = "sha256:" + "a" * 64
    arm64 = "sha256:" + "b" * 64
    attest_amd64 = "sha256:" + "c" * 64
    attest_arm64 = "sha256:" + "d" * 64
    runnable = lambda digest, arch: {
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "digest": digest,
        "size": 123,
        "platform": {"os": "linux", "architecture": arch},
    }
    attestation = lambda digest, subject: {
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "digest": digest,
        "size": 456,
        "platform": {"os": "unknown", "architecture": "unknown"},
        "annotations": {
            "vnd.docker.reference.type": "attestation-manifest",
            "vnd.docker.reference.digest": subject,
        },
    }
    valid_index = {
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.index.v1+json",
        "manifests": [
            runnable(amd64, "amd64"),
            attestation(attest_amd64, amd64),
            runnable(arm64, "arm64"),
            attestation(attest_arm64, arm64),
        ],
    }
    jq_args = ("--arg", "amd64", amd64, "--arg", "arm64", arm64)
    run_jq_fixture(index_filter, valid_index, True, *jq_args)
    run_jq_fixture(index_filter, valid_index | {"manifests": valid_index["manifests"][:2]}, False, *jq_args)
    bad_link = json.loads(json.dumps(valid_index))
    bad_link["manifests"][1]["annotations"]["vnd.docker.reference.digest"] = arm64
    run_jq_fixture(index_filter, bad_link, False, *jq_args)
    extra = json.loads(json.dumps(valid_index))
    extra["manifests"].append(runnable("sha256:" + "e" * 64, "ppc64le"))
    run_jq_fixture(index_filter, extra, False, *jq_args)

    manifest_marker = "    jq -e '\n      .schemaVersion == 2"
    manifest_start = section.index(manifest_marker) + len("    jq -e '")
    manifest_end = section.index('\n    \' "$attestation_manifest"', manifest_start)
    manifest_filter = section[manifest_start:manifest_end]
    valid_attestation = {
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "layers": [
            {
                "mediaType": "application/vnd.in-toto+json",
                "digest": "sha256:" + "e" * 64,
                "annotations": {"in-toto.io/predicate-type": "https://slsa.dev/provenance/v0.2"},
            },
            {
                "mediaType": "application/vnd.in-toto+json",
                "digest": "sha256:" + "f" * 64,
                "annotations": {"in-toto.io/predicate-type": "https://spdx.dev/Document"},
            },
        ],
    }
    run_jq_fixture(manifest_filter, valid_attestation, True)
    run_jq_fixture(manifest_filter, valid_attestation | {"layers": valid_attestation["layers"][:1]}, False)
    wrong_predicate = json.loads(json.dumps(valid_attestation))
    wrong_predicate["layers"][1]["annotations"]["in-toto.io/predicate-type"] = "https://example.invalid"
    run_jq_fixture(manifest_filter, wrong_predicate, False)


def run_fixtures(scripts: dict[str, str]) -> None:
    run_oci_fixtures(scripts["images"])
    valid_ruleset = {
        "target": "tag",
        "enforcement": "active",
        # GitHub deliberately omits bypass_actors for read-only callers.
        "conditions": {"ref_name": {"include": ["refs/tags/v*"], "exclude": []}},
        "rules": [{"type": "deletion"}, {"type": "update"}],
    }
    run_ruleset_fixture(valid_ruleset, True)
    run_ruleset_fixture({**valid_ruleset, "bypass_actors": []}, True)
    for mutation in (
        lambda value: value.update({"bypass_actors": [{"actor_type": "Integration", "actor_id": 1}]}),
        lambda value: value.update({"bypass_actors": None}),
        lambda value: value["conditions"]["ref_name"].update({"exclude": ["refs/tags/v1.2.3"]}),
        lambda value: value.update({"rules": [{"type": "deletion"}]}),
        lambda value: value["conditions"]["ref_name"].update({"include": ["refs/heads/*"]}),
    ):
        changed = json.loads(json.dumps(valid_ruleset))
        mutation(changed)
        run_ruleset_fixture(changed, False)

    commit = "a" * 40
    head = "b" * 40
    run_version_identity_fixture(commit=commit, default_head=head, tag_commit=commit, expected=True)
    run_version_identity_fixture(commit=commit, default_head=commit, tag_commit=commit, expected=True)
    run_version_identity_fixture(commit=commit, default_head=head, tag_commit="c" * 40, expected=False)
    run_version_identity_fixture(commit=commit, default_head=head, tag_commit=commit, version="0.0.1", release_tag="v0.0.1", expected=False)
    run_version_identity_fixture(commit=commit, default_head=head, tag_commit=commit, release_tag="v1.2.4", expected=False)
    run_version_identity_fixture(
        commit=commit,
        default_head=head,
        tag_commit=commit,
        compare={"base_commit": {"sha": commit}, "merge_base_commit": {"sha": "c" * 40}, "status": "diverged"},
        expected=False,
    )
    run_version_identity_fixture(commit=commit, default_head=head, second_head="d" * 40, tag_commit=commit, expected=False)
    run_ready_order_fixture()

    source = extract_release_policy_python(scripts["release"])
    base = {"tag_name": "v1.2.3", "name": "v1.2.3", "body": "exact notes\n", "draft": True, "prerelease": False}
    run_release_fixture(source, {**base, "assets": []}, True, "none")
    uploaded = {
        "id": 11,
        "name": "wallet.jar",
        "label": "GoldenEra Wallet 1.2.3",
        "state": "uploaded",
        "size": 7,
        "digest": "sha256:" + "a" * 64,
        "url": "https://api.github.test/assets/11",
    }
    run_release_fixture(source, {**base, "assets": [uploaded]}, True, "uploaded")
    starter = {
        "id": 12,
        "name": "wallet.jar",
        "label": "GoldenEra Wallet 1.2.3",
        "state": "starter",
        "size": 0,
        "digest": None,
        "url": "https://api.github.test/assets/12",
        "updated_at": "2000-01-01T00:00:00Z",
    }
    run_release_fixture(source, {**base, "assets": [starter]}, True, "starter")
    run_release_fixture(source, {**base, "draft": False, "assets": []}, False)
    run_release_fixture(source, {**base, "assets": [uploaded, uploaded | {"id": 13}]}, False)
    run_release_fixture(source, {**base, "body": "conflict\n", "assets": []}, False)
    run_release_fixture(source, {**base, "assets": [starter | {"size": 1}]}, False)


def negative_mutations(scripts: dict[str, str]) -> list[tuple[str, dict[str, str]]]:
    def changed(name: str, old: str, new: str) -> dict[str, str]:
        require(scripts[name].count(old) == 1, f"Negative fixture anchor is not unique: {name}: {old!r}")
        result = dict(scripts)
        result[name] = scripts[name].replace(old, new, 1)
        return result

    return [
        ("comment-hidden publish mode", changed("identity", "publish_mode=none", "publish_mode=default # publish_mode=none")),
        ("commented create-only header", changed("images", "arguments+=(--header 'If-None-Match: *')", ": # If-None-Match: *")),
        ("two-descriptor alias", changed("images", "(.manifests | length) == 4", "(.manifests | length) == 2")),
        ("version moves latest", changed("images", 'publish_immutable_alias "$VERSION"', "publish_latest # publish_immutable_alias \"$VERSION\"")),
        ("registry write loses identity guard", changed("images", "  assert_package_write_identity || return 1\n  arguments=(", "  : # assert_package_write_identity || return 1\n  arguments=(")),
        ("version write loses ruleset proof", changed("images", "      assert_version_publication_ready", "      assert_release_tag_commit")),
        ("release accepts extra assets", changed("release", "len(assets) in (0, 1)", "len(assets) >= 0")),
        ("release clobbers asset", changed("release", "--repo \"$REPOSITORY\" 2>", "--repo \"$REPOSITORY\" --clobber 2>")),
        ("starter no longer fails closed", changed("release", "  exit 1\nfi\n\nif [[ \"$asset_count\" == '0'", "  : # exit 1\nfi\n\nif [[ \"$asset_count\" == '0'")),
        ("ruleset permits visible bypass", changed("common", "if \"bypass_actors\" in ruleset and ruleset[\"bypass_actors\"] != []:", "if False:  # bypass_actors")),
        ("ancestry accepts merge-base mismatch", changed("common", ".merge_base_commit.sha == $commit and", ".merge_base_commit.sha != $commit and")),
    ]


def positive_mutations(scripts: dict[str, str]) -> list[tuple[str, dict[str, str]]]:
    commented = {name: text + "\n# Harmless local policy-test comment.\n" for name, text in scripts.items()}
    renamed_comment = dict(scripts)
    renamed_comment["images"] = renamed_comment["images"].replace(
        "# Every registry PUT rechecks the observable Git ref, default-branch ancestry,",
        "# Recheck the observable Git ref and ancestry before each registry PUT,",
        1,
    )
    return [("comments do not define policy", commented), ("comment wording is irrelevant", renamed_comment)]


def load_scripts() -> dict[str, str]:
    scripts = {name: path.read_text() for name, path in SCRIPTS.items()}
    for name, path in SCRIPTS.items():
        require(path.stat().st_mode & stat.S_IXUSR, f"Release script is not executable: {path}")
        result = subprocess.run(["bash", "-n", str(path)], capture_output=True, text=True, check=False)
        require(result.returncode == 0, f"Shell syntax failed for {path}: {result.stderr.strip()}")
    return scripts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test-only", action="store_true")
    args = parser.parse_args()
    scripts = load_scripts()
    verify_scripts(scripts)
    run_fixtures(scripts)
    for name, mutated in positive_mutations(scripts):
        try:
            verify_scripts(mutated)
        except AssertionError as exc:
            raise AssertionError(f"Release tooling policy rejected harmless refactor: {name}: {exc}") from exc
    for name, mutated in negative_mutations(scripts):
        try:
            verify_scripts(mutated)
        except AssertionError:
            continue
        raise AssertionError(f"Release tooling policy accepted adversarial mutation: {name}")
    if args.self_test_only:
        print("PASS: extracted release tooling rejected all adversarial mutations")
    else:
        print("PASS: extracted release tooling passed shell syntax, semantic policy, and local fixtures")


if __name__ == "__main__":
    main()
