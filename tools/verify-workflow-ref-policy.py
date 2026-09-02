#!/usr/bin/env python3
"""Parse the release workflow and enforce its declarative trust boundaries."""

from __future__ import annotations

import argparse
from collections import Counter
import copy
import hashlib
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any, Callable

try:
    import yaml
except ModuleNotFoundError as exc:
    raise SystemExit("PyYAML is required; CI must install the reviewed pinned version first") from exc

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/build-and-release.yml"
DOCKERFILE = ROOT / "Dockerfile"
DOCKERIGNORE = ROOT / ".dockerignore"
RELEASE_TOOL_TEST = ROOT / "tools/test-release-tooling.py"

RUNTIME_IMAGE = (
    "docker.io/library/eclipse-temurin:25-jre-alpine@"
    "sha256:3137541deb3cac6626b5d9a4a2187bc0d6a34312f858bd2c67dd01e732e6b682"
)
BUILDKIT_IMAGE = (
    "docker.io/moby/buildkit:buildx-stable-1@"
    "sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8"
)
BUILDX_VERSION = "v0.25.0"
ACTION_PINS = {
    "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/setup-java": "03ad4de0992f5dab5e18fcb136590ce7c4a0ac95",
    "actions/setup-node": "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
    "actions/upload-artifact": "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "actions/download-artifact": "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    "pnpm/setup": "84cb39b217b10273981911c288cd62326dc7c6d2",
    "docker/setup-buildx-action": "bb05f3f5519dd87d3ba754cc423b652a5edd6d2c",
    "docker/login-action": "dbcb813823bdd20940b903addbd779551569679f",
    "docker/build-push-action": "f9f3042f7e2789586610d6e8b85c8f03e5195baf",
}
EXPECTED_JOBS = {"build", "build-images", "publish-images", "release"}
# Exact code/action identities for jobs holding write permissions. Display names
# and unrelated ordering are intentionally not policy; any extra privileged run
# step or changed command body is rejected.
PRIVILEGED_STEP_ALLOWLIST = {
    "build-images": Counter({
        ("action", "", f"actions/checkout@{ACTION_PINS['actions/checkout']}"): 1,
        ("action", "", f"actions/download-artifact@{ACTION_PINS['actions/download-artifact']}"): 1,
        ("run", "context", "a9d7f9bfcb17dff8e9481d900be2726b7c45b950ca5fb795ae7158eebb244c77"): 1,
        ("action", "", f"docker/setup-buildx-action@{ACTION_PINS['docker/setup-buildx-action']}"): 1,
        ("action", "", f"docker/login-action@{ACTION_PINS['docker/login-action']}"): 1,
        ("run", "", "54fd0bdfe726c4bda70aa280d0deec1036d630bf2a84c9042b7a340b0da6f4de"): 1,
        ("action", "image", f"docker/build-push-action@{ACTION_PINS['docker/build-push-action']}"): 1,
        ("run", "", "a949a1f7894d5a766c2e8f0a19db66d0927a6e1c8a13d35c7a55ea3182538796"): 1,
        ("action", "", f"actions/upload-artifact@{ACTION_PINS['actions/upload-artifact']}"): 1,
    }),
    "publish-images": Counter({
        ("action", "", f"actions/checkout@{ACTION_PINS['actions/checkout']}"): 1,
        ("action", "", f"actions/download-artifact@{ACTION_PINS['actions/download-artifact']}"): 1,
        ("run", "publish", "cd1ac6f5575efc1060ac6ae54747988cffb6117e2405b63506224f1dfd2f199b"): 1,
    }),
    "release": Counter({
        ("action", "", f"actions/checkout@{ACTION_PINS['actions/checkout']}"): 1,
        ("action", "", f"actions/download-artifact@{ACTION_PINS['actions/download-artifact']}"): 1,
        ("run", "", "8a448e601d8482b9caa6afa3e70653df7c079e247a28406c082250200eccb029"): 1,
    }),
}
EXPECTED_DOCKERFILE_LINES = [
    f"FROM {RUNTIME_IMAGE}",
    "RUN addgroup -S -g 10001 wallet \\",
    "&& adduser -S -D -H -u 10001 -G wallet wallet",
    "WORKDIR /app",
    "RUN mkdir -p /app/logs /app/wallet_logs \\",
    "&& chown -R wallet:wallet /app/logs /app/wallet_logs",
    "COPY --chown=wallet:wallet app.jar /app/app.jar",
    'ENV JAVA_TOOL_OPTIONS=""',
    "USER 10001:10001",
    "EXPOSE 8080",
    'ENTRYPOINT ["java", "-jar", "/app/app.jar"]',
]


class WorkflowLoader(yaml.SafeLoader):
    """YAML 1.2-like loader that keeps the key `on` as text."""


WorkflowLoader.yaml_implicit_resolvers = copy.deepcopy(yaml.SafeLoader.yaml_implicit_resolvers)
for key, resolvers in list(WorkflowLoader.yaml_implicit_resolvers.items()):
    WorkflowLoader.yaml_implicit_resolvers[key] = [
        resolver for resolver in resolvers if resolver[0] != "tag:yaml.org,2002:bool"
    ]
WorkflowLoader.add_implicit_resolver(
    "tag:yaml.org,2002:bool",
    re.compile(r"^(?:true|false)$", re.IGNORECASE),
    list("tTfF"),
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def mapping(value: Any, message: str) -> dict[str, Any]:
    require(isinstance(value, dict), message)
    return value


def sequence(value: Any, message: str) -> list[Any]:
    require(isinstance(value, list), message)
    return value


def parse_workflow(text: str) -> dict[str, Any]:
    try:
        document = yaml.load(text, Loader=WorkflowLoader)
    except yaml.YAMLError as exc:
        raise AssertionError(f"Workflow YAML does not parse: {exc}") from exc
    return mapping(document, "Workflow root must be a mapping")


def job_steps(job: dict[str, Any], name: str) -> list[dict[str, Any]]:
    steps = sequence(job.get("steps"), f"Job {name} must define steps")
    require(all(isinstance(step, dict) for step in steps), f"Every {name} step must be a mapping")
    return steps


def step_named(job: dict[str, Any], job_name: str, name: str) -> dict[str, Any]:
    matches = [step for step in job_steps(job, job_name) if step.get("name") == name]
    require(len(matches) == 1, f"Job {job_name} must contain exactly one step named {name!r}")
    return matches[0]


def step_with_id(job: dict[str, Any], job_name: str, step_id: str) -> dict[str, Any]:
    matches = [step for step in job_steps(job, job_name) if step.get("id") == step_id]
    require(len(matches) == 1, f"Job {job_name} must contain exactly one step id {step_id!r}")
    return matches[0]


def run_text(step: dict[str, Any], description: str) -> str:
    value = step.get("run")
    require(isinstance(value, str) and value.strip(), f"{description} must be an executable run step")
    return value


def verify_shell_syntax(document: dict[str, Any]) -> None:
    jobs = mapping(document.get("jobs"), "Workflow jobs must be a mapping")
    with tempfile.TemporaryDirectory(prefix="wallet-inline-shell-") as temporary:
        directory = Path(temporary)
        for job_name, raw_job in jobs.items():
            job = mapping(raw_job, f"Job {job_name} must be a mapping")
            for index, step in enumerate(job_steps(job, job_name)):
                script = step.get("run")
                if script is None:
                    continue
                require(isinstance(script, str), "run must be text")
                path = directory / f"{job_name}-{index}.sh"
                path.write_text(script)
                result = subprocess.run(["bash", "-n", str(path)], capture_output=True, text=True, check=False)
                require(result.returncode == 0, f"Inline shell syntax failed in {job_name}/{step.get('name')}: {result.stderr.strip()}")


def verify_events(document: dict[str, Any]) -> None:
    triggers = mapping(document.get("on"), "Workflow triggers must parse as a mapping")
    require(set(triggers) == {"pull_request", "push", "workflow_dispatch"}, "Only PR, push, and manual validation events are allowed")
    require(triggers["pull_request"] is None, "Pull requests must use the ordinary unprivileged event")
    require(triggers["workflow_dispatch"] is None, "Manual runs must not accept publication inputs")
    require(triggers["push"] == {"branches": ["**"], "tags": ["v*"]}, "Every branch and version tag must validate")
    require(
        document.get("concurrency") == {
            "group": "wallet-build-${{ github.ref }}",
            "cancel-in-progress": False,
        },
        "Rollout must overlap the legacy per-ref group and never cancel an in-flight publisher",
    )


def verify_actions_and_interpolation(jobs: dict[str, dict[str, Any]]) -> None:
    refs: list[str] = []
    for job_name, job in jobs.items():
        for step in job_steps(job, job_name):
            if "uses" in step:
                refs.append(str(step["uses"]))
            if "run" in step:
                require("${{" not in str(step["run"]), f"{job_name}/{step.get('name')} directly interpolates GitHub expressions into shell")
    expected = Counter({
        f"actions/checkout@{ACTION_PINS['actions/checkout']}": 4,
        f"actions/setup-java@{ACTION_PINS['actions/setup-java']}": 1,
        f"actions/setup-node@{ACTION_PINS['actions/setup-node']}": 1,
        f"actions/upload-artifact@{ACTION_PINS['actions/upload-artifact']}": 2,
        f"actions/download-artifact@{ACTION_PINS['actions/download-artifact']}": 3,
        f"pnpm/setup@{ACTION_PINS['pnpm/setup']}": 1,
        f"docker/setup-buildx-action@{ACTION_PINS['docker/setup-buildx-action']}": 1,
        f"docker/login-action@{ACTION_PINS['docker/login-action']}": 1,
        f"docker/build-push-action@{ACTION_PINS['docker/build-push-action']}": 1,
    })
    for ref in refs:
        match = re.fullmatch(r"([^@\s]+)@([0-9a-f]{40})", ref)
        require(match is not None, f"Action must use a full immutable commit pin: {ref}")
        name, commit = match.groups()
        require(ACTION_PINS.get(name) == commit, f"Action is absent from the reviewed pin allowlist: {ref}")
    require(Counter(refs) == expected, "Action invocations must match the exact reviewed pins and counts")


def verify_privileged_step_allowlists(jobs: dict[str, dict[str, Any]]) -> None:
    for job_name, expected in PRIVILEGED_STEP_ALLOWLIST.items():
        actual: Counter[tuple[str, str, str]] = Counter()
        for step in job_steps(jobs[job_name], job_name):
            step_id = str(step.get("id", ""))
            has_action = "uses" in step
            has_run = "run" in step
            require(has_action != has_run, f"Privileged step in {job_name} must be exactly one action or run command")
            if has_action:
                actual[("action", step_id, str(step["uses"]))] += 1
            else:
                command = run_text(step, f"Privileged {job_name} command")
                digest = hashlib.sha256(command.encode()).hexdigest()
                actual[("run", step_id, digest)] += 1
        require(actual == expected, f"Job {job_name} steps must match the exact privileged action/run allowlist")


def verify_permissions_and_checkouts(document: dict[str, Any], jobs: dict[str, dict[str, Any]]) -> None:
    require(document.get("permissions") == {"contents": "read", "packages": "read"}, "Workflow defaults must remain read-only")
    expected = {
        "build": {"contents": "read", "packages": "read"},
        "build-images": {"actions": "read", "contents": "read", "packages": "write"},
        "publish-images": {"actions": "read", "contents": "read", "packages": "write"},
        "release": {"actions": "read", "contents": "write"},
    }
    for name, permissions in expected.items():
        require(jobs[name].get("permissions") == permissions, f"Job {name} lost its exact least-privilege permission map")
        checkouts = [step for step in job_steps(jobs[name], name) if str(step.get("uses", "")).startswith("actions/checkout@")]
        require(len(checkouts) == 1, f"Job {name} must check out exactly once")
        require(mapping(checkouts[0].get("with"), "Checkout inputs must be explicit").get("persist-credentials") is False, f"Job {name} must not persist checkout credentials")
    serialized = repr(document).lower()
    require("write-all" not in serialized and "id-token" not in serialized, "Broad or unused write permissions are forbidden")


def verify_build(jobs: dict[str, dict[str, Any]]) -> None:
    build = jobs["build"]
    java = step_named(build, "build", "Set up Java")
    java_inputs = mapping(java.get("with"), "Java setup inputs must be explicit")
    require(java_inputs == {
        "distribution": "temurin",
        "java-version": "25",
        "check-latest": True,
        "cache": "maven",
        "server-id": "github-cryptoj",
    }, "CI must resolve the latest stable Temurin 25 while the POM keeps Java release 21")
    pnpm = step_named(build, "build", "Set up pnpm")
    require(mapping(pnpm.get("with"), "pnpm setup inputs must be explicit") == {
        "version": "11.24.0",
        "install": False,
    }, "CI must install exact pnpm 11.24.0 without an implicit dependency install")
    node = step_named(build, "build", "Set up Node.js")
    require(mapping(node.get("with"), "Node setup inputs must be explicit") == {
        "node-version": "24.20.0",
        "cache": "pnpm",
        "cache-dependency-path": "frontend/pnpm-lock.yaml",
    }, "CI must restore exact Node 24.20.0")
    parser = step_named(build, "build", "Install the pinned workflow policy parser")
    require(run_text(parser, "PyYAML install") == "python3 -m pip install --disable-pip-version-check PyYAML==6.0.2", "Workflow parser dependency must be explicitly installed at the reviewed version")
    require(run_text(step_named(build, "build", "Validate workflow publication policy"), "Policy verifier") == "python3 tools/verify-workflow-ref-policy.py", "Workflow must execute the checked semantic verifier")

    steps = job_steps(build, "build")
    preparation = [
        (index, step)
        for index, step in enumerate(steps)
        if "tools/prepare-local-maven-artifacts.py" in str(step.get("run", ""))
    ]
    require(len(preparation) == 1, "Checksum-pinned local Maven release preparation must run exactly once")
    preparation_index, preparation_step = preparation[0]
    expected_preparation = '''set -euo pipefail
archive="$RUNNER_TEMP/goldenera-wallet-public-maven-releases.tar"
python3 tools/prepare-local-maven-artifacts.py --output "$archive"
mkdir -p "$HOME/.m2/repository"
tar -xf "$archive" -C "$HOME/.m2/repository"
'''
    require(run_text(preparation_step, "Maven artifact preparation") == expected_preparation, "CryptoJ/RLP override must use the reviewed checksum-verifying preparation and overwrite the local repository")
    maven_indexes = [index for index, step in enumerate(steps) if "./mvnw" in str(step.get("run", ""))]
    require(maven_indexes and all(preparation_index < index for index in maven_indexes), "Verified CryptoJ/RLP copies must be installed before every Maven invocation")

    identity = step_with_id(build, "build", "identity")
    require(run_text(identity, "Identity") == "tools/resolve-build-identity.sh", "Identity logic must use the checked extracted script")
    require(identity.get("env") == {
        "API_URL": "${{ github.api_url }}",
        "EVENT_NAME": "${{ github.event_name }}",
        "EVENT_REF": "${{ github.ref }}",
        "GH_TOKEN": "${{ github.token }}",
        "GRAPHQL_URL": "${{ github.graphql_url }}",
        "REPOSITORY": "${{ github.repository }}",
    }, "Identity and pre-publication tag policy inputs must enter only through reviewed environment mappings")
    outputs = mapping(build.get("outputs"), "Build outputs must be explicit")
    expected_outputs = {
        "commit_sha": "${{ steps.identity.outputs.commit_sha }}",
        "image_name": "${{ steps.identity.outputs.image_name }}",
        "jar_name": "${{ steps.artifact.outputs.jar_name }}",
        "jar_sha256": "${{ steps.artifact.outputs.jar_sha256 }}",
        "publish_mode": "${{ steps.identity.outputs.publish_mode }}",
        "release_tag": "${{ steps.identity.outputs.release_tag }}",
        "source_branch": "${{ steps.identity.outputs.source_branch }}",
        "source_epoch": "${{ steps.identity.outputs.source_epoch }}",
        "version": "${{ steps.identity.outputs.version }}",
    }
    require(outputs == expected_outputs, "Build outputs must expose only the reviewed immutable identity and exact JAR metadata")

    scripts = "\n".join(str(step.get("run", "")) for step in job_steps(build, "build"))
    require("pnpm --dir frontend generate" in scripts and "git status --porcelain=v1 --untracked-files=all" in scripts, "Generated API policy must reject tracked and untracked drift")
    require("pnpm --dir frontend check:static" in scripts and "sync:static" not in scripts, "CI must reject rather than rewrite static PWA drift")
    require("playwright install --with-deps chromium firefox" in scripts, "Production browser gates must install Chromium and Firefox")
    firefox = step_named(build, "build", "Smoke the built PWA in Firefox")
    require(firefox.get("env") == {"WALLET_E2E_CROSS_BROWSER": "1", "WALLET_E2E_PRODUCTION": "1"}, "Firefox smoke must target the built cross-browser PWA suite")
    require(run_text(firefox, "Firefox smoke") == "timeout --signal=TERM 5m pnpm --dir frontend test:e2e", "Firefox smoke must remain bounded")

    reproducible = step_named(build, "build", "Build, test, and reproduce the backend JAR")
    require(reproducible.get("env") == {"GITHUB_TOKEN": "${{ secrets.GITHUB_TOKEN }}", "SOURCE_DATE_EPOCH": "${{ steps.identity.outputs.source_epoch }}"}, "Maven must receive the commit-derived timestamp through env")
    reproducible_script = run_text(reproducible, "Reproducible Maven build")
    require('-Dproject.build.outputTimestamp="$SOURCE_DATE_EPOCH" clean verify' in reproducible_script, "Every tested JAR build must use deterministic Maven archive time")
    require([line.strip() for line in reproducible_script.splitlines()].count("build_once") == 2, "The same commit must be built and tested twice for reproducibility")
    require("second_sha256" in reproducible_script and "first_sha256" in reproducible_script and "Same-commit JAR builds differ" in reproducible_script, "Reproducibility must compare exact JAR bytes")
    require("-DskipTests" not in reproducible_script and "maven.test.skip" not in reproducible_script, "Both reproducibility builds must execute tests")
    require("target/wallet-openapi-boot4.json" in scripts and "verify_packaged_pwa.py" in scripts, "Backend contract and packaged PWA must gate the exact JAR")
    upload = mapping(step_named(build, "build", "Upload the exact verified JAR").get("with"), "JAR artifact upload inputs must be explicit")
    require(upload.get("name") == "wallet-jar-${{ steps.identity.outputs.commit_sha }}", "JAR artifact must use full commit identity")


def verify_native_images(jobs: dict[str, dict[str, Any]]) -> None:
    job = jobs["build-images"]
    require(job.get("if") == "needs.build.outputs.publish_mode != 'none'", "Native image builds must be publication-gated")
    include = mapping(mapping(job.get("strategy"), "Image strategy must be explicit").get("matrix"), "Image matrix must be explicit").get("include")
    require(include == [
        {"arch": "amd64", "runner": "ubuntu-24.04"},
        {"arch": "arm64", "runner": "ubuntu-24.04-arm"},
    ], "Only native linux/amd64 and linux/arm64 runners are allowed")
    require(job.get("needs") == "build", "Native image writes must depend on the build-time identity and tag-policy gate")
    require("setup-qemu" not in repr(job).lower(), "Emulated privileged image builds are forbidden")
    steps = job_steps(job, "build-images")
    rechecks = [step for step in steps if step.get("run") == "tools/recheck-publishing-ref.sh"]
    require(len(rechecks) == 1, "Image builders must use one checked ref/policy recheck script")
    recheck = rechecks[0]
    require(recheck.get("env") == {
        "API_URL": "${{ github.api_url }}",
        "COMMIT_SHA": "${{ needs.build.outputs.commit_sha }}",
        "GH_TOKEN": "${{ github.token }}",
        "GRAPHQL_URL": "${{ github.graphql_url }}",
        "MODE": "${{ needs.build.outputs.publish_mode }}",
        "RELEASE_TAG": "${{ needs.build.outputs.release_tag }}",
        "REPOSITORY": "${{ github.repository }}",
        "SOURCE_BRANCH": "${{ needs.build.outputs.source_branch }}",
        "VERSION": "${{ needs.build.outputs.version }}",
    }, "The final package-write recheck must receive exact tag, version, commit, and current-default inputs")
    setup_matches = [step for step in steps if step.get("uses") == f"docker/setup-buildx-action@{ACTION_PINS['docker/setup-buildx-action']}"]
    require(len(setup_matches) == 1, "Native image job must have one pinned BuildKit setup")
    setup = setup_matches[0]
    require(setup.get("with") == {"version": "${{ env.BUILDX_VERSION }}", "driver-opts": "image=${{ env.BUILDKIT_IMAGE }}"}, "Buildx client and BuildKit daemon must be pinned")
    image = step_with_id(job, "build-images", "image")
    require(steps.index(recheck) + 1 == steps.index(image), "Tag ancestry/ruleset identity must be rechecked immediately before the platform package write")
    inputs = mapping(image.get("with"), "Build-push inputs must be explicit")
    require(inputs.get("context") == "${{ steps.context.outputs.path }}", "Image builds must use only the artifact context")
    require(inputs.get("platforms") == "linux/${{ matrix.arch }}", "Each native job must build only its selected platform")
    output = str(inputs.get("outputs"))
    require(all(value in output for value in ("push-by-digest=true", "name-canonical=true", "oci-mediatypes=true", "rewrite-timestamp=true")), "Platform images must be reproducibly pushed by digest")
    require(inputs.get("build-args") == "SOURCE_DATE_EPOCH=${{ needs.build.outputs.source_epoch }}", "BuildKit timestamps must derive from the commit")
    require(inputs.get("provenance") == "mode=max" and inputs.get("sbom") is True, "BuildKit provenance and SBOM must be enabled")
    labels = str(inputs.get("labels"))
    require("org.opencontainers.image.revision=${{ needs.build.outputs.commit_sha }}" in labels and "global.goldenera.wallet.jar.sha256=${{ needs.build.outputs.jar_sha256 }}" in labels, "Runnable images must carry full commit and tested JAR identities")
    verification_steps = [step for step in steps if 'docker cp "$container_id:/app/app.jar"' in str(step.get("run", ""))]
    require(len(verification_steps) == 1, "Native image job must exactly verify the pushed platform artifact")
    verification = run_text(verification_steps[0], "Platform verification")
    for required in (
        '(.manifests | length) == 2', "attestation-manifest", "https://slsa.dev/provenance/v1",
        "https://spdx.dev/Document", "any(.subject[]?; .digest.sha256 == $subject)",
        '{{.Config.User}}', '{{json .Config.Entrypoint}}', '{{json .Config.Cmd}}',
        'docker cp "$container_id:/app/app.jar"', "runnable_descriptor", "attestation_descriptor",
    ):
        require(required in verification, f"Platform verification lost required check: {required}")


def verify_publication_jobs(jobs: dict[str, dict[str, Any]]) -> None:
    aliases = jobs["publish-images"]
    require(aliases.get("if") == "needs.build.outputs.publish_mode != 'none'", "Image alias job must be publication-gated")
    require(set(sequence(aliases.get("needs"), "Image alias dependencies must be a list")) == {"build", "build-images"}, "Image aliases must depend on the one verified build and native images")
    require(aliases.get("concurrency") == {
        "group": "wallet-image-alias-${{ github.repository }}-${{ needs.build.outputs.publish_mode == 'dev' && 'dev' || needs.build.outputs.commit_sha }}",
        "cancel-in-progress": False,
    }, "Development alias publishers must serialize while immutable publishers remain commit-isolated")
    publish = step_with_id(aliases, "publish-images", "publish")
    require(run_text(publish, "Immutable publication") == "tools/publish-image-aliases.sh", "Immutable publication must use the checked extracted script")
    require(publish.get("env") == {
        "API_URL": "${{ github.api_url }}",
        "COMMIT_SHA": "${{ needs.build.outputs.commit_sha }}",
        "GH_TOKEN": "${{ github.token }}",
        "GRAPHQL_URL": "${{ github.graphql_url }}",
        "IMAGE": "${{ env.REGISTRY }}/${{ needs.build.outputs.image_name }}",
        "IMAGE_NAME": "${{ needs.build.outputs.image_name }}",
        "JAR_SHA256": "${{ needs.build.outputs.jar_sha256 }}",
        "MODE": "${{ needs.build.outputs.publish_mode }}",
        "REGISTRY_HOST": "${{ env.REGISTRY }}",
        "REGISTRY_USER": "${{ github.actor }}",
        "RELEASE_TAG": "${{ needs.build.outputs.release_tag }}",
        "REPOSITORY": "${{ github.repository }}",
        "SOURCE_BRANCH": "${{ needs.build.outputs.source_branch }}",
        "VERSION": "${{ needs.build.outputs.version }}",
    }, "Immutable publication inputs must use the reviewed env bridge")

    release = jobs["release"]
    require(release.get("if") == "needs.build.outputs.publish_mode == 'version'", "GitHub Releases must run only in validated version mode")
    require(set(sequence(release.get("needs"), "Release dependencies must be a list")) == {"build", "publish-images"}, "Version releases must depend only on the verified build and immutable image aliases")
    require(release.get("concurrency") == {
        "group": "wallet-release-publication-${{ github.repository }}-${{ needs.build.outputs.release_tag }}",
        "cancel-in-progress": False,
    }, "Same-tag release attempts must serialize")
    release_steps = [step for step in job_steps(release, "release") if step.get("run") == "tools/publish-github-release.sh"]
    require(len(release_steps) == 1, "Release publication must use one checked extracted script")
    release_step = release_steps[0]
    require(release_step.get("env") == {
        "AMD64_IMAGE_DIGEST": "${{ needs.publish-images.outputs.amd64_image_digest }}",
        "API_URL": "${{ github.api_url }}",
        "ARM64_IMAGE_DIGEST": "${{ needs.publish-images.outputs.arm64_image_digest }}",
        "COMMIT_SHA": "${{ needs.build.outputs.commit_sha }}",
        "EXPECTED_SHA256": "${{ needs.build.outputs.jar_sha256 }}",
        "GH_TOKEN": "${{ github.token }}",
        "GRAPHQL_URL": "${{ github.graphql_url }}",
        "IMAGE": "${{ env.REGISTRY }}/${{ needs.build.outputs.image_name }}",
        "JAR_NAME": "${{ needs.build.outputs.jar_name }}",
        "MANIFEST_DIGEST": "${{ needs.publish-images.outputs.manifest_digest }}",
        "RELEASE_TAG": "${{ needs.build.outputs.release_tag }}",
        "REPOSITORY": "${{ github.repository }}",
        "VERSION": "${{ needs.build.outputs.version }}",
    }, "Release inputs must use the reviewed env bridge")


def verify_workflow(text: str) -> None:
    document = parse_workflow(text)
    require(document.get("name") == "Build, verify, and publish", "Workflow identity changed unexpectedly")
    require(document.get("env") == {
        "REGISTRY": "ghcr.io",
        "BUILDKIT_IMAGE": BUILDKIT_IMAGE,
        "BUILDX_VERSION": BUILDX_VERSION,
        "CONSUMED_RELEASE_VERSION": "0.0.1",
    }, "Registry, BuildKit, Buildx, and consumed release identities must match reviewed values")
    require(text.count("0.0.1") == 1, "Consumed v0.0.1/POM identity must have one workflow policy source of truth")
    lowered = text.lower()
    require("pull_request_target:" not in text, "Untrusted pull requests must never receive publication credentials")
    require("github.event.repository.default_branch" not in text, "Stale event-payload default branch metadata is forbidden")
    require("refs/heads/main" not in text and "refs/heads/master" not in text, "Default branch must not be hard-coded")
    require("network=host" not in lowered and "network: host" not in lowered, "Host networking is forbidden")
    require("publish-latest" not in lowered and "publish-latest-image.sh" not in lowered and "manifests/latest" not in lowered, "Workflow must never read, mutate, or restore the unsafe mutable latest alias")
    jobs_raw = mapping(document.get("jobs"), "Workflow jobs must be a mapping")
    require(set(jobs_raw) == EXPECTED_JOBS, "Workflow must contain exactly the reviewed semantic job IDs")
    jobs = {name: mapping(jobs_raw[name], f"Job {name} must be a mapping") for name in EXPECTED_JOBS}
    verify_events(document)
    verify_actions_and_interpolation(jobs)
    verify_permissions_and_checkouts(document, jobs)
    verify_privileged_step_allowlists(jobs)
    verify_build(jobs)
    verify_native_images(jobs)
    verify_publication_jobs(jobs)
    verify_shell_syntax(document)


def verify_dockerfile(text: str) -> None:
    meaningful = [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]
    require(meaningful == EXPECTED_DOCKERFILE_LINES, "Dockerfile must exactly match the reviewed artifact-only non-root runtime")
    require(meaningful[-1] == 'ENTRYPOINT ["java", "-jar", "/app/app.jar"]', "No instruction may override the exec-form entrypoint")
    require("USER 10001:10001" in meaningful and not any(line.upper().startswith("CMD ") for line in meaningful), "Runtime must remain non-root with no CMD override")
    require("/app/logs /app/wallet_logs" in text and "/app/wallet_data" not in text and "chown -R wallet:wallet" in text, "Default runtime log paths must be writable by the non-root user and unused data paths must be absent")
    require("JAVA_OPTS" not in text and 'ENV JAVA_TOOL_OPTIONS=""' in meaningful, "Runtime JVM flags must use Java's direct environment mechanism")


def verify_dockerignore(text: str) -> None:
    entries = [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]
    require(entries == ["**", "!Dockerfile", "!app.jar"], "Docker context must deny all files except Dockerfile and app.jar")


def run_release_tool_tests() -> None:
    result = subprocess.run(["python3", str(RELEASE_TOOL_TEST)], capture_output=True, text=True, check=False)
    require(result.returncode == 0, f"Extracted release tooling tests failed: {(result.stderr or result.stdout).strip()}")


def replace_once(text: str, old: str, new: str) -> str:
    require(text.count(old) == 1, f"Negative-test anchor must occur exactly once: {old!r}")
    return text.replace(old, new, 1)


def negative_mutations() -> list[tuple[str, Callable[[str], str]]]:
    return [
        ("manual publication input", lambda text: replace_once(text, "  workflow_dispatch:\n", "  workflow_dispatch:\n    inputs:\n      publish:\n        required: false\n")),
        ("build package write", lambda text: replace_once(text, "  build:\n    name: Build and verify once\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: read\n      packages: read\n", "  build:\n    name: Build and verify once\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: read\n      packages: write\n")),
        ("legacy concurrency overlap removed", lambda text: replace_once(text, "  group: wallet-build-${{ github.ref }}\n", "  group: wallet-validation-${{ github.ref }}\n")),
        ("mutable latest job restored", lambda text: replace_once(text, "  release:\n", "  publish-latest:\n    runs-on: ubuntu-24.04\n    steps: []\n\n  release:\n")),
        ("development alias race", lambda text: replace_once(text, "      group: wallet-image-alias-${{ github.repository }}-${{ needs.build.outputs.publish_mode == 'dev' && 'dev' || needs.build.outputs.commit_sha }}\n", "      group: wallet-image-alias-${{ github.repository }}-${{ needs.build.outputs.commit_sha }}\n")),
        ("release waits for latest", lambda text: replace_once(text, "      - publish-images\n    runs-on: ubuntu-24.04\n    concurrency:\n      group: wallet-release-publication", "      - publish-images\n      - publish-latest\n    runs-on: ubuntu-24.04\n    concurrency:\n      group: wallet-release-publication")),
        ("direct GitHub interpolation", lambda text: replace_once(text, "        run: tools/resolve-build-identity.sh\n", "        run: printf '%s' '${{ github.repository }}'\n")),
        ("unpinned parser", lambda text: replace_once(text, "PyYAML==6.0.2", "PyYAML")),
        ("wrong Maven server ID", lambda text: replace_once(text, "          server-id: github-cryptoj\n", "          server-id: github\n")),
        ("wrong Java major", lambda text: replace_once(text, "          java-version: '25'\n", "          java-version: '21'\n")),
        ("stale Java patch allowed", lambda text: replace_once(text, "          check-latest: true\n", "          check-latest: false\n")),
        ("wrong Node patch", lambda text: replace_once(text, "          node-version: '24.20.0'\n", "          node-version: '24'\n")),
        ("Maven override removed", lambda text: replace_once(text, "          python3 tools/prepare-local-maven-artifacts.py --output \"$archive\"\n", "          : # checksum override removed\n")),
        ("nondeterministic Maven archive", lambda text: replace_once(text, '-Dproject.build.outputTimestamp="$SOURCE_DATE_EPOCH"', "-DskipTests")),
        ("attestations disabled", lambda text: replace_once(text, "          provenance: mode=max\n          sbom: true\n", "          provenance: false\n          sbom: false\n")),
        ("wrong publication script", lambda text: replace_once(text, "        run: tools/publish-image-aliases.sh\n", "        run: tools/recheck-publishing-ref.sh\n")),
        ("extra privileged run", lambda text: replace_once(text, "      - name: Stage the manifest and publish aliases\n", "      - name: Unreviewed privileged command\n        run: true\n\n      - name: Stage the manifest and publish aliases\n")),
        ("extra pinned action", lambda text: replace_once(text, "      - name: Validate workflow publication policy\n", f"      - name: Unexpected login\n        uses: docker/login-action@{ACTION_PINS['docker/login-action']}\n\n      - name: Validate workflow publication policy\n")),
    ]


def positive_mutations() -> list[tuple[str, Callable[[str], str]]]:
    return [
        ("workflow comments are harmless", lambda text: text + "\n# Harmless local verifier fixture.\n"),
        ("privileged display names are not authority", lambda text: replace_once(text, "      - name: Stage the manifest and publish aliases\n", "      - name: Publish reviewed immutable aliases\n")),
        ("needs list order is semantic", lambda text: replace_once(text, "      - build\n      - publish-images\n    runs-on: ubuntu-24.04\n    concurrency:\n      group: wallet-release-publication", "      - publish-images\n      - build\n    runs-on: ubuntu-24.04\n    concurrency:\n      group: wallet-release-publication")),
    ]


def run_negative_tests(text: str) -> None:
    verify_workflow(text)
    for name, mutation in positive_mutations():
        try:
            verify_workflow(mutation(text))
        except AssertionError as exc:
            raise AssertionError(f"Workflow policy rejected harmless refactor: {name}: {exc}") from exc
    for name, mutation in negative_mutations():
        mutated = mutation(text)
        try:
            verify_workflow(mutated)
        except AssertionError:
            continue
        raise AssertionError(f"Workflow policy accepted adversarial mutation: {name}")


def run_docker_negative_tests(text: str) -> None:
    verify_dockerfile(text)
    mutations = {
        "later root user": text + "\nUSER root\n",
        "later shell entrypoint": text + '\nENTRYPOINT ["sh", "-c", "java -jar /app/app.jar"]\n',
        "later command": text + '\nCMD ["--unsafe"]\n',
        "missing writable logs": text.replace(" /app/logs", ""),
    }
    for name, mutated in mutations.items():
        try:
            verify_dockerfile(mutated)
        except AssertionError:
            continue
        raise AssertionError(f"Docker policy accepted adversarial mutation: {name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflow", type=Path, default=WORKFLOW)
    parser.add_argument("--self-test-only", action="store_true")
    args = parser.parse_args()
    text = args.workflow.read_text()
    run_release_tool_tests()
    run_negative_tests(text)
    run_docker_negative_tests(DOCKERFILE.read_text())
    if not args.self_test_only:
        verify_workflow(text)
        verify_dockerfile(DOCKERFILE.read_text())
        verify_dockerignore(DOCKERIGNORE.read_text())
        print("PASS: parsed workflow delegates to fixture-tested fail-closed release tooling with exact pins and least privilege")
    else:
        print("PASS: all workflow, release-tooling, and Docker adversarial mutations were rejected")


if __name__ == "__main__":
    main()
