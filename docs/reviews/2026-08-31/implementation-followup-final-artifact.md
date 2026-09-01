# Finální artifact po TypeScript7, Drawer a CryptoJ0.5

Datum:2026-09-01. Finální lokální artifact je hotový. Nebyl proveden commit, deploy, publish, registry push, MAINNET transakce, bezpečnostní audit, CVE/OSV ani container scan. `.env` nebyl čten ani použit; každý běh backendu měl explicitní syntetické loopback connection hodnoty.

## Finální vstupy

- PWA: zmrazenýVite8 dist poBase UI Drawer a`@goldenera/cryptoj@0.5.0`.
- PWA canonical manifest:30souborů, treehash `10e6a1eef5492288fc42045baa7c3f04f63eb47e1a4d6cbbf45296794c4d9a91`.
- Java:SpringBoot4.1.1,compiler`--release21`,JavaCryptoJ0.0.5 aRLP0.0.1.
- JavaCryptoJ nestedJAR SHA-256:`7d5eadaf13d4451d473e4eaf990dc52bedbde9fac3b13142f8f16e14f68ed30e`.
- RLP nestedJAR SHA-256:`6b026398f8c9a7fefd67b3acaeb55a845abd2999605928ab7ac92d50cb66fcd2`.

Currentdist před/po browser/fullstack testech zůstal30/30 přesně shodný. `frontend/scripts/sync-static.mjs` bezpečně synchronizoval pouze generated static tree a následný check prošel. [Aktuální static manifest](implementation-followup-final-static-manifest.json) se přesně shoduje s nezávislýmQA manifestem.

## Funkční checkpointy

| Kontrola | Výsledek |
|---|---|
| Frontend Vitest |114/114PASS |
| Standard production Chromium |25/25PASS |
| Drawer production Chromium/CDP touch |6/6PASS |
| Forward v1/v2/password/legacybio/PRF +realPRF |6/6PASS |
| Service-worker upgrade0.4.1→0.5 |1/1PASS |
| PWA→Boot4→PostgreSQL18.6/localnode fullstack |13/13PASS |
| Externí/Mainnet transaction submit |0 |
| Java21 cleanverify |28/28PASS,0fail/error/skip |
| License check |74/74OK |
| Java25 fulltest lifecycle |28/28PASS,0fail/error/skip |

Pro13fullstack byl současný`E2eBackend` znovu zkompilován naJava21 a spuštěn na127.0.0.1:18084 se skutečným disposablePostgreSQL18.6 Testcontainerem a lokálnímHTTP node stubem. Všechny environment placeholdery byly explicitně syntetické a Spring CLI properties přepsaly datasource/node na loopback. Po13/13 byly JavaPID3163104, port18084, PostgreSQLcontainer`9a6611e…` iRyuk`85f935…` ukončeny/odstraněny.

## JAR

Finální spustitelný artifact:

- [goldenera-wallet-0.0.1.jar](/home/andrej/Projects/goldenera/goldenera-wallet/target/goldenera-wallet-0.0.1.jar)
- size:`113470293`bytes
- SHA-256:`c71251319409b4d7c74c8dc10f1ed36832b05489dbd007c3e0d71e1cbca44f3f`
- Application class major65(Java21)

`mise exec java@openjdk-21.0.2 -- ./mvnw -o -Dmaven.repo.local=/tmp/wallet-followup-m2 clean verify` proved a clean package from currentstatic tree. Spring Boot repackaged JAR containsJavaCryptoJ0.0.5/RLP0.0.1 with the exact hashes above. `src/test/verify_packaged_pwa.py` confirmed exact file set andSHA fordist/static/`BOOT-INF/classes/static`:30/30.

The actual JAR was then run on127.0.0.1:18085 against a separately named disposablePostgreSQL18.6 container on a random loopback port. NodeURL was explicitly`http://127.0.0.1:9`; subscription retries correctly failed locally and never reached another origin. The verifier fetched every asset from the actualSpring HTTP server with redirects/proxies disabled: **30/30HTTP200 and byte-for-byte exact**. JavaPID3169737, port18085 and artifactPGcontainer`e30ca38…` were then stopped/removed.

## Docker

A fresh local single-architecture build completed:

- tag:`goldenera-wallet:local-final-20260901`
- platform:`linux/amd64`
- imageID/digest:`sha256:5353a18d65ac562f0aecc6c528efcc828c2711448c540a4703f9b25061cffc83`
- runtime:TemurinOpenJDK25.0.4+7LTS
- extracted imageJAR SHA-256:`8f632ad3c8293588c7e1aadac862567d4e7bd51326f516e563fe53b31aef9f7e`

`tools/prepare-local-maven-artifacts.py` vytvořil pouzeCryptoJ0.0.5/RLP0.0.1 bootstrap tar se zabudovanýmiPOMs. VstupníJARy zisolatedM2 byly helperem znovuověřeny proti připnutýmSHA; tar SHA-256 byl`464b8285026faee8fd89e5d32024415da4f4697cb44cbdf37c3d483795785117` aDocker BuildKit secret check prošel. Nebyl předánGitHubtoken.

Dockerfrontend provedl frozenpnpm install aVitebuild zcurrentsource; backend provedl package beztestů po jižzelenýchhostJava21/25 bězích. JAR vyjmutý zpřesnětohotoimage má30/30PWA assets shodných scanonicaldist/static. Jednorázový`java -version` container iinspect container byly odstraněny. Image zůstává pouze lokálně; nebyl scanován ani pushnut.

LokálníJAR aDockerJAR nejsou byteidentické, protože vznikly vsamostatných Maven/Java build prostředích, ale oba obsahují přesně stejných30PWA souborů a stejné připnutéCryptoJ/RLP artifacts.

## CI statická kontrola

Actionlint1.7.12PASS prooba workflows, YAML parsePASS a struktura potvrzuje instalaciChromium+Firefox, productionChromium job a samostatnýFirefox smoke. GitHub-hosted workflow nebyl spuštěn; cache/artifact permissions ani registry release/push se proto nevydávají za runtimeověřené.

## Evidence a úklid

- [Strojový artifact souhrn](implementation-followup-final-artifact.json)
- [Static manifest](implementation-followup-final-static-manifest.json)
- [Cleanup stav](implementation-followup-final-cleanup.json)
- `/tmp/goldenera-wallet-cryptoj050-final-dist-manifest.json`
- `/tmp/goldenera-wallet-cryptoj050-fullstack13.json`
- `/tmp/wallet-cryptoj050-final-java21-clean-verify.log`
- `/tmp/wallet-cryptoj050-final-java25-test.log`
- `/tmp/wallet-cryptoj050-final-jar-http-verify.log`
- `/tmp/wallet-cryptoj050-final-docker-build.log`

Všechny vlastníE2E/JAR-smoke PIDy a kontejnery byly ověřeně ukončeny. LokálníDocker image afinálníJAR jsou záměrněponechané jako výsledné artifacts.
