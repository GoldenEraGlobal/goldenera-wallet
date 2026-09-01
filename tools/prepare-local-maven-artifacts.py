#!/usr/bin/env python3
"""Prepare verified public CryptoJ/RLP releases for a credential-free local Docker build."""

import argparse
import hashlib
import io
from pathlib import Path
import tarfile
from urllib.request import urlopen
from zipfile import ZipFile


RELEASES = [
    ("cryptoj", "0.0.5", "7d5eadaf13d4451d473e4eaf990dc52bedbde9fac3b13142f8f16e14f68ed30e"),
    ("rlp", "0.0.1", "6b026398f8c9a7fefd67b3acaeb55a845abd2999605928ab7ac92d50cb66fcd2"),
]


def prepare(output, cache):
    cache.mkdir(parents=True, exist_ok=True)
    with tarfile.open(output, "w") as archive:
        for module, version, checksum in RELEASES:
            artifact = f"goldenera-{module}"
            filename = f"{artifact}-{version}.jar"
            path = cache / filename
            if not path.exists():
                url = f"https://github.com/GoldenEraGlobal/{artifact}/releases/download/v{version}/{filename}"
                with urlopen(url, timeout=60) as response:
                    path.write_bytes(response.read())
            binary = path.read_bytes()
            assert hashlib.sha256(binary).hexdigest() == checksum, f"Public release checksum mismatch: {filename}"
            group = f"global.goldenera.{module}"
            with ZipFile(io.BytesIO(binary)) as jar:
                pom = jar.read(f"META-INF/maven/{group}/{artifact}/pom.xml")
            base = f"global/goldenera/{module}/{artifact}/{version}"
            stem = f"{artifact}-{version}"
            entries = {
                filename: binary,
                stem + ".pom": pom,
                "_remote.repositories": f"{stem}.jar>=\n{stem}.pom>=\n".encode(),
            }
            for name, data in entries.items():
                entry = tarfile.TarInfo(base + "/" + name)
                entry.size = len(data)
                entry.mode = 0o644
                entry.mtime = 0
                archive.addfile(entry, io.BytesIO(data))
    print(f"Prepared {output}: two SHA-256 verified public releases and embedded POMs; no credentials or env files")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", type=Path, default=Path("/tmp/goldenera-wallet-public-maven-releases"))
    args = parser.parse_args()
    prepare(args.output, args.cache)
