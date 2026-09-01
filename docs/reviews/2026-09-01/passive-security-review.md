# Passive local boundary review — PWA and backend

Date: 2026-09-01

## Scope and method

This was a passive review of local source code plus synthetic loopback tests. It did not run a vulnerability scanner, advisory/CVE lookup, dependency audit, port scan, external probe, or mainnet request. The repository `.env` was not read. No production transaction was created or sent. Native applications and the browser extension remained outside the active product scope.

The review was deliberately limited to three confirmed boundary issues found while reading the PWA/backend code. No speculative findings were added.

## Finding 1 — node API credentials could follow a redirect

The production node `HttpClient` used automatic redirects while `RestClient` attached the node API key as a default header. A synthetic two-origin loopback reproduction confirmed that a cross-origin 302 could carry the header from origin A to origin B.

The client now uses `HttpClient.Redirect.NEVER`. A response interceptor rejects every 3xx response before body decoding, keeps the response read bounded, and returns a sanitized application error. This does not change successful 2xx node calls.

Regression evidence: `NodeRedirectSecurityTest` starts two isolated loopback origins, confirms origin A receives the synthetic key, confirms origin B receives zero requests and no key, and confirms the wallet rejects the redirect. Result: **1/1 PASS**.

## Finding 2 — public write endpoints accepted unbounded or under-validated bodies at unit cost

The transaction DTO/controller path had no bean validation, request bodies were not bounded before JSON deserialization, and transaction submission plus webhook receipt consumed the default throttling cost of one. Large declared or chunked requests could therefore consume disproportionate memory/work before normal validation.

The backend now applies a pre-deserialization bounded read to public core POST/PUT/PATCH bodies. Endpoint limits are 256 KiB for the signed-transaction JSON envelope, 16 KiB for device registration, and 16 MiB for webhook/default core bodies. The webhook limit is intentionally conservative because the local node contract can deliver lists containing full block or transaction DTOs. Tomcat's rejected-body swallow limit is also bounded at 16 MiB.

`TxSubmitDtoV1` is required, limited to the consensus-compatible maximum of 200,002 hex characters including `0x`, and must contain non-empty even-length hexadecimal bytes. The business service independently decodes the transaction, enforces the node's 100,000-byte maximum, and requires a valid signature before forwarding. Validation failures now consistently return HTTP 400. Submit and webhook requests each consume ten public-core tokens.

Regression evidence covers declared and chunked HTTP 413, invalid JSON/hex HTTP 400, zero node calls for rejected input, the largest valid consensus-size transaction forwarded exactly once to a local stub, unchanged raw-byte webhook HMAC verification, and weighted submit/webhook throttling. Result: **8/8 targeted integration scenarios PASS**.

## Finding 3 — static PWA responses lacked browser isolation headers

The admin and core API chains were explicit, but the remaining static/PWA route had no dedicated security filter chain. Production HTML and assets therefore lacked a consistent CSP and framing policy.

A final catch-all chain now permits public PWA resources while adding `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a minimum permissions policy for same-origin camera, clipboard write, and WebAuthn. The CSP keeps scripts/connections/workers same-origin, blocks objects and frames, limits forms and base URIs, and includes `wasm-unsafe-eval` because the installed barcode polyfill uses ZXing WebAssembly. Existing cache/service-worker behavior remains enabled.

Regression evidence includes MockMvc plus real Spring HTTP header assertions and a headless Chromium run against the synthetic local backend. Chromium loaded the production PWA with its service worker, reported zero unexpected console/page errors, exposed QR support through the barcode polyfill, and refused to render the wallet in an iframe. Result: **browser check PASS**.

## Final verification

- TypeScript 7 production typecheck: **4/4 workspace tasks PASS**.
- Production PWA build and static sync: **PASS; 30/30 files match**.
- Java 21 `clean verify`: **34 tests PASS, 0 failures, 0 errors, 0 skipped**.
- License check: **75/75 Java files PASS**.
- Packaged artifact: `target/goldenera-wallet-0.0.1.jar`; production PWA dist/static/JAR bytes match for **30/30 files**; SHA-256 `c42b68aa2aa4b5e5d1838d7df79fa30594d0a50c38e9f1f9bf363b73ee0c361d`.

These changes do not alter the encrypted vault record, mnemonic derivation, local-storage keys, or wallet database schema. Existing PWA wallets therefore keep their stored wallet and unlock path. The stricter request boundary only rejects malformed or oversized requests that should not have been accepted.

## Local Docker artifact

A fresh credential-free single-architecture image was built from the final source tree. No scan, audit, push, deploy, or multi-architecture build was performed.

- Tag: `goldenera-wallet:local-final-passive-20260901`.
- Platform: `linux/amd64`.
- Local image ID and repo digest: `sha256:20388e68308255092697ec22557da1f70d416e32cb1ff8f48023c501b27c3d92`.
- Runtime: Eclipse Temurin OpenJDK `25.0.4+7-LTS`.
- Extracted image JAR SHA-256: `97944b797b7baa0b8330512269d51a64030fbef336bde2ed62ab3aa6a76bd649`.

The Docker build accepted only a checksum-verified public CryptoJ 0.0.5/RLP 0.0.1 bootstrap tar, SHA-256 `464b8285026faee8fd89e5d32024415da4f4697cb44cbdf37c3d483795785117`. The nested image artifacts match the pinned release hashes: CryptoJ `7d5eadaf13d4451d473e4eaf990dc52bedbde9fac3b13142f8f16e14f68ed30e` and RLP `6b026398f8c9a7fefd67b3acaeb55a845abd2999605928ab7ac92d50cb66fcd2`. The build-context guard confirmed that no `.env` file entered the context, and no GitHub token or other credential was supplied.

The image JAR contains the exact same 30 production PWA files as dist/static. Seven of the ten directly affected backend classes are byte-identical to the Java 21 host JAR. `SecurityConfig`, `WalletBusinessService`, and `ThrottlingService` differ only in synthetic lambda numbering emitted by the JDK 21 and JDK 25 compilers; normalized `javap -p -c -constants` output is identical. All ten affected classes use class-file major 65 (Java 21).

The repository has no short standalone image smoke helper that provisions both an isolated PostgreSQL and mock node. A second application-stack startup was therefore not improvised. Runtime `java -version`, image content, PWA bytes, class bytecode, and nested library hashes were checked; the same source tree already passed the synthetic Spring/PostgreSQL/browser run described above. The temporary inspect and runtime containers were removed, while the final local image remains available.

## Residual limits

- Clipboard export remains an explicit user action. The browser policy permits same-origin clipboard writes needed by the UI; operating-system clipboard lifetime is outside the application's control.
- A correctly signed webhook can be replayed inside the existing five-minute timestamp window. The current webhook event handler is side-effect-free, so this has no state effect today. Add a stable delivery identifier and deduplication before introducing side effects.
- Physical biometric hardware, real camera hardware, and platform WebView behavior were not exercised. Browser barcode availability and iframe/CSP behavior were verified in headless Chromium only.
