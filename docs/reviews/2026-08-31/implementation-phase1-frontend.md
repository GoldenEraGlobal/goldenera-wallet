# Etapa 1 — aktualizace frontendových závislostí

Aktivní scope je PWA a sdílené api/core/ui; Java část je popsána zvlášť. Nativní projekty ani extension se nerozvíjely. Žádný deploy ani commit. Původní funkční/security nálezy F1/F5/F6/F7/F8 a S1–S7 nebyly součástí této etapy; navazující opravy mají vlastní phase2 report.

## Implementovaná sada

| Oblast | Původně | Nyní |
|---|---|---|
|Node Docker/CI|22|24.20.0 LTS; lokální ověření mise24.19.0|
|pnpm|10.28.2|11.24.0; allowBuilds místo onlyBuiltDependencies|
|PWA Vite|rolldown-vite7.3.1 alias|vite8.2.2|
|React Vite plugin|5.1.2|6.1.1; PWA nepoužívá Babel Compiler|
|PWA/Workbox|1.2.0 /7.4.0|1.3.0 /7.4.1|
|React/ReactDOM|19.2.4|19.2.8|
|TypeScript|5.9.3|6.0.3, zdůvodněný hold pod7|
|ESLint /typescript-eslint|9.39.2 /8.54.0|10.9.1 /8.69.0|
|Stackflow config/core/react/history|1.2/1.3/1.12/1.10|2.0.0 /3.1.0 /2.1.4 /2.1.0|
|Kubb|4.20.0 sada|kubb+adapter5.0.4; TSplugin5.0.0, ReactQuery5.0.1, Axios5.1.1|
|CryptoJ|0.2.0|0.4.1|
|Axios / TanStack Query|1.13.4 /5.90.20|1.20.0 /5.102.8|
|Zod /React Hook Form /resolvers|4.3.6 /7.71.1 /5.2.2|4.5.4 /7.87.0 /5.9.1|
|Tailwind /BaseUI /Motion /Lucide|4.1.18 /1.1.0 /12.29.2 /0.563.0|4.3.3 /1.7.0 /13.1.1 /1.38.0|
|Testy|bez odpovídajícího harnessu|Vitest4.1.11, Playwright1.62.1, Chromium151, TestingLibrary16.3.3+DOM10.4.1, jsdom30.0.1|

Úplný skutečný stav všech workspace/importerů včetně development závislostí je v `implementation-phase1-frontend-versions.json`; číselný původní100npm/34Maven inventář je zachovaný jako historická reference. Lock byl vyřešen v čisté izolované kopii manifestů a následně úspěšně instalován `--frozen-lockfile`; tím se odstranily historické transitivní preference. Žádné force ani peer overrides.

## Provedené migrace a kompatibilita

- Vite alias odstraněn, web používá `rolldownOptions.output.codeSplitting` místo deprecated manualChunks. Zachovaná předchozí browser hranice Chrome107/Edge107/Firefox104/Safari16; workspace Tailwind scan používá skutečné CSS `@source`, odstraněna neplatná `content as never` konfigurace pluginu. CSS/shadcn je stále importované v `apps/web/src/index.css`; balíček zůstal web build dependency a produkční CSS/render prošly browser testy.
- Stackflow používá `defineConfig`/components, registry typů aktivit a nový `useFlow`. Zachovány tři oddělené auth/backup stacky a route mapy; history adaptér doplněn o `go(delta)`, které nová reconciliace potřebuje. Parametry TokenDetail/TxSubmit zůstávají typované, včetně objektového předvyplnění transakce. Původní auto-lock behavior se v etapě1 neopravoval.
- Kubb5 používá OpenAPI adapter a registrovaný Axios plugin, `hooks:true`, nová seskupená `{query}`/`{body}` volání. Query key hodnoty zůstávají `['v1',{url},query]`; stejné origin/JSON transport nastavení je připojené přes generated client k axiosInstance. HTTP error rejection a AbortSignal ověřeny integračně. Specifikace je lokální `packages/api/openapi.json`, získaná z reálného backendu a nakonec sladěná s Boot4; serverURL normalizován na `/`. Zaniklé staré test-controller modely nebyly používané PWA. Žádné změny wire podpisů či mnemonic derivace.
- Typecheck nyní funguje přes Turbo pro všechny čtyři aktivní projekty, není závislý na starých `.d.ts` artefaktech. Source configy už nepoužívají baseUrl; doplněna CSS deklarace přes vite/client. Type-only importy, nepoužité symboly a stylistické lint chyby byly upraveny mechanicky. Resolver rozlišuje Zod input/output při defaultované fee. Nové ESLint preserve-caught-error pravidlo uchovává cause existujících chyb, nemění jejich hlášku.
- Odstranění eslint-plugin-react neodebralo aktivní pravidlo: původní config nenačítal jeho recommended rules a pouze nastavoval `react/react-in-jsx-scope: off`. Hook pravidla zůstávají aktivní. Tím je ESLint10 kompatibilní bez ignorování peer požadavků starého nepoužívaného pluginu.
- Prokazatelně nepoužívané Firebase, unstorage, idb-keyval, vybrané redundantní Radix/form dependency položky a @types/uuid byly odstraněny podle importů TS/TSX/CSS a ověřeného build/typecheck. `react-use-pull-to-refresh` byl odstraněn: UI už implementuje vlastní PullToRefresh, neimportuje tento balíček. Aktivní funkce nebyla zrušena. Nativní scaffolding zůstal.
- CI používá připnuté Node24.20/pnpm11.24, PWA typecheck+lint, unit/integration testy, produkční build a Chromium E2E. Maven krok je `./mvnw clean verify`, takže spustí skutečné PostgreSQL integrační testy místo `-DskipTests`. Docker build tagy Node24.20.0-alpine a Maven3.9.16-eclipse-temurin-21 byly ověřeny přes oficiální registry.

## Zdůvodněné holds a otevřený audit checkpoint

- TypeScript7.0.2 není podporován aktuálním typescript-eslint (peer<6.1). Použit nejnovější podporovaný6.0.3, nikoli předstíraný latest7.
- Tsup8.5.1 je latest. Jeho declaration worker sám nastavuje baseUrl; pouze v jeho dvou DTS konfiguracích je dočasné `ignoreDeprecations:'6.0'`. Aplikační tsc tato výjimka neoslabuje; vlastní tsconfig baseUrl nemá. Builds API/UI deklarací prošly. TS7/nahrazení tsup je navazující práce, pokud nástroj získá kompatibilní podporu.
- `@types/node`24.13.3 odpovídá používanému LTS runtime; neinstalovat26 types jen kvůli latest tagu.
- Native android/ios/CLI drženy8.0.2; jejich sync/Gradle/Pods build je mimo aktivní vývoj. Extension drží CRXJS2.3, Babel Compiler1 a ZIP plugin; sdílené knihovny jsou konzistentní, Vite7.3.6/plugin-react5.2.0 v extension jsou pouze kompatibilní maintenance verze bez velké migrace.
- Po updatu auto-review v tomto starším subagent kontextu odmítla nový online npm audit kvůli exportu package metadat, přestože explicitní uživatelský souhlas existuje v root historii. Nebyl opakován ani obcházen; root přidělí závěrečné ověření agentovi s úplným kontextem. **Není tvrzeno audit clean.**
- Offline porovnání nového full-workspace lockfile s dříve autorizovaným advisorysnapshotem snížilo známý set180→2 unikátní GHSA, oba high,0critical. Nejde o nový online scan ani PWA-only počet. Zůstává Rollup2.79.2 v odloženém CRXJS a Sharp0.33.5 pod latest PWA assets-generator1.0.2. Sharp>=0.35 vyžaduje cílené API posouzení a skutečný test generování assetů před scopedoverride; následný QA checkpoint je otevřený, rodičovský semverrange není považován za definitivní zákaz ověřené migrace. Evidence: `implementation-phase1-offline-advisory-comparison.json`.

## Ověření

- Přímý PWA production Vite build PASS včetně manifestu a service workeru; root Turbo build nakonec4/4PASS (API/UI deklarace, core, PWA). PWA33precache entries před poslední čistou obnovou transitivního grafu; přesný finální počet ověří závěrečný build.
- Root workspace `pnpm typecheck`:4/4PASS. Lint:0errors/29warnings převážně původních any/exhaustive-deps; žádné plošné vypnutí hook kontrol.
- `pnpm install --frozen-lockfile` nad čerstvým lockfile PASS. Po poslední čisté obnově transitivního grafu následuje opětovné kompletní ověření v navazující etapě2.
- Testlead nezávisle ověřil deterministické adresy4mnemonics,3přesné signed TX bytes/hash a2historické vaulty; vše PASS. Runtime forma podpisu a derivace se nezměnila.
- Testlead: Vitest unit/store/API integrace PASS (první běh19, po rozšíření26; původní4security regresní cases byly dočasně pending do etapy2). Kubb4integrační scénáře: query arrays/origin, JSONhexData,400error a cancellation.
- Reálný Chromium productionPWA E2E4/4PASS: create/backup/reload/unlock, import/lock/wrongpass/unlock, browser history, skutečně podepsané bytes do mock API. Samostatně PWA→Boot4→PostgreSQL fullstack4/4PASS a service-worker/offline1/1PASS podle testlead evidence. Není to živá blockchain produkční síť; pouze syntetická data a lokální node mock.
- Prostředí WSL zdědilo Windows temp cestu: buildy spouštěny s TMPDIR=/tmp; Turbo nyní explicitně propouští TMPDIR/TMP/TEMP. To neobchází sandbox, používá povolený pracovní adresář. První chyby této konfigurace nejsou zakrývány jako runtime vady aplikace.

Etapa2 má samostatný report pro opravy původních aktivních nálezů; finální independent review, čerstvý online audit a sestavení aktuálních statických assets do backend artefaktu ještě následují.

## Navazující QA checkpoint — aktualizace stavu

Sharp hold byl následně vyřešen cíleným override `@vite-pwa/assets-generator@1.0.2>sharp:0.35.4`. QA ověřilo použitéAPI, skutečnou CLIgeneraci a dekódování6PNG/ICO souborů včetně rozměrů/alfa/nonblank pixelů. Frozen install prošel. Viz `implementation-final-pwa-assets.json` a `implementation-final-qa.md`. Finální offline porovnání staréhoadvisorysnapshotu nyní180→1GHSA, pouze odložený extensionRollup; onlineaudit stáleblokovaný, nikoli auditclean. Nový root script `test:assets` jej průběžně testuje vCI.
