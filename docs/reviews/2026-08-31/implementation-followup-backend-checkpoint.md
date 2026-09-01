# Funkční backend checkpoint před Drawer migrací

Checkpoint byl proveden 1. 9. 2026 pouze jako běžné funkční ověření. Nebyl
spuštěn advisory, CVE, OSV ani container/image scan, nic nebylo publikováno a
nebyl použit mainnet ani produkční `.env`.

## POM, toolchain a veřejné release artifacts

- Wallet používá `global.goldenera.cryptoj:goldenera-cryptoj:0.0.5` a jeho
  tranzitivní `global.goldenera.rlp:goldenera-rlp:0.0.1`.
- Offline `dependency:tree` nad izolovaným `/tmp/wallet-followup-m2` potvrdil
  přesně tuto dvojici.
- SHA-256 skutečně použitých veřejných JARů v izolovaném cache:
  - CryptoJ 0.0.5:
    `7d5eadaf13d4451d473e4eaf990dc52bedbde9fac3b13142f8f16e14f68ed30e`
  - RLP 0.0.1:
    `6b026398f8c9a7fefd67b3acaeb55a845abd2999605928ab7ac92d50cb66fcd2`
- POM byl opraven z `source`/`target` na `maven.compiler.release=21`. Oba nové
  běhy hlásily `javac [debug parameters release 21]`; výsledná aplikační class
  má major version 65 (Java 21). Tím Java 25 build nekontroluje jen bytecode,
  ale také Java 21 API surface.
- Uživatelský defaultní Maven cache ani vydané artifacts nebyly přepsány.

## Nové běhy

| Prostředí | Příkaz / rozsah | Výsledek |
|---|---|---|
| OpenJDK 21.0.2 | offline isolated-M2 `clean verify` | **PASS**, 28/28 testů, 0 failures/errors/skipped, executable JAR, license check 74/74; 36.805 s |
| Temurin 25.0.4.1 LTS | offline isolated-M2 celý `test` lifecycle | **PASS**, 28/28 testů, 0 failures/errors/skipped; 29.101 s |

Oba běhy použily skutečný lokální PostgreSQL 18.6 Testcontainer a Tomcat
11.0.24. Upstream node byl pouze syntetický lokální fixture. Test submitu končí
v lokálním stubu; žádná transakce ani jiná operace nešla na mainnet.

## CI a Docker checkpoint

- Actionlint 1.7.12: **PASS** pro `build-and-release.yml` i
  `purge-cache.yml`.
- Lokální YAML parse: **PASS** pro oba workflow soubory.
- Strukturní kontrola potvrdila Java 25.0.4.1 `clean verify`, instalaci Chromium
  i Firefox přes Playwright, produkční Chromium E2E a samostatný Firefox smoke
  s `WALLET_E2E_CROSS_BROWSER=1`. Hosted GitHub workflow nebyl spuštěn.
- Aktuální `.dockerignore` vylučuje `.env`, `.env.*` i jejich vnořené varianty.
  Dockerfile stále přijímá pouze checksumem ověřený veřejný CryptoJ/RLP tar přes
  BuildKit secret a nekopíruje celý kontext. Statická kontrola této konfigurace
  prošla.
- Nový Docker build nebyl spuštěn: současný single-arch credential-free build a
  runtime už mají uložený **PASS** v
  `implementation-followup-docker-artifact.json` a
  `implementation-followup-docker-runtime.json`; bezprostřední Drawer změna PWA
  by jeho frontend bytes stejně změnila.

Předchozí `13/13` full-stack a `1/1` mainnet read-only výsledek jsou převzaté
z dokončeného follow-upu a nebyly v tomto krátkém checkpointu vydávány za nový
běh. Finální dist/static/JAR hash se záměrně odkládá až za Drawer migraci.
