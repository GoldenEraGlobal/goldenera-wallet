# GoldenEra Wallet — návrh aktualizací PWA a Java backendu

**Aktivní rozsah podle upřesnění uživatele: výhradně PWA (`frontend/apps/web` a sdílené api/core/ui) a Java backend. Nativní Android/iOS aplikace a browser extension jsou předpřipravené a mimo aktivní vývoj; jejich specifické migrace jsou níže odložená roadmapa, ne blokery vydání PWA/backendu.** Úplný inventář i audit zůstávají referencí celého workspace.

Pouze analýza, žádná závislost, lockfile ani zdroj v repozitáři nebyl tímto subagentem změněn. Stav ověřen 31. 8. 2026 přibližně 18:06 UTC; HTTP Date npm/Maven odpovídá systémovému datu. „Latest“ znamená stabilní release v registru, nikoli automatické doporučení pro tuto aplikaci. Npm `latest` tag byl ověřen veřejnými GET dotazy, u Maven byly vyřazeny milestone/RC/beta verze. Ve veřejném Maven Central chybí interní CryptoJ; jeho nejnovější GitHub Packages verzi jsem neověřil.

**Referenční inventář celého workspace, nikoliv pouze aktivní PWA:** obsahuje všech 100 unikátních externích npm názvů ze šesti manifestů včetně peer závislostí, pnpm toolchainu a skutečného alias balíčku rolldown-vite; 34 unikátních Maven souřadnic včetně parentu, pluginů a annotation processorů. Workspace balíčky @project/api/core/ui jsou lokální, nemají veřejnou latest verzi. Tabulka uvádí manifestové rozsahy a skutečné pnpm-lock verze; Maven „resolved“ u spravovaných závislostí je odvozeno z lokálního Boot3.5.8 BOM, není to nově spuštěný effective dependency tree. Úplné cesty použití, peerDependencies, engines, registry datum a odkazy jsou v JSON/TSV.

## Rozhodnutí, která brání prostému „update everything“

1. **TypeScript7.0.2 a ESLint10.9.1 nelze bezpečně dosadit do stávající lint sestavy.** Latest typescript-eslint8.69.0 má peer TypeScript >=4.8.4 <6.1.0; latest eslint-plugin-react7.37.5 končí podporou ESLint9.7+. Doporučen mezikrok TS6.x s moderním typescript-eslint, ale ESLint9.39.5. TS7 lze později instalovat odděleně pro tsc při zachování TS6 API pro nástroje; není to prostý bump stejného balíčku. [TypeScript7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [ESLint10](https://eslint.org/docs/latest/use/migrate-to-10.0.0), [typescript-eslint registry](https://registry.npmjs.org/typescript-eslint), [react plugin registry](https://registry.npmjs.org/eslint-plugin-react).
2. **PWA: Vite8.2.2 nahradí deprecated rolldown-vite7.3.1 alias.** Web používá standardní `react()`; jeho konfigurace nemá Babel React Compiler, takže odstranění `babel` option v React pluginu6 **není blocker PWA migrace**. S Vite8 sladit plugin-react6, vite-plugin-pwa/Workbox a Tailwind. Ve web configu je funkční `manualChunks`, ve Vite8 deprecated: naplánovat `codeSplitting`. Default browser target se posouvá na Safari16.4/Chrome111; vědomě stanovit podporované PWA browsery, ověřit Safari a instalovaný standalone režim. Extension React Compiler/CRXJS jsou samostatná odložená roadmapa. [Vite8 migrace](https://vite.dev/guide/migration), [React plugin changelog](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/CHANGELOG.md).
3. **Stackflow je skutečný přepis routeru.** React1.12->2.1, config1->2, core1->3 a history1->2 patří do jedné změny. Nové API používá `stackflow({config,components})`, odstraňuje `useActions` a návratové `useFlow`, a typy aktivit se registrují v configu. Zasažen `frontend/packages/core/src/router/stackflow.tsx:209`, další dvě vytvoření stacku, `router/useFlow.ts:1` a stránky s `ActivityComponentType`. Vlastní `CleanableHistory` má vlastní popstate/index/instance synchronizaci; nová snapshot reconciliace musí projít scénáři Back/Forward, přihlášení, backup stack, browser Back a obnovení PWA. [React changelog](https://raw.githubusercontent.com/daangn/stackflow/main/integrations/react/CHANGELOG.md), [History changelog](https://raw.githubusercontent.com/daangn/stackflow/main/extensions/plugin-history-sync/CHANGELOG.md).
4. **Kubb5 není sada nezávislých bumpů pluginů.** `@kubb/plugin-oas` zůstává latest4.39.3, ale ve v5 se odstraňuje ve prospěch OpenAPI adapteru; nový vstup přes `kubb` dodává infrastrukturu. `pluginReactQuery.client` již není objekt `{importPath: '../../../client'}` z `frontend/packages/api/kubb.config.ts:31`, ale volba registrovaného axios/fetch pluginu. Přepsat custom client integraci a ověřit QueryKey transformer, `Hook` suffixy, grouping, nullable modely a query invalidace v celém core. Generovat z uložené schválené OpenAPI specifikace, ne náhodně spuštěného localhost serveru. [Kubb5 migration](https://next.kubb.dev/docs/5.x/migration).
5. **Spring Boot3.5.16 je krátký mezikrok, ne dlouhodobý cíl.** Je poslední OSS3.5 release; pro další OSS opravy je nutná řada4.0 nebo4.1. Cíle stable4.0.8/4.1.1; registry „release4.2.0-M1“ je milestone a v návrhu se nepoužívá. Java21 může zůstat. [Spring oznámení konce podpory3.5](https://spring.io/blog/2026/06/25/spring-boot-3-5-16-available-now/).

Konkrétní TS nastavení k opravě: Aktivní sdílený `frontend/tsconfig.json:22` používá `baseUrl`; stejný problém v `frontend/apps/extension/tsconfig.app.json:10` je odložen s extension. TypeScript6 je deprekuje a7 odstraňuje; přepsat `paths` relativně ke configu, zkontrolovat ne-relativní importy a neřešit trvale jen umlčením deprecations. TS6 také mění výchozí `types`, `rootDir` a strict volby: app configy část explicitně nastavují, sdílené configs prověřit zvlášť. Tsc7 nemá původní stabilní TypeScript JS compiler API, na němž stojí lint/generátory; staré `tsup` či generační nástroje proto neověřovat pouze podle širokého semver peer rozsahu. [TypeScript6 změny](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/).

**Past i pro patch aktualizace Stackflow:** latest `@stackflow/plugin-basic-ui`1.18.4 a oba renderer pluginy1.1.16 deklarují peer `@stackflow/react:^2.0.0`, core `^2 || ^3`; v projektu je React integrace1.12/core1.3. Běžný caret update podle stávajících manifestů tak může přinést pluginy pro jinou generaci API, i bez úmyslného major bumpu. Lockfile chrání aktuální frozen instalaci; při refreshi explicitně držet kompatibilní sadu. Zjištění je přímo z registry `peerDependencies` uložených v inventáři.

## Backend: konkrétní nutné změny

V POM je už nyní několik verzí mimo koordinovaný BOM. Boot3.5.8 spravuje Jackson2.19.4, ale XML bind modul má2.20.1; Hibernate Validator by byl8.0.3.Final, ale projekt žádá9.1.0.Final, zatímco Jakarta Validation API z Boot3.5 je3.0.x. Validator9.1 implementuje Validation3.1; jde o existující kompatibilitní riziko, ne důkaz konkrétního runtime pádu v tomto reportu. Nejprve tyto override vědomě odstranit/sladit, nepřidávat další nezávislé latest. [Hibernate Validator požadavky](https://hibernate.org/validator/releases/).

Ověřené BOM kombinace (přímo POM z Maven Central):

| Boot | Framework | Hibernate ORM | Validator | Jackson | Liquibase | Micrometer |
|---|---|---|---|---|---|---|
|3.5.16|6.2.19|6.6.53.Final|8.0.3.Final|2.21.4|4.31.1|1.15.12|
|4.0.8|7.0.9|7.2.24.Final|9.0.1.Final|3.1.5 (+2.21.5 compatibility)|5.0.3|1.16.7|
|4.1.1|7.0.9|7.4.5.Final|9.1.3.Final|3.1.5 (+2.21.5 compatibility)|5.0.3|1.17.1|

Zdroj např. [Boot4.1.1 BOM](https://repo.maven.apache.org/maven2/org/springframework/boot/spring-boot-dependencies/4.1.1/spring-boot-dependencies-4.1.1.pom); soubory všech tří BOM jsou v `/tmp/wallet-upgrade-sources/`.

- Boot4 zavádí samostatné moduly/starters: převést web starter na webmvc, přidat Liquibase starter pro automatické spouštění migrací, zachovat potřebnou validaci a ověřit REST client konfiguraci. `Application.java` importuje `org.springframework.boot.autoconfigure.domain.EntityScan`, který je nutné přizpůsobit novému umístění. Spring Retry přestává být spravováno BOM, takže současná dependency bez verze musí dostat explicitní2.0.13 nebo být nahrazena retry API Framework7. Všechny `service/node/*` mají Retryable/Backoff; přesun anotací nesmí změnit počet pokusů a idempotenci. [Boot4 migration](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide).
- Jackson3 je největší Java zásah: `config/JacksonConfig.java` používá Jackson2 builder, ObjectMapper, vlastní serializers/deserializers a mixins pro CryptoJ. `NodeWebhookApiV1.java` a `ExceptionHandlerConfig.java` pracují se stejným mapperem. Převést core/databind importy na `tools.jackson`, builder konfiguraci a bean na nový JsonMapper; běžné `com.fasterxml.jackson.annotation` anotace zůstávají. Dočasná Jackson2 kompatibilita je možná, musí být vědomě oddělena od MVC Jackson3, jinak vlastní serializéry nemusí řídit skutečný HTTP JSON. Porovnat wei jako string, Hex/Address, Instant, polymorfní payloady a chybové odpovědi byte-for-byte. [Jackson3 migration](https://github.com/FasterXML/jackson/blob/main/jackson3/MIGRATING_TO_JACKSON_3.md).
- Hypersistence artifact musí odpovídat ORM: `hibernate-63` pro6.6, `hibernate-71` pro7.2, `hibernate-73` pro7.4. Používají se `BaseJpaRepository` a `BaseJpaRepositoryImpl`, proto nejde o nepoužitý transitivní detail. Dále řešit `liquibase-hibernate6` v runtime i Maven pluginu a ověřit dostupný kompatibilní Hibernate7 extension; konkrétní cílovou verzi této náhrady jsem neověřil. `pom.xml` referenceUrl navíc používá starou `SpringPhysicalNamingStrategy`, před generováním diffu zkontrolovat platnou naming strategy, aby se nevygenerovalo falešné přejmenování schématu. [Hypersistence matrix](https://github.com/vladmihalcea/hypersistence-utils).
- Springdoc2.8.9 ->2.9.0 je varianta pro Boot3;3.1.0 je varianta pro Boot4. OpenAPI generator7.17->7.25 mění generovaný Java klient: po regeneraci porovnat request parametry a numeric/nullable návratové typy s reálným node API. Frontend Kubb migraci nemíchat do stejného velkého diffu jako změnu JSON kontraktu. [Springdoc](https://springdoc.org/), [OpenAPI generator releases](https://github.com/OpenAPITools/openapi-generator/releases).
- Liquibase5.0.1 už je v projektu; nejde o migraci4->5. Patch5.0.4 posuzovat s core, Maven pluginem a Hibernate extension společně, nebo zůstat na cílovém Boot BOM5.0.3. Spustit na kopii skutečné PostgreSQL databáze `validate`/update a ověřit nové instalace i již existující changelog checksums; nikdy nepouštět diff/DDL na produkci jako část review. [Liquibase releases](https://docs.liquibase.com/community/release-notes).

## Crypto, UI, data a bezpečnost aktualizací

CryptoJ JS0.4.1 byl publikován právě31.8.2026 v18:00 UTC. Ve veřejném porovnání0.2.0...0.4.1 se nezměnily `PrivateKey.ts`, `TxBuilder.ts` ani `TxEncoder.ts`; mění se RLP decoding/payload codecs, přibývají state/payload V2 a mining reward vesting. `WalletUtil` proto podle source diffu nepotřebuje automaticky nový způsob derivace, ale musí mít regresní vectors pro mnemonic->address, transfer RLP/signature/hash a Java kompatibilitu. `TxSubmitCard.tsx:332` stále explicitně sestavuje TRANSFER/MAINNET a podepisuje; samotný update nevyřeší chybné zobrazení/spendable zůstatku. Interní Java CryptoJ0.0.1 se musí vydat jako rozlišitelný artifact sladěný s node; latest Maven GitHub Packages neověřeno. [Veřejný source diff](https://github.com/GoldenEraGlobal/goldenera-cryptoj-js/compare/v0.2.0...v0.4.1).

Bouncy Castle1.81->1.85.2, Tuweni2.7.2->2.8.0 a Web3j5.0.1->6.0.0 řešit jako jednu kryptografickou sadu s dependency convergence a vectors, ne jako změnu matematických algoritmů. Web3j5.0.3 už ve svých širších modulech přešel na Jackson3; dopad na zde používaný `crypto` artifact je třeba ověřit dependency tree. [Web3j6 release](https://github.com/LFDT-web3j/web3j/releases/tag/v6.0.0).

React19.2.4->19.2.8 je patch; RSC server runtime se v manifestu aplikace nepoužívá, proto RSC advisories nelze automaticky prezentovat jako zranitelnost této SPA. Motion12->13 odstraňuje automatický optional Emotion filtr; projekt importuje `motion/react` ve vlastním family-drawer, nevidím přímou Emotion/Styled Components dependency, takže očekávám omezený zásah, ale vyžaduje vizuální test. UUID14 zachovává v4 volání v DeviceService, vyžaduje global crypto a Node20+. Shadcn4 je CLI update: existující komponenty jsou zdrojové kopie, aktualizace balíčku je sama nemodernizuje. Pro Lucide1 jsem ověřil latest, ale nikoliv kompletní migration seznam exportů; po updatu je nutný tsc a kontrola všech ikon. [Motion13](https://motion.dev/docs/react-upgrade-guide), [UUID14](https://github.com/uuidjs/uuid/blob/main/CHANGELOG.md).

**Aktualizovaný bezpečnostní audit:** Po výslovném souhlasu uživatele proběhl `pnpm audit --json` nad zamčenou sestavou **celého frontend workspace včetně neaktivní extension a native tooling**. Výsledek `/tmp/goldenera-wallet-review/npm-audit.json`:1349 dependencies,203 hlášených findings/cest **za celý workspace, nikoli počet pro PWA** (critical4/high92/moderate96/low11),199 advisory records,180 unikátních GHSA/URL a42 názvů balíčků. Exit1 odpovídá nálezům, nejde o neprovedený scan ani audit clean. Předchozí zamítnutý export byl následně uživatelem explicitně autorizován. Čtyři critical se týkají protobufjs/Firebase, websocket-driver/Firebase, shell-quote/Kubb a tar/Capacitor CLI; samy nedokládají čtyři zneužitelné critical chyby produkční wallet. Axios1.13.4 je skutečně používaná runtime knihovna s více advisories, prioritně cílit1.20.0. Detailní podmínky, přímé cesty, patch minima a oddělení runtime od development jsou v `/tmp/goldenera-wallet-audit-analysis.md`; redigovaný snapshot v `docs/reviews/2026-08-31/npm-audit-summary.json`. Maven/native/container security scan tento npm výsledek nenahrazuje.

## Aktivní runtime a CI pro PWA/backend

- Node v Dockerfile/CI je22, lokálně mise poskytuje24.19.0. Oficiální release index při kontrole uvádí LTS24.20.0 a Current26.8.1. Doporučuji sjednotit CI/Docker/dev na konkrétní24 LTS patch a odpovídající @types/node24, případně vědomě ponechat22 s aktuálním patchem. Node26 latest types neodpovídají deployed22. [Node release index](https://nodejs.org/dist/index.json).
- Pnpm10.28.2 -> mezikrok10.34.5 nebo plánovaně11.24.0. Pnpm11 mění `onlyBuiltDependencies` ve `frontend/pnpm-workspace.yaml` na `allowBuilds`, jiné nastavení přesouvá z .npmrc do workspace YAML, zavádí nový store a standardní minimální stáří release. `Dockerfile:5` bootstrapuje `pnpm@latest`, zatímco manifest pin je10.28.2: připnout bootstrap a respektovat packageManager, neponechat build závislý na dnešním latest. Čerstvý CryptoJ0.4.1 může být blokován release-age ochranou; raději vyčkat nebo schválit konkrétní výjimku, nevypínat ochranu globálně. [pnpm11 notes](https://github.com/pnpm/pnpm.io/blob/main/blog/releases/11.0.md).
- Java target/runtime21 zachovat pro první kroky; Maven Docker tag3.9 je pohyblivý, stable Maven metadata ukazují3.9.16. Compiler plugin3.15.0 je stable větev Maven3;4.0-beta5 nebrat. Temurin JRE patch/base Alpine digest nebyl přes registry image manifesty ověřen; před nasazením připnout vhodný digest a naskenovat image, nikoliv jen Java knihovny.
Capacitor knihovny nelze plošně vyřadit z aktivního PWA scope podle názvu: web používá jejich browser adaptéry/fallbacky např. pro storage a kameru. Aktivně ověřit tyto webové větve a zachování browser vaultu. Synchronizace pods/Gradle, native biometrie a mobilní binárky jsou odloženy níže.

README používá `postgres:18.1-alpine` (`README.md:64`); oficiální image má stable18.6. Ještě před patch aktualizací je nutné opravit volume `./db_data:/var/lib/postgresql/data` (`README.md:75`): od18 PGDATA leží v `/var/lib/postgresql/18/docker`, volume má mířit na `/var/lib/postgresql`. Aktuální entrypoint nepoužitý starý mount dokonce odmítá při init. Existující data nezahazovat ani nepřesouvat bez zálohy/migračního postupu. [Postgres official image](https://hub.docker.com/_/postgres), [entrypoint](https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh).

GitHub Actions latest stabilní releasy byly dodatečně ověřeny veřejným GitHub API. Jde o velké skoky: doporučen samostatný Actions update s SHA pinem, kontrolou Node runtime požadavků runneru a testem cache/artifact předávání mezi release jobs. Konkrétní minimum self-hosted runneru a celý součet breaking changes všech přeskočených majorů nebyl ověřen; samotný latest tag není důkaz kompatibility.

| Action | Repo | Latest stable | Dopad k ověření |
|---|---|---|---|
| [actions/checkout](https://github.com/actions/checkout/releases/tag/v7.0.1) | v4 | v7.0.1 | checkout credentials, bezpečnost PR fetch a runner runtime |
| [actions/setup-node](https://github.com/actions/setup-node/releases/tag/v7.0.0) | v4 | v7.0.0 | ESM; cache outputs, odstraněný dummy NODE_AUTH_TOKEN |
| [actions/setup-java](https://github.com/actions/setup-java/releases/tag/v6.0.0) | v4 | v6.0.0 | ESM, jdkFile alias -> jdk-file; repo používá distribution temurin |
| [actions/cache](https://github.com/actions/cache/releases/tag/v6.1.0) | v4 | v6.1.0 | cache access/read-only režim a cache key kontinuita |
| [pnpm/action-setup](https://github.com/pnpm/action-setup/releases/tag/v6.0.10) | v4 | v6.0.10 | release odkazuje na nástupce pnpm/setup; zvolit migraci zvlášť, zachovat packageManager pin |
| [docker/login-action](https://github.com/docker/login-action/releases/tag/v4.6.0) | v3 | v4.6.0 | registry credential scopes a buildx auth |
| [docker/setup-buildx-action](https://github.com/docker/setup-buildx-action/releases/tag/v4.3.0) | v3 | v4.3.0 | builder driver, platformy, BuildKit a runner |
| [docker/metadata-action](https://github.com/docker/metadata-action/releases/tag/v6.2.0) | v5 | v6.2.0 | tag/label outputs použité navazujícím buildem |
| [docker/build-push-action](https://github.com/docker/build-push-action/releases/tag/v7.3.0) | v5 | v7.3.0 | build contexts, secret předání, cache, digest a multiarch manifest |
| [actions/upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) | v4 | v7.0.1 | direct upload/API a návazné download jobs |
| [actions/download-artifact](https://github.com/actions/download-artifact/releases/tag/v8.0.1) | v4 | v8.0.1 | artifact formát/jméno a návaznost na upload major |


## Aktivní pořadí aktualizací PWA a backendu

1. **Baseline a rychlé bezpečnostní patche:** funkční PWA typecheck/lint, testy vaultu/auth/signing a uložené API fixtures. Prioritně Axios1.20.0, React19.2.8, PostCSS8.5.26 a kompatibilní transitivní patche. Ověřit browser aktualizaci nad existujícími uloženými daty; nativní ani extension build není přijímací podmínkou této fáze.
2. **PWA build:** web alias rolldown-vite -> Vite8.2.2, plugin-react6, vite-plugin-pwa/Workbox, Tailwind; web build+tsc, offline režim, update service workeru, reload, Safari/Chromium a standalone PWA. Není potřeba nyní řešit Babel compiler konfiguraci extension ani CRXJS.
3. **Sdílené nástroje:** TS6/typescript-eslint s kompatibilním ESLint9; TS7 pouze po posouzení compiler API podpory. Pnpm11 odděleně, pin packageManager a čistý Docker frozen install. Sdílený lock může změnit instalovaný neaktivní tooling, což evidovat, ale nevyžadovat jeho produktovou migraci.
4. **Stackflow PWA:** jedna kompatibilní sada config/core/react/history/UI rendererů; regresní test všech tří PWA stacků, browser Back/Forward, popstate, deep link, reload a lock/unlock. Native Back/biometrie počkají na nativní vývoj.
5. **Kubb/API a Crypto:** Kubb5 custom Axios integrace, model/query-key generační diff a podpisové Java/JS vectors. Obnova staré wallet a signed TRANSFER akceptovaný aktuálním node; API změny koordinovat s backendem.
6. **Java backend:** nejprve sladění BOM a krátký mezikrok Boot3.5.16, pak4.0.8/4.1.1 se samostatnou Jackson/JPA/Liquibase/Springdoc migrací. JSON snapshots, auth/nonce/retry, webhook/node integrace, PostgreSQL volume a migrace na kopii DB. Každý krok samostatný rollback artifact.
7. **Audit po změnách:** opakovat full-workspace npm audit a oddělit aktivní PWA/runtime/build cesty od odložených cest pomocí dependency graphu, ne jen prvního `apps__extension` prefixu. Samostatně Maven/container scan. Celých203 původních findings nelze vydávat za PWA-only počet.

Odhad rozsahu aktivní práce: patch/minor sada malá až střední; PWA Vite/TS/pnpm střední; Stackflow, Kubb a Boot/Jackson/JPA velké samostatné migrace. Bez funkčních PWA/backend testů nelze poctivě slíbit přesný počet dní ani bezregresní update. Chybějící nativní build nepředstavuje omezení dokončení aktuálního PWA/backend review.

## Odložená roadmapa: extension a nativní aplikace

Tato část uchovává zjištění pro budoucí práci; **není požadavkem současného PWA/backend upgradu**. Při rozvoji extension sladit její Vite s kompatibilním CRXJS, otestovat MV3 a ZIP artefakt. Teprve tam je nutná migrace `react({babel:{plugins:['babel-plugin-react-compiler']}})` v `frontend/apps/extension/vite.config.ts:12` na nové compiler připojení např. `@rolldown/plugin-babel` + `reactCompilerPreset`. Extension-only `@types/chrome`, compiler a zip plugin se nyní nemusí aktualizovat.

- Capacitor core/android/ios/cli sjednotit8.5.0 a oficiální/community pluginy podle tabulky. Už aktuální Capacitor8 potřebuje Xcode26+, Node22+, Android SDK36 a Java21; repo už používá SDK36/min26, AGP8.13.0/Gradle8.14.3, Java21. Apple Podfile platform15.5 a Xcode target15.0 je třeba sladit podle nejpřísnějšího pluginu; kompletní iOS/Android build nebyl proveden. [Capacitor8 upgrade](https://capacitorjs.com/docs/updating/8-0).
- `ios/App/Podfile` a Android capacitor settings obsahují explicitní `.pnpm/...@8.0.1` cesty, zatímco lock má8.0.2. Po aktualizaci spustit z web workspace `cap sync`, zkontrolovat změny Podfile/Podfile.lock a Gradle includes, neprovádět plošné ruční search/replace čísel. Testovat upgrade již nainstalované aplikace se skutečným vaultem: Preferences, secure storage, biometric credentials, privátní obrazovka, share, QR scanner a camera permissions. Obyčejná nová instalace nezachytí ztrátu přístupu ke starým klíčům.
- Latest AGP9.3.2 a Gradle9.7.1 **nejsou** návrh okamžitého spojení s Capacitor8. Nejprve kompatibilní Capacitor8 šablona; major AGP9 a Gradle9 odděleně s ověřením všech pluginů. [Google Maven metadata](https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/maven-metadata.xml), [Gradle current](https://services.gradle.org/versions/current).

Další přímo deklarované Android verze (latest z veřejného Google Maven; společná aktualizace s native platformou, ne naslepo):

| Závislost | Repo | Latest stable | Dopad |
|---|---|---|---|
|AGP|8.13.0|9.3.2|Major toolchain, Capacitor/plugin kompatibilita neověřena|
|Gradle wrapper|8.14.3|9.7.1|Major build API, vybrat dle AGP|
|Google services plugin|4.4.4|4.5.0|FCM config generation a Android package ID|
|androidx.activity|1.11.0|1.13.0|back/navigation lifecycle|
|androidx.appcompat|1.7.1|1.8.0|téma/native Activity|
|androidx.coordinatorlayout|1.3.0|1.3.0|ponechat|
|androidx.core|1.17.0|1.19.0|SDK/minSdk kompatibilita|
|androidx.fragment|1.8.9|1.9.0|lifecycle native pluginů|
|core-splashscreen|1.2.0|1.2.0|ponechat|
|androidx.webkit|1.14.0|1.17.0|WebView features a rendering|
|androidx.test.ext:junit|1.3.0|1.3.0|ponechat|
|androidx.test.espresso|3.7.0|3.7.0|ponechat|
|[junit:junit](https://repo.maven.apache.org/maven2/junit/junit/maven-metadata.xml)|4.13.2|4.13.2|beze změny; nemigrovat na Jupiter pouhým číslem|
|[org.apache.cordova:framework](https://repo.maven.apache.org/maven2/org/apache/cordova/framework/maven-metadata.xml)|14.0.1|15.1.0|major15: nejprve ověřit Capacitor bridge kompatibilitu, ne samostatná aplikace|

CocoaPods přímé Capacitor pluginy odpovídají npm položkám a řeší se jejich podspec/cap sync; tranzitivní pod verze nejsou další nezávislé npm update. Aktuální nejnovější CocoaPods a Xcode patch nebyl ověřen. Registry URL jednotlivých Android položek jsou uloženy v `/tmp/wallet-upgrade-sources/sources.json`.

Při obnovení nativního vývoje provést fyzické Android/iOS testy, upgrade nad existující instalací a obnovu vaultu. AGP/Gradle major změny jsou až navazující samostatný projekt. Nyní se tyto binárky ani extension nepřipravují k vydání.

## Referenční úplný inventář npm — celý workspace

Tabulka záměrně stále zahrnuje100 npm názvů ze všech workspace; neznamená seznam100 aktivních PWA aktualizací. Nativní/extension-only řádky jsou referenční odložená roadmapa. U sdílených balíčků platí aktivní PWA požadavky; suffix/prefix balíčku sám nestačí k vyloučení browser adaptéru.

Legenda dopadů: V build/Vite; T TypeScript; E ESLint; P package/CI toolchain; S Stackflow; K generování API; N native; C crypto; D data; U UI; R React; B backend/BOM; J Jackson; DB databáze. Zdrojem každé latest hodnoty je odkaz přímo v názvu balíčku. „Manifest“ uvádí všechny různé rozsahy napříč workspace; lock odstraňuje jen dlouhé peer suffixy pro čitelnost (JSON je zachovává).

| Balíček / registry | Manifest | Lock | Latest stable | Dopad / návrh |
|---|---|---|---|---|
| [@base-ui/react](https://registry.npmjs.org/@base-ui/react) | ^1.1.0 | 1.1.0 | 1.7.0 | U: minor1; vlastní select/dialog/popover wrappers, focus trap/ref. |
| [@capacitor-mlkit/barcode-scanning](https://registry.npmjs.org/@capacitor-mlkit/barcode-scanning) | ^8.0.0 | 8.0.0 | 8.1.1 | N: kamera/permission, Google MLKit dependencies a iOS pod deployment. |
| [@capacitor/android](https://registry.npmjs.org/@capacitor/android) | ^8.0.2 | 8.0.2 | 8.5.0 | N: společně Capacitor8; cap sync + fyzické Android/iOS regresní testy. |
| [@capacitor/app](https://registry.npmjs.org/@capacitor/app) | ^8.0.0 | 8.0.0 | 8.1.1 | N: společně Capacitor8; cap sync + fyzické Android/iOS regresní testy. |
| [@capacitor/barcode-scanner](https://registry.npmjs.org/@capacitor/barcode-scanner) | ^3.0.0 | 3.0.0 | 3.1.1 | N: druhý scanner vedle MLKit; ověřit, zda potřebujete oba. |
| [@capacitor/camera](https://registry.npmjs.org/@capacitor/camera) | ^8.0.0 | 8.0.0 | 8.2.3 | N: společně Capacitor8; cap sync + fyzické Android/iOS regresní testy. |
| [@capacitor/cli](https://registry.npmjs.org/@capacitor/cli) | ^8.0.2 | 8.0.2 | 8.5.0 | N: společně Capacitor8; cap sync + fyzické Android/iOS regresní testy. |
| [@capacitor/core](https://registry.npmjs.org/@capacitor/core) | ^8.0.2 | 8.0.2 | 8.5.0 | N: společně Capacitor8; cap sync + fyzické Android/iOS regresní testy. |
| [@capacitor/ios](https://registry.npmjs.org/@capacitor/ios) | ^8.0.2 | 8.0.2 | 8.5.0 | N: společně Capacitor8; cap sync + fyzické Android/iOS regresní testy. |
| [@capacitor/preferences](https://registry.npmjs.org/@capacitor/preferences) | ^8.0.0 | 8.0.0 | 8.0.1 | N: společně Capacitor8; cap sync + fyzické Android/iOS regresní testy. |
| [@capacitor/privacy-screen](https://registry.npmjs.org/@capacitor/privacy-screen) | ^2.0.0 | 2.0.0 | 2.0.1 | N: společně Capacitor8; cap sync + fyzické Android/iOS regresní testy. |
| [@capacitor/share](https://registry.npmjs.org/@capacitor/share) | ^8.0.0 | 8.0.0 | 8.0.1 | N: společně Capacitor8; cap sync + fyzické Android/iOS regresní testy. |
| [@capacitor/splash-screen](https://registry.npmjs.org/@capacitor/splash-screen) | ^8.0.0 | 8.0.0 | 8.0.2 | N: společně Capacitor8; cap sync + fyzické Android/iOS regresní testy. |
| [@capawesome/capacitor-torch](https://registry.npmjs.org/@capawesome/capacitor-torch) | ^8.0.0 | 8.0.0 | 8.0.1 | N: společně Capacitor8; cap sync + fyzické Android/iOS regresní testy. |
| [@capgo/capacitor-native-biometric](https://registry.npmjs.org/@capgo/capacitor-native-biometric) | ^8.3.3 | 8.3.3 | 8.6.7 | N: test existujících credentials/server a rollback, ne jen isAvailable. |
| [@capgo/capacitor-navigation-bar](https://registry.npmjs.org/@capgo/capacitor-navigation-bar) | ^8.0.14 | 8.0.14 | 8.2.7 | N: společně Capacitor8; cap sync + fyzické Android/iOS regresní testy. |
| [@crxjs/vite-plugin](https://registry.npmjs.org/@crxjs/vite-plugin) | ^2.3.0 | 2.3.0 | 2.7.1 | ODLOŽENO extension: latest2.7.1 má Vite8 peer; budoucí MV3 test. |
| [@eslint/js](https://registry.npmjs.org/@eslint/js) | ^9.39.2 | 9.39.2 | 10.0.1 | E: držet společně s ESLint; nyní doporučeno 9.x kvůli react pluginu. |
| [@fontsource-variable/inter](https://registry.npmjs.org/@fontsource-variable/inter) | ^5.2.8 | 5.2.8 | 5.3.0 | U: font assety a PWA precache. |
| [@goldenera/cryptoj](https://registry.npmjs.org/@goldenera/cryptoj) | ^0.2.0 | 0.2.0 | 0.4.1 | C: 0.2 ->0.4.1 vyžaduje wire vectors; nové state/payload V2 a přísnější RLP. |
| [@hookform/resolvers](https://registry.npmjs.org/@hookform/resolvers) | ^5.2.2 | 5.2.2 | 5.9.1 | D: společně react-hook-form/Zod; typy a validační průchod. |
| [@ionic/pwa-elements](https://registry.npmjs.org/@ionic/pwa-elements) | ^3.3.0 | 3.3.0 | 3.4.0 | N/U: web camera modal a komponenty, nenahradí native plugins. |
| [@kubb/cli](https://registry.npmjs.org/@kubb/cli) | ^4.20.0 | 4.20.0 | 5.0.4 | K: v5 nový unified kubb/config/adapter; Node>=22. |
| [@kubb/core](https://registry.npmjs.org/@kubb/core) | ^4.20.0 | 4.20.0 | 5.0.4 | K: v5 nesmí být smícháno s plugin-oas4; změna generační pipeline. |
| [@kubb/plugin-oas](https://registry.npmjs.org/@kubb/plugin-oas) | ^4.20.0 | 4.20.0 | 4.39.3 | K: latest4.39.3; ve v5 odstranit a nahradit adapter-oas, ne aktualizovat nezávisle. |
| [@kubb/plugin-react-query](https://registry.npmjs.org/@kubb/plugin-react-query) | ^4.20.0 | 4.20.0 | 5.0.1 | K: v5 client object/importPath -> registrovaný axios/fetch plugin; přegenerovat. |
| [@kubb/plugin-ts](https://registry.npmjs.org/@kubb/plugin-ts) | ^4.20.0 | 4.20.0 | 5.0.0 | K: v5 nový plugin/core peer; přegenerovat modely a posoudit API diff. |
| [@radix-ui/react-avatar](https://registry.npmjs.org/@radix-ui/react-avatar) | ^1.1.11 | 1.1.11 | 1.2.6 | U: kompatibilní řada podle semver; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [@radix-ui/react-label](https://registry.npmjs.org/@radix-ui/react-label) | ^2.1.8 | 2.1.8 | 2.1.15 | U: kompatibilní řada podle semver; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [@radix-ui/react-separator](https://registry.npmjs.org/@radix-ui/react-separator) | ^1.1.8 | 1.1.8 | 1.1.15 | U: kompatibilní řada podle semver; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [@radix-ui/react-slot](https://registry.npmjs.org/@radix-ui/react-slot) | ^1.2.4 | 1.2.4 | 1.3.3 | U: kompatibilní řada podle semver; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [@radix-ui/react-switch](https://registry.npmjs.org/@radix-ui/react-switch) | ^1.2.6 | 1.2.6 | 1.3.7 | U: kompatibilní řada podle semver; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [@stackflow/config](https://registry.npmjs.org/@stackflow/config) | ^1.2.2 | 1.2.2 | 2.0.0 | S: v2 definice config/typů, aktualizovat se všemi Stackflow core/react/history. |
| [@stackflow/core](https://registry.npmjs.org/@stackflow/core) | ^1.3.0 | 1.3.0 | 3.1.0 | S: v3 mění navigation snapshots, nekombinovat se starým react/history. |
| [@stackflow/plugin-basic-ui](https://registry.npmjs.org/@stackflow/plugin-basic-ui) | ^1.18.1 | 1.18.1 | 1.18.4 | S: i patch sladit peer s novým Stackflow; test AppScreen/gest. |
| [@stackflow/plugin-history-sync](https://registry.npmjs.org/@stackflow/plugin-history-sync) | ^1.10.0 | 1.10.0 | 2.1.0 | S: v2 vyžaduje core3, jiná obnova snapshot/history; test CleanableHistory. |
| [@stackflow/plugin-renderer-basic](https://registry.npmjs.org/@stackflow/plugin-renderer-basic) | ^1.1.13 | 1.1.13 | 1.1.16 | S: aktualizovat v jedné sadě se Stackflow; UI přechody. |
| [@stackflow/plugin-renderer-web](https://registry.npmjs.org/@stackflow/plugin-renderer-web) | ^1.1.13 | 1.1.13 | 1.1.16 | S: aktualizovat v jedné sadě se Stackflow; web/back navigace. |
| [@stackflow/react](https://registry.npmjs.org/@stackflow/react) | ^1.12.0 | 1.12.0 | 2.1.4 | S: v2 odstraňuje useActions a starý stackflow({activities}); přepis routeru. |
| [@tailwindcss/vite](https://registry.npmjs.org/@tailwindcss/vite) | ^4.1.18 | 4.1.18 | 4.3.3 | U/V: sladit s tailwindcss4.3.3; workspace scan a build CSS. |
| [@tanstack/react-query](https://registry.npmjs.org/@tanstack/react-query) | ^5.90, ^5.90.20 | 5.90.20 | 5.102.8 | D: minor5; query keys, invalidace, retries a stale data po unlock. |
| [@types/chrome](https://registry.npmjs.org/@types/chrome) | ^0.1.36 | 0.1.36 | 0.2.7 | ODLOŽENO extension: service worker a messaging typy. |
| [@types/node](https://registry.npmjs.org/@types/node) | ^25.1.0 | 25.1.0 | 26.4.0 | T: nepoužít latest26 k runtime22/24; vybrat odpovídající hlavní řadu. |
| [@types/react](https://registry.npmjs.org/@types/react) | ^19.2.10 | 19.2.10 | 19.2.18 | T: sladit19 s React/ReactDOM, zkontrolovat ref a event typy. |
| [@types/react-dom](https://registry.npmjs.org/@types/react-dom) | ^19.2.3 | 19.2.3 | 19.2.5 | T: sladit19 s React/ReactDOM. |
| [@types/uuid](https://registry.npmjs.org/@types/uuid) | ^11.0.0 | 11.0.0 | 11.0.0 | Odstranit: deprecated stub; uuid vlastní typy již obsahuje. |
| [@vite-pwa/assets-generator](https://registry.npmjs.org/@vite-pwa/assets-generator) | ^1.0.2 | 1.0.2 | 1.0.2 | V: beze změny, generuje assety pouze při explicitním příkazu. |
| [@vitejs/plugin-react](https://registry.npmjs.org/@vitejs/plugin-react) | ^5.1.2 | 5.1.2 | 6.1.1 | V: PWA v6 s Vite8; přepis babel Compileru pouze v odložené extension. |
| [autoprefixer](https://registry.npmjs.org/autoprefixer) | ^10.4.23 | 10.4.23 | 10.5.4 | U/V: build CSS; beze změny JS API očekávané. |
| [axios](https://registry.npmjs.org/axios) | ^1.13.4 | 1.13.4 | 1.20.0 | D: prioritní security update1.20; zkontrolovat ApiClient autentizaci/interceptory. |
| [babel-plugin-react-compiler](https://registry.npmjs.org/babel-plugin-react-compiler) | ^1.0.0 | 1.0.0 | 1.0.0 | ODLOŽENO extension: latest1.0 beze změny, nové připojení pluginu6. |
| [barcode-detector](https://registry.npmjs.org/barcode-detector) | ^3.0.8 | 3.0.8 | 3.2.2 | N/U: QR fallback/WASM asset path, kamera cleanup. |
| [capacitor-secure-storage-plugin](https://registry.npmjs.org/capacitor-secure-storage-plugin) | ^0.13.0 | 0.13.0 | 0.13.0 | N: latest0.13 beze změny; musí zachovat existující šifrované klíče/storage. |
| [class-variance-authority](https://registry.npmjs.org/class-variance-authority) | ^0.7.1 | 0.7.1 | 0.7.1 | U: latest shodná, ponechat; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [clsx](https://registry.npmjs.org/clsx) | ^2.1.1 | 2.1.1 | 2.1.1 | U: latest shodná, ponechat; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [compute-scroll-into-view](https://registry.npmjs.org/compute-scroll-into-view) | ^3.1.1 | 3.1.1 | 3.1.1 | U: latest shodná, ponechat; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [custom-qr-code](https://registry.npmjs.org/custom-qr-code) | ^2.0.3 | 2.0.3 | 2.0.3 | U: latest shodná, ponechat; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [eslint](https://registry.npmjs.org/eslint) | ^9.39.2 | 9.39.2 | 10.9.1 | E: latest10 blokuje peer eslint-plugin-react; mezikrok 9.39.5. |
| [eslint-plugin-react](https://registry.npmjs.org/eslint-plugin-react) | ^7.37.5 | 7.37.5 | 7.37.5 | E: latest stále7.37.5; nepodporuje ESLint10, nenutit override. |
| [eslint-plugin-react-hooks](https://registry.npmjs.org/eslint-plugin-react-hooks) | ^7.0.1 | 7.0.1 | 7.1.1 | E: nové kontroly hooků/Compileru; opravit diagnostiku, nevypínat plošně. |
| [eslint-plugin-react-refresh](https://registry.npmjs.org/eslint-plugin-react-refresh) | ^0.4.26 | 0.4.26 | 0.5.5 | E: minor0.x může měnit pravidla; ověřit flat config. |
| [eslint-plugin-unused-imports](https://registry.npmjs.org/eslint-plugin-unused-imports) | ^4.3.0 | 4.3.0 | 4.4.1 | E: sladit parser a ESLint peer. |
| [firebase](https://registry.npmjs.org/firebase) | ^12.8.0 | 12.8.0 | 12.18.0 | D: PWA src import nenalezen; prověřit odstranění nebo aktualizaci; native odloženo. |
| [globals](https://registry.npmjs.org/globals) | ^17.2.0 | 17.2.0 | 17.11.0 | E: data globálních symbolů; runtime nemění. |
| [history](https://registry.npmjs.org/history) | ^5.3.0 | 5.3.0 | 5.3.0 | U: latest shodná, ponechat; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [idb-keyval](https://registry.npmjs.org/idb-keyval) | ^6.2.2 | 6.2.2 | 6.3.0 | D: stávající IndexedDB data, chyby dostupnosti browser storage. |
| [input-otp](https://registry.npmjs.org/input-otp) | ^1.4.2 | 1.4.2 | 1.5.0 | U: kompatibilní řada podle semver; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [lucide-react](https://registry.npmjs.org/lucide-react) | ^0.563.0 | 0.563.0 | 1.38.0 | U: major1; ověřit každý import/export a vizuální změny ikon; přesný seznam migrací neověřen. |
| [motion](https://registry.npmjs.org/motion) | ^12.29.2 | 12.29.2 | 13.1.1 | U: major13 odstraňuje implicitní emotion prop filtr; zde motion/react v family-drawer. |
| [pnpm](https://registry.npmjs.org/pnpm) | 10.28.2 | 10.28.2 | 11.24.0 | P: 11 mění onlyBuiltDependencies -> allowBuilds, store a config; mezikrok10.34.5. |
| [postcss](https://registry.npmjs.org/postcss) | ^8.5.6 | 8.5.6 | 8.5.26 | U/V: patch8; aktivně PWA rebuild a kontrola CSS. |
| [prettier](https://registry.npmjs.org/prettier) | ^3.8.1 | 3.8.1 | 3.9.6 | Nízké runtime riziko; formátovací diff dělit od funkčních změn. |
| [react](https://registry.npmjs.org/react) | ^19.0.0, ^19.2.4 | 19.2.4 | 19.2.8 | R: patch19.2.8 společně react-dom; žádný React Server Components runtime v projektu. |
| [react-dom](https://registry.npmjs.org/react-dom) | ^19.0.0, ^19.2.4 | 19.2.4 | 19.2.8 | R: patch19.2.8 společně react; aktivně PWA mount/unmount. |
| [react-hook-form](https://registry.npmjs.org/react-hook-form) | ^7.71.1 | 7.71.1 | 7.87.0 | D: minor7; reset hodnot, disabled a validace TxSubmitCard. |
| [react-number-format](https://registry.npmjs.org/react-number-format) | ^5.4.4 | 5.4.4 | 5.4.5 | U: kompatibilní řada podle semver; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [react-use-measure](https://registry.npmjs.org/react-use-measure) | ^2.1.7 | 2.1.7 | 2.1.7 | U: latest shodná, ponechat; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [react-use-pull-to-refresh](https://registry.npmjs.org/react-use-pull-to-refresh) | ^1.0.5 | 1.0.5 | 1.0.5 | U: latest shodná, ponechat; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [rolldown-vite](https://registry.npmjs.org/rolldown-vite) | 7.3.1 | 7.3.1 | 7.3.1 | V: deprecated preview; latest7.3.1 není cílový update, přejít na vite8.2.2. |
| [scroll-into-view-if-needed](https://registry.npmjs.org/scroll-into-view-if-needed) | ^3.1.0 | 3.1.0 | 3.1.0 | U: latest shodná, ponechat; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [shadcn](https://registry.npmjs.org/shadcn) | ^3.7.0 | 3.7.0 | 4.19.1 | U: major4 CLI; neaktualizuje automaticky již zkopírované UI komponenty. Přesun do devDeps pokud není runtime import. |
| [tailwind-merge](https://registry.npmjs.org/tailwind-merge) | ^3.4.0 | 3.4.0 | 3.6.0 | U: kompatibilní řada podle semver; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [tailwindcss](https://registry.npmjs.org/tailwindcss) | ^4.1.18 | 4.1.18 | 4.3.3 | U/V: minor4; zkontrolovat generované CSS tříd, dark mode a safelist. |
| [tsup](https://registry.npmjs.org/tsup) | ^8.5.1 | 8.5.1 | 8.5.1 | V: latest8.5.1; zdrojové exports znamenají, že prod aplikace bundluje Vite; nepředstírat update. |
| [turbo](https://registry.npmjs.org/turbo) | ^2.8.0 | 2.8.0 | 2.10.12 | P: minor2; zkontrolovat definované tasks, root typecheck nyní nefunguje. |
| [tw-animate-css](https://registry.npmjs.org/tw-animate-css) | ^1.4.0 | 1.4.0 | 1.4.0 | U: latest shodná, ponechat; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [typescript](https://registry.npmjs.org/typescript) | ^5.9.3, ~5.9.3 | 5.9.3 | 7.0.2 | T: latest7 není drop-in; typescript-eslint latest vyžaduje <6.1, použít6.x nebo odložit7. |
| [typescript-eslint](https://registry.npmjs.org/typescript-eslint) | ^8.54.0 | 8.54.0 | 8.69.0 | T/E: latest8.69 podporuje TS<6.1, ESLint8/9/10; TypeScript7 odmítá peer. |
| [uncontrollable](https://registry.npmjs.org/uncontrollable) | ^9.0.0 | 9.0.0 | 9.0.0 | U: latest shodná, ponechat; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [unstorage](https://registry.npmjs.org/unstorage) | ^1.17.4 | 1.17.4 | 1.17.5 | D: zachování namespaces a storage dat; test StorageService. |
| [usehooks-ts](https://registry.npmjs.org/usehooks-ts) | ^3.1.1 | 3.1.1 | 3.1.1 | U: latest shodná, ponechat; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [uuid](https://registry.npmjs.org/uuid) | ^13.0.0 | 13.0.0 | 14.0.2 | D: major14 vyžaduje global crypto a Node20+; DeviceService v4 API zůstává. |
| [vaul](https://registry.npmjs.org/vaul) | ^1.1.2 | 1.1.2 | 1.1.2 | U: latest shodná, ponechat; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [vaul-base](https://registry.npmjs.org/vaul-base) | ^1.0.0 | 1.0.0 | 1.0.0 | U: latest shodná, ponechat; ověřit používané UI/DOM chování; detailní changelog neověřen. |
| [vite](https://registry.npmjs.org/vite) | ^7.3.1, npm:rolldown-vite@7.3.1 | 7.3.1, rolldown-vite@7.3.1 | 8.2.2 | V: aktivně web alias ->Vite8; sladění extension odloženo. |
| [vite-plugin-pwa](https://registry.npmjs.org/vite-plugin-pwa) | ^1.2.0 | 1.2.0 | 1.3.0 | V: latest1.3 má Vite8 peer, Workbox7.4.1; offline/update test. |
| [vite-plugin-zip-pack](https://registry.npmjs.org/vite-plugin-zip-pack) | ^1.2.4 | 1.2.4 | 1.2.4 | ODLOŽENO extension: latest beze změny; budoucí ZIP kontrola. |
| [workbox-window](https://registry.npmjs.org/workbox-window) | ^7.4.0 | 7.4.0 | 7.4.1 | V: společně PWA; test starý service worker -> nový a rozpracovaný převod. |
| [zod](https://registry.npmjs.org/zod) | ^4.3.6 | 4.3.6 | 4.5.4 | D: minor4; formulářové errors, refine, resolver input/output types. |
| [zustand](https://registry.npmjs.org/zustand) | ^5.0.10 | 5.0.10 | 5.0.15 | D: minor5; persisted wallet state, subscriptions a reset při lock/logout. |

## Úplný inventář Maven — aktivní Java backend

Všechny záznamy pocházejí z pom.xml; BOM hodnoty viz vysvětlení nahoře. Veřejná latest není automaticky kompatibilní s aktuálním Bootem.

| Souřadnice / registry | Manifest | Resolved/BOM | Latest stable | Dopad / návrh |
|---|---|---|---|---|
| [com.bucket4j:bucket4j_jdk17-core](https://repo.maven.apache.org/maven2/com/bucket4j/bucket4j_jdk17-core/maven-metadata.xml) | ${bucket4j.version} | 8.15.0 | 8.19.0 | B:8.19.0, otestovat rate-limit refill, 429 a clock; zachovat JDK17 variantu. |
| [com.fasterxml.jackson.datatype:jackson-datatype-jsr310](https://repo.maven.apache.org/maven2/com/fasterxml/jackson/datatype/jackson-datatype-jsr310/maven-metadata.xml) | Spring Boot BOM | 2.19.4 | 2.22.2 | J: Jackson2 BOM; Jackson3 obsahuje Java time v databind, přehodnotit artifact. |
| [com.fasterxml.jackson.module:jackson-module-jakarta-xmlbind-annotations](https://repo.maven.apache.org/maven2/com/fasterxml/jackson/module/jackson-module-jakarta-xmlbind-annotations/maven-metadata.xml) | ${jackson-xmlbind.version} | 2.20.1 | 2.22.2 | J: nyní2.20.1 vs BOM2.19.4; sladit celý Jackson2 BOM. latest2.22 není Jackson3. |
| [com.github.ben-manes.caffeine:caffeine](https://repo.maven.apache.org/maven2/com/github/ben-manes/caffeine/caffeine/maven-metadata.xml) | ${caffeine.version} | 3.2.2 | 3.2.4 | B: minor3.2.4, nechat BOM pokud dostačuje; cache expirace. |
| [com.h2database:h2](https://repo.maven.apache.org/maven2/com/h2database/h2/maven-metadata.xml) | ${h2.version} | 2.4.240 | 2.4.240 | DB: latest shodná; test jen H2 nenahrazuje PostgreSQL18. |
| [com.mycila:license-maven-plugin](https://repo.maven.apache.org/maven2/com/mycila/license-maven-plugin/maven-metadata.xml) | ${license-maven-plugin.version} | 4.6 | 5.1.2 | P: major5.1.2; ověřit konfiguraci check, žádné automatické format v tomto review. |
| [dev.mccue:guava-base](https://repo.maven.apache.org/maven2/dev/mccue/guava-base/maven-metadata.xml) | ${guava.version} | 33.4.0 | 33.4.0 | C/B: latest shodná; není com.google.guava:guava, nezaměnit podle názvu. |
| [global.goldenera.cryptoj:goldenera-cryptoj](https://maven.pkg.github.com/goldeneraglobal/goldenera-cryptoj) | ${goldenera-cryptoj.version} | 0.0.1 | NEOVĚŘENO | C: privátní GitHub Maven latest neověřeno; koordinovat verzovaný artifact s node a JS; nerepublikovat0.0.1. |
| [io.consensys.tuweni:tuweni-bytes](https://repo.maven.apache.org/maven2/io/consensys/tuweni/tuweni-bytes/maven-metadata.xml) | ${tuweni.version} | 2.7.2 | 2.8.0 | C:2.8.0 společně units; endian/unsigned/Bytes serializer vectors. |
| [io.consensys.tuweni:tuweni-units](https://repo.maven.apache.org/maven2/io/consensys/tuweni/tuweni-units/maven-metadata.xml) | ${tuweni.version} | 2.7.2 | 2.8.0 | C:2.8.0 společně bytes; Wei převody a JSON kontrakt. |
| [io.github.mweirauch:micrometer-jvm-extras](https://repo.maven.apache.org/maven2/io/github/mweirauch/micrometer-jvm-extras/maven-metadata.xml) | ${micrometer-extras.version} | 0.2.2 | 0.3.0 | B:0.3.0 změna0.x, test binder a názvy metrik; changelog detail neověřen. |
| [io.hypersistence:hypersistence-utils-hibernate-63](https://repo.maven.apache.org/maven2/io/hypersistence/hypersistence-utils-hibernate-63/maven-metadata.xml) | ${hypersistence.version} | 3.11.0 | 3.15.5 | B:3.15.5 pro Hibernate6; Boot4.0 Hibernate7.2 -> artifact71; Boot4.1 Hibernate7.4 ->73. |
| [io.micrometer:micrometer-registry-prometheus](https://repo.maven.apache.org/maven2/io/micrometer/micrometer-registry-prometheus/maven-metadata.xml) | Spring Boot BOM | 1.15.6 | 1.17.1 | B: přenechat Boot BOM1.15/1.16/1.17, ne pin latest na Boot3. |
| [org.apache.maven.plugins:maven-compiler-plugin](https://repo.maven.apache.org/maven2/org/apache/maven/plugins/maven-compiler-plugin/maven-metadata.xml) | ${maven.compiler.version} | 3.14.0 | 3.15.0 | P/B: stable3.15.0 pro Maven3;4.0-beta není stable update. |
| [org.bouncycastle:bcprov-jdk18on](https://repo.maven.apache.org/maven2/org/bouncycastle/bcprov-jdk18on/maven-metadata.xml) | ${bouncycastle.version} | 1.81 | 1.85.2 | C: security patch/minor1.85.2; jednotná verze s CryptoJ, deterministické podpisy. |
| [org.hibernate.validator:hibernate-validator](https://repo.maven.apache.org/maven2/org/hibernate/validator/hibernate-validator/maven-metadata.xml) | ${hibernate-validator.version} | 9.1.0.Final | 9.1.3.Final | B: nyní9.1 přepsané proti Boot3.5 BOM8/API3.0; nejdřív sladit, Boot4.1 spravuje9.1.3. |
| [org.liquibase.ext:liquibase-hibernate6](https://repo.maven.apache.org/maven2/org/liquibase/ext/liquibase-hibernate6/maven-metadata.xml) | ${liquibase.version} | 5.0.1 | 5.0.4 | DB/B: vhodné jen Hibernate6; Boot4 vyžaduje kompatibilní hibernate7 extension, dostupnost cíle doověřit. |
| [org.liquibase:liquibase-core](https://repo.maven.apache.org/maven2/org/liquibase/liquibase-core/maven-metadata.xml) | ${liquibase.version} | 5.0.1 | 5.0.4 | DB/B: patch5.0.4; vlastní override Boot BOM, ověřit boot startup/migrace. |
| [org.liquibase:liquibase-maven-plugin](https://repo.maven.apache.org/maven2/org/liquibase/liquibase-maven-plugin/maven-metadata.xml) | ${liquibase.version} | 5.0.1 | 5.0.4 | DB: současně core/extension; opravit starou naming strategy v referenceUrl. |
| [org.mapstruct:mapstruct](https://repo.maven.apache.org/maven2/org/mapstruct/mapstruct/maven-metadata.xml) | ${mapstruct.version} | 1.6.3 | 1.6.3 | B:1.6.3 je stále stable;1.7 Beta do návrhu produkce nepatří. |
| [org.mapstruct:mapstruct-processor](https://repo.maven.apache.org/maven2/org/mapstruct/mapstruct-processor/maven-metadata.xml) | ${mapstruct.version} | 1.6.3 | 1.6.3 | B:držet stejnou1.6.3 jako mapstruct API. |
| [org.openapitools:openapi-generator-maven-plugin](https://repo.maven.apache.org/maven2/org/openapitools/openapi-generator-maven-plugin/maven-metadata.xml) | 7.17.0 | 7.17.0 | 7.25.0 | K/B:7.25.0; nově generované Java HTTP interfaces a modely diff; Boot4 options ověřit. |
| [org.postgresql:postgresql](https://repo.maven.apache.org/maven2/org/postgresql/postgresql/maven-metadata.xml) | ${postgresql.version} | 42.7.8 | 42.7.13 | DB: JDBC patch42.7.13; SSL/auth/batching a reálný PostgreSQL. |
| [org.projectlombok:lombok](https://repo.maven.apache.org/maven2/org/projectlombok/lombok/maven-metadata.xml) | ${lombok.version}, Spring Boot BOM | 1.18.42 | 1.18.46 | B:1.18.46 spravuje cílový BOM; annotation processor s mapstruct-binding. |
| [org.projectlombok:lombok-mapstruct-binding](https://repo.maven.apache.org/maven2/org/projectlombok/lombok-mapstruct-binding/maven-metadata.xml) | ${lombok-mapstruct-binding.version} | 0.2.0 | 0.2.0 | B:latest0.2.0 beze změny; musí zůstat vedle Lombok procesoru. |
| [org.springdoc:springdoc-openapi-starter-webmvc-ui](https://repo.maven.apache.org/maven2/org/springdoc/springdoc-openapi-starter-webmvc-ui/maven-metadata.xml) | ${springdoc.version} | 2.8.9 | 3.1.0 | B/K: pro Boot3 nejvýš2.x (latest2.9.0), 3.1.0 až Boot4; diff OpenAPI/modelů. |
| [org.springframework.boot:spring-boot-maven-plugin](https://repo.maven.apache.org/maven2/org/springframework/boot/spring-boot-maven-plugin/maven-metadata.xml) | Spring Boot BOM | 3.5.8 | 4.1.1 | B: mezikrok3.5.16, poté4.0.8/4.1.1; BOM a modulární starters společně. |
| [org.springframework.boot:spring-boot-starter-cache](https://repo.maven.apache.org/maven2/org/springframework/boot/spring-boot-starter-cache/maven-metadata.xml) | Spring Boot BOM | 3.5.8 | 4.1.1 | B: mezikrok3.5.16, poté4.0.8/4.1.1; BOM a modulární starters společně. |
| [org.springframework.boot:spring-boot-starter-data-jpa](https://repo.maven.apache.org/maven2/org/springframework/boot/spring-boot-starter-data-jpa/maven-metadata.xml) | ${project.parent.version}, Spring Boot BOM | 3.5.8 | 4.1.1 | B: mezikrok3.5.16, poté4.0.8/4.1.1; BOM a modulární starters společně. |
| [org.springframework.boot:spring-boot-starter-parent](https://repo.maven.apache.org/maven2/org/springframework/boot/spring-boot-starter-parent/maven-metadata.xml) | 3.5.8 | 3.5.8 | 4.1.1 | B: mezikrok3.5.16, poté4.0.8/4.1.1; BOM a modulární starters společně. |
| [org.springframework.boot:spring-boot-starter-security](https://repo.maven.apache.org/maven2/org/springframework/boot/spring-boot-starter-security/maven-metadata.xml) | Spring Boot BOM | 3.5.8 | 4.1.1 | B: mezikrok3.5.16, poté4.0.8/4.1.1; BOM a modulární starters společně. |
| [org.springframework.boot:spring-boot-starter-web](https://repo.maven.apache.org/maven2/org/springframework/boot/spring-boot-starter-web/maven-metadata.xml) | Spring Boot BOM | 3.5.8 | 4.1.1 | B: mezikrok3.5.16, poté4.0.8/4.1.1; BOM a modulární starters společně. |
| [org.springframework.retry:spring-retry](https://repo.maven.apache.org/maven2/org/springframework/retry/spring-retry/maven-metadata.xml) | Spring Boot BOM | 2.0.12 | 2.0.13 | B: v Boot4 ztrácí BOM management; pin2.0.13 nebo migrace na Framework7 retry + AOP test. |
| [org.web3j:crypto](https://repo.maven.apache.org/maven2/org/web3j/crypto/maven-metadata.xml) | ${web3j.version} | 5.0.1 | 6.0.0 | C/J: major6; i5.0.3 mění Jackson v širším Web3j; ověřit konkrétní crypto graph + vectors. |
