# Závěrečná aktualizace aktivních GitHub Actions

Aktivní PWA/backend workflow bylo aktualizováno na poslední ověřené stabilní
Actions, připnuté celými commit SHA. Zdroj tag→SHA, release URL a výsledek kontroly
vstupů je v `implementation-final-ci-actions.json`. Žádný GitHub workflow, release,
push image ani cache purge nebyl v rámci této práce spuštěn.

| Action | Výsledná verze |
|---|---|
| actions/checkout | 7.0.1 |
| actions/setup-node | 7.0.0 |
| actions/setup-java | 6.0.0 |
| actions/cache | 6.1.0 |
| pnpm/setup | 2.1.0, nahrazuje pnpm/action-setup |
| docker/login-action | 4.6.0 |
| docker/setup-buildx-action | 4.3.0 |
| docker/metadata-action | 6.2.0 |
| docker/build-push-action | 7.3.0 |
| actions/upload-artifact | 7.0.1 |
| actions/download-artifact | 8.0.1 |

## Posouzené migrace

- [Checkout 7](https://github.com/actions/checkout/tree/v7.0.1) má bezpečnější
  výchozí chování pro fork PR pod privilegovanými triggers. Zde zůstává pouze
  původní push trigger; žádný unsafe opt-in nebyl přidán. Změna uložení credentials
  z v6 nevyžaduje úpravu těchto kroků, které neprovádějí authenticated git příkazy
  uvnitř Docker container action.
- [Setup-node 7](https://github.com/actions/setup-node/tree/v7.0.0) používá ESM/Node24.
  Není používán odstraněný `always-auth` ani dummy NODE_AUTH_TOKEN. Automatická
  package-manager cache je explicitně vypnuta; ruční pnpm cache krok zůstal zachován.
  Node 24.20.0 zůstává připnutý stejně jako před tímto dílčím CI krokem.
- [Setup-java 6](https://github.com/actions/setup-java/tree/v6.0.0) nemění zde použité
  vstupy `distribution=temurin`, `java-version=21`. Deprecated jdkFile input se zde
  nepoužívá. Credentials/settings krok a job permissions zůstaly stejné.
- Upstream [pnpm/action-setup](https://github.com/pnpm/action-setup/tree/v6.0.10)
  doporučuje pro pnpm11 přejít na [pnpm/setup](https://github.com/pnpm/setup/tree/v2.1.0).
  Nové `working-directory=frontend` ukazuje na skutečný manifest a `install=false`
  brání novému implicitnímu installu před cache restore. `cache=false` ponechává
  řízení pnpm store v existujícím explicitním cache kroku; následný install zůstává
  `pnpm install --frozen-lockfile`. Pnpm zůstává 11.24.0. Nová action ověřuje stažený
  self-contained pnpm podpisem/checksumem; zvláštní runtime není deklarován a
  `devEngines.runtime` v tomto manifestu není, takže Node instalaci zůstává na setup-node.
- [Upload-artifact 7](https://github.com/actions/upload-artifact/tree/v7.0.1) umí
  direct upload; zde je výslovně `archive=true`, aby zůstaly pojmenované ZIP artifacts
  `digests-amd64`/`digests-arm64`. [Download-artifact 8](https://github.com/actions/download-artifact/tree/v8.0.1)
  má explicitně `skip-decompress=false`, `digest-mismatch=error` a zachovává
  `pattern=digests-*`, `merge-multiple=true`. Nadále jde o GitHub.com artifacts,
  nikoliv nepodporovaný GHES v3 formát.
- Docker action vstupy byly porovnány s jejich skutečnými release manifests.
  Registry, credentials, Buildx driver options, platform matrix, tags, cache scopes,
  secret mounts a digest output zůstávají stejné. Nový automatický build-record
  upload je vypnutý, aby se nerozšiřoval dosavadní artifact scope. Nebyl přidán scoped
  registry login, který by mohl změnit přístup navazujícího manifest merge kroku.
- Starý [gh-actions-cache je archivovaný](https://github.com/actions/gh-actions-cache)
  a upstream doporučuje přímo GitHub CLI. Workflow purge nyní používá
  [`gh cache delete --all --succeed-on-no-caches`](https://cli.github.com/manual/gh_cache_delete).
  Ruční workflow_dispatch, doslovný DELETE guard a původní permissions jsou beze
  změny. Chyba CLI ukončí krok místo nekonečného opakování; prázdná cache uspěje.

## Validace

- **Actionlint 1.7.12 PASS** pro oba workflow soubory. Binárka pochází z oficiálního
  [release](https://github.com/rhysd/actionlint/releases/tag/v1.7.12); před spuštěním
  byla ověřena SHA-256 proti release checksums. Nástroj běžel pouze lokálně.
- YAML parser PASS. Každý použitý `with` input byl navíc ověřen proti oficiálnímu
  `action.yml` daného release, včetně nového pnpm/setup.
- Strukturní kontrola potvrdila nezměněné triggers, permissions, job dependencies,
  runner/platform matrix a DELETE guard.
- Do existujícího release workflow přibyla kontrola přesné shody finální PWA
  dist/static/JAR pomocí `src/test/verify_packaged_pwa.py`, před release kroky.
  Maven version extraction nyní rovněž používá připnutý `./mvnw`.

Všechny použité action manifests deklarují Node24. Vyžadují runner minimálně
2.327.1; zde jsou GitHub-hosted `ubuntu-latest` a `ubuntu-24.04-arm`, nikoliv vlastní
starý runner. Specifická podmínka checkout authenticated Git uvnitř container action
by vyžadovala 2.329.0, ale toto workflow ji nepoužívá.

Bez skutečného GitHub runu nebyl ověřen cache restore/save, credentials oprávnění
organizace, upload/download digest artifacts, multiarch Buildx push/manifest merge
ani reálná image verze hosted runneru. Tyto operace by měnily externí stav a nebyly
spuštěny jen kvůli validaci. Actionlint zde neměl volitelný ShellCheck executable;
není vydáván za dynamický shell nebo release test. Java/PWA lokální testy a artifact
ověření se vykazují v jejich samostatných finálních reportech.
