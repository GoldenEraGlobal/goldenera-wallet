# Backend compatibility and integration tests

`BackendCompatibilityTest` starts the complete Spring application with MockMvc and a real Tomcat,
a disposable PostgreSQL 18.6 container, the real Liquibase changelog and an HTTP
node stub bound to loopback. Docker is required; database tests are not silently
replaced with H2 or skipped. No production node or database is used.

```bash
mise exec -- ./mvnw test
```

Tests cover database creation/replay, schema validation, Hypersistence repositories,
PostgreSQL device upserts, JSON scalar/date wire types, actual node HTTP forwarding,
public deterministic JavaScript transaction vectors, node errors, webhook HMAC,
the security/CORS boundary and baseline OpenAPI paths/operation IDs. Phase 2 adds
V2/V1 balance semantics, all-token fee reservations, exact history pagination,
filter/query limits, real HTTP forwarded-address handling, stalled headers and
body deadlines, UUID configuration, an existing-schema FK upgrade and orphan cleanup.

The fixtures contain public test addresses and signed bytes only. Never fund these
addresses or broadcast these signed transactions. The fixture transactions came
from CryptoJ JS 0.2.0 and were checked unchanged against 0.4.1 by the frontend suite.

For production PWA browser tests against the real local backend, build test classes
and generate the classpath:

```bash
mise exec -- ./mvnw test-compile dependency:build-classpath -Dmdep.outputFile=target/test-classpath.txt
mise exec -- java -cp "target/test-classes:target/classes:$(cat target/test-classpath.txt)" global.goldenera.wallet.E2eBackend 18084
```

The launcher binds the wallet to `127.0.0.1:18084`, creates a disposable PostgreSQL
container and starts a local synthetic node. Configure the PWA preview's API proxy
to use that address. The node fixture returns a native test token, synthetic balances,
fees, nonce, empty history and a successful **non-broadcasting** transaction response.
Stopping the launcher shuts down the Spring context, node fixture and container.

The final suite has 26 tests and requires Docker. In addition to phase 2 it rejects
nonempty incomplete upstream pages and checks encoded-route rate limiting on real
Tomcat. PostgreSQL's data directory is
mounted under `/var/lib/postgresql`, matching PostgreSQL 18's image layout. Migration
tests cover both fresh creation/replay and an isolated old schema upgraded to the
new cascade FK while retaining its account row. No production data is touched.

CryptoJ and RLP release provenance can be prepared without changing the user's
default Maven cache or requiring GitHub Packages credentials:

```bash
python3 tools/prepare-local-maven-artifacts.py --output /tmp/goldenera-wallet-public-maven-releases.tar
mkdir -p /tmp/goldenera-wallet-m2
tar -xf /tmp/goldenera-wallet-public-maven-releases.tar -C /tmp/goldenera-wallet-m2
mise exec -- ./mvnw -Dmaven.repo.local=/tmp/goldenera-wallet-m2 test
```

The helper downloads only the public CryptoJ0.0.5 and RLP0.0.1 release JARs,
requires their pinned SHA-256 values, extracts their embedded public POMs, and
creates Maven local-origin markers. Docker accepts this deterministic tar only
through the `local_maven_artifacts` BuildKit secret; its public tar hash is a build
argument so changing the secret cannot reuse a stale bootstrap layer.

After synchronizing the final production PWA and running `./mvnw clean verify`,
check every packaged asset (including the service worker and manifest):

```bash
python3 src/test/verify_packaged_pwa.py --jar target/goldenera-wallet-0.0.1.jar
```

The verifier rejects missing, changed, duplicate or stale extra files. It compares
the exact SHA-256 file map in `frontend/apps/web/dist`, Spring static resources and
`BOOT-INF/classes/static` in the executable JAR. An optional
`--http-origin http://127.0.0.1:18085` also checks every byte served by a separately
started local JAR. `--report path.json` writes the artifact hash and per-file evidence.
