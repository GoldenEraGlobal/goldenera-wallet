# Wallet regression tests

Run from `frontend` with the project's supported Node/pnpm toolchain:

```sh
pnpm test
pnpm test:e2e
# After a fresh production web build:
WALLET_E2E_PRODUCTION=1 pnpm test:e2e
```

`fixtures/crypto-v0.2.0.json` contains PUBLIC deterministic BIP39 test vectors and
signed transactions. Never fund these addresses or broadcast these bytes. The
baseline was generated with the old frozen CryptoJ0.2.0; CryptoJ0.4.1 was checked
against the same addresses, transaction bytes/hashes and legacy encrypted vaults.
The signed transaction timestamp is fixed at1700000000000.

Unit and integration tests use real CryptoJ, WebCrypto, Zustand and the generated
Kubb transport. Storage/native APIs or axios adapters are replaced with isolated
in-memory fakes where the test states this. Browser E2E uses the actual PWA UI and
real browser crypto, an isolated profile, and blocks external origins. API
requests must match explicit fixtures. A successful mocked API result does not
prove an actual node would accept the transaction.

The recorded stage1 baseline had four expected failuresS2/S3/S5/S7. These
regressions are now enabled by default in stage2 and assert the safe behavior.
There is no remaining environment gate or expected-failure marker for them.

A service-worker release-update test additionally needs the built previous
release, kept separate from the current production output:

```sh
WALLET_E2E_PRODUCTION=1 WALLET_E2E_BASELINE_DIST=/absolute/path/to/previous/dist pnpm test:e2e
```

It serves both real builds on one temporary loopback origin and checks the new
controller/assets plus unchanged encrypted vault and recovered address.

Playwright browser installation is separate from npm dependencies:

```sh
pnpm exec playwright install chromium
```

On a minimal Linux host, install browser system prerequisites through the usual
approved environment mechanism. The review's WSL host instead used isolated
libraries in `/tmp`, not an OS package installation. It also required `TMPDIR=/tmp`
because the inherited Windows temp path was inaccessible. Physical fingerprint/
FaceID behavior and hardware authenticator security are not covered by mocks or
virtual WebAuthn.


The optional live MAINNET smoke is selected exclusively and requires a local
backend with an exact semantic-read outbound allowlist. It is never the target
of the synthetic transaction tests:

```sh
WALLET_E2E_PRODUCTION=1 WALLET_E2E_MAINNET_READONLY_URL=http://127.0.0.1:18086 pnpm test:e2e
```

An optional `WALLET_E2E_WATCH_ADDRESS` must be a public explorer address, never
its private key. Browser forwarding permits only known wallet GET paths;
transaction submission and other mutations are blocked. Device registration is
suppressed locally. The backend may use individually verified read-only bulk
POST endpoints, but must forbid all semantic mutations and redirects. Never
provide a production backend lacking these guards. Credentials stay exclusively
in the guarded backend environment and are not passed to the browser tests.
