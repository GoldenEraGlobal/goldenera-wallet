#!/usr/bin/env python3
"""Verify production PWA bytes in dist, Spring static resources, and the Boot JAR."""

import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener
from zipfile import ZipFile


def sha256(value):
    return hashlib.sha256(value).hexdigest()


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        raise AssertionError("Redirects are forbidden in local artifact verification")


def local_origin(origin):
    parsed = urlparse(origin)
    assert parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}, "Only local test origins are allowed"
    assert not parsed.username and not parsed.password and not parsed.query and not parsed.fragment and parsed.path in {"", "/"}, "Use an origin without credentials, a path, query, or fragment"
    return parsed


def files(root):
    result = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise AssertionError(f"Generated assets may not contain symlinks: {path}")
        if path.is_file():
            result[path.relative_to(root).as_posix()] = sha256(path.read_bytes())
    return result


def verify(args):
    root = Path(__file__).resolve().parents[2]
    dist = files(root / "frontend/apps/web/dist")
    static = files(root / "src/main/resources/static")
    assert {"index.html", "sw.js", "manifest.webmanifest"}.issubset(dist), "Build the production PWA first"
    assert static == dist, "Spring static resources do not exactly match production dist"
    jar = args.jar.resolve()
    prefix = "BOOT-INF/classes/static/"
    with ZipFile(jar) as archive:
        names = [name for name in archive.namelist() if name.startswith(prefix) and not name.endswith("/")]
        assert len(names) == len(set(names)), "Duplicate static ZIP entries"
        packaged = {name[len(prefix):]: sha256(archive.read(name)) for name in names}
    assert packaged == dist, "JAR static resources do not exactly match production dist"
    served = 0
    if args.http_origin:
        origin = args.http_origin.rstrip("/")
        parsed = local_origin(origin)
        client = build_opener(ProxyHandler({}), NoRedirects())
        for name, expected in dist.items():
            asset = origin + "/" + quote(name)
            derived = urlparse(asset)
            assert (derived.scheme, derived.netloc) == (parsed.scheme, parsed.netloc), "Asset must remain on the exact local origin"
            with client.open(asset, timeout=10) as response:
                assert response.status == 200, name
                assert sha256(response.read()) == expected, f"HTTP bytes differ: {name}"
            served += 1
    report = {
        "status": "PASS", "jar": str(jar), "jarSha256": sha256(jar.read_bytes()),
        "files": len(dist), "httpFilesVerified": served, "httpOrigin": args.http_origin,
        "distStaticJarExactMatch": True, "sha256": dist,
    }
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(f"PASS: {len(dist)} files match dist/static/JAR; {served} verified over actual local HTTP; JAR SHA-256 {report['jarSha256']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, default=Path("target/goldenera-wallet-0.0.1.jar"))
    parser.add_argument("--http-origin")
    parser.add_argument("--report", type=Path)
    verify(parser.parse_args())
