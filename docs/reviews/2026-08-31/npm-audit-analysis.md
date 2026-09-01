# GoldenEra Wallet — triáž auditu celého workspace pro aktivní PWA/backend

**Aktivní produktový scope je výhradně PWA a Java backend; extension a nativní aplikace jsou odložené. Audit je ale referenční scan CELÉHO workspace. Čísla203/199/180 nejsou PWA-only počty.** Žádný filtrovaný PWA-only audit ani nové instalace se při tomto upřesnění neprováděly.

Audit nyní skutečně proběhl: `pnpm audit --json`, exit1 znamená nalezená advisories. Vstup je `/tmp/goldenera-wallet-review/npm-audit.json`. Předchozí pokus byl zastaven auto-review, uživatel následně výslovně autorizoval odeslání inventáře; nejde již o neprovedenou kontrolu. Nic se neaktualizovalo.

## Co přesně znamenají čísla

Za **celý workspace včetně neaktivních částí**:1349 závislostí; **203 hlášených findings/cest**: critical4, high92, moderate96, low11. JSON obsahuje199 advisory záznamů, ale pouze **180 unikátních GHSA/URL** pro42 názvů balíčků. Jeden GHSA se může opakovat pro více verzových řad nebo cest. Kritické4 jsou4 unikátní GHSA; high92 cest je90 záznamů a75 unikátních GHSA. Nejde o203 potvrzených zneužitelných chyb walletu. Metadata `devDependencies:0` neznamenají, že všechny nálezy běží v browseru: např. Capacitor CLI a Kubb jsou generační/build nástroje.

## Čtyři critical nálezy za celý workspace

| Balíček / GHSA | Přítomná verze a cesta | Minimální oprava daného advisory | Skutečná relevance |
|---|---|---|---|
|[protobufjs / xq3m](https://github.com/advisories/GHSA-xq3m-2v4x-88gg)|7.5.4; apps/web → firebase → @firebase/firestore → @grpc/proto-loader → protobufjs|7.5.5; kvůli dalším high v témže auditu cílit nejméně7.6.1|RCE vyžaduje načtení útočníkem řízeného protobuf schématu/deskriptoru. V authored frontend src nebyl nalezen import Firebase ani protobuf/reflection použití. Není doložena cesta z wallet vstupu k nebezpečnému API; Firebase je přesto přímá manifestová závislost.|
|[shell-quote / w7jw](https://github.com/advisories/GHSA-w7jw-789q-3m8p)|1.8.3; packages/api → @kubb/core → @kubb/react-fabric → react-devtools-core → shell-quote|1.8.4|Command injection vyžaduje útočníkem ovládaný objektový `.op` token předaný quote a následně shellu. Jde o generační/developer cestu, nikoliv prokázaný produkční wallet endpoint.|
|[websocket-driver / xv26](https://github.com/advisories/GHSA-xv26-6w52-cph6)|0.7.4; apps/web → firebase → @firebase/database → faye-websocket → websocket-driver|0.7.5|Parsování starého draft WebSocket protokolu. Firebase Database se v authored src neimportuje; browser používá browser WebSocket, nikoliv automaticky tento Node driver. Proto nedokládá vzdálenou kritickou chybu běžící wallet SPA.|
|[tar / 23hp](https://github.com/advisories/GHSA-23hp-3jrh-7fpw)|7.5.7; apps/web → @capacitor/cli → tar|7.5.19|DoS při rozbalování útočníkem dodaného archivu bez limitu. Nativní CLI je odložené; nejde o blocker PWA vydání ani veřejný Java endpoint. Pokud zůstává v CI install grafu, evidovat supply-chain povrch; cílený native upgrade až při obnovení vývoje.|

Registry klasifikuje všechny čtyři jako critical, přesto některé záznamy mají odlišné či chybějící CVSS skóre; severity nepřepočítávám a netvrdím prokázaný RCE v aplikaci.

## High: prioritní runtime a jejich vstupní podmínky

**Axios1.13.4 je jediná jasně přímo používaná HTTP runtime knihovna v této skupině.** `frontend/packages/api/src/client.ts:3` vytváří axios instance s baseURL `/`, JSON Content-Type; `:22` volá `.request(config)`. Kód používají generované query hooks. Update na již ověřenou latest1.20.0 má přednost. Více high advisory vyžaduje opravy1.13.5–1.16.0; další moderate v auditu vyžadují novější patche, proto nestačí fixovat jen nejstarší high.

- [GHSA-43fc-jf86-j433](https://github.com/advisories/GHSA-43fc-jf86-j433): vlastní `__proto__` v request config může způsobit DoS; oprava>=1.13.5. Config zde skládá aplikace/generované hooky, import libovolného útočníkova JSON jako config nebyl prokázán.
- [GHSA-pf86-5x62-jrwf](https://github.com/advisories/GHSA-pf86-5x62-jrwf) a [GHSA-3g43-6gmg-66jw](https://github.com/advisories/GHSA-3g43-6gmg-66jw): response/config gadgets po **předchozím prototype pollution**; opravy>=1.15.1 a>=1.15.2. Relevantní browser třída rizika, ale audit sám nedokládá zdroj pollution ani kompletní exploit.
- [GHSA-hfxv-24rg-xrqf](https://github.com/advisories/GHSA-hfxv-24rg-xrqf): browser ReDoS při útočníkem nastaveném `xsrfCookieName`; oprava>=1.16.0. V prohlédnuté konfiguraci se tento parametr z uživatelského vstupu nenastavuje.
- [GHSA-777c-7fjr-54vf](https://github.com/advisories/GHSA-777c-7fjr-54vf): fetch adapter limity request/response; oprava>=1.16.0. Současný custom client nenastavuje fetch adapter ani maxBodyLength/maxContentLength; neprokázaná konkrétní cesta, vhodné ověřit při regresi.
- High NO_PROXY/proxy credentials/auth-header/Node HTTP adapter advisory nelze automaticky připsat browseru: aplikace backend je Java, axios zde není serverový Node transport. Platí zejména [GHSA-pmwg-cvhr-8vh7](https://github.com/advisories/GHSA-pmwg-cvhr-8vh7), [GHSA-p92q-9vqr-4j8v](https://github.com/advisories/GHSA-p92q-9vqr-4j8v), [GHSA-j5f8-grm9-p9fc](https://github.com/advisories/GHSA-j5f8-grm9-p9fc), [GHSA-35jp-ww65-95wh](https://github.com/advisories/GHSA-35jp-ww65-95wh). Přesto aktualizovat celý Axios balíček.

Další runtime-declared transitivní skupiny:

| Přímý balíček → transitivní nález | Fix minima pro zobrazenou větev | Triáž |
|---|---|---|
|firebase → protobufjs7.5.4|>=7.6.1 pro všechny zde viděné high protobuf advisory|Schema injection, prototype pollution a hluboká recursion; authored src Firebase import nenalezen. Zvážit odstranění skutečně nepoužívané dependency nebo update12.18.0 + lock ověření.|
|firebase → @grpc/grpc-js1.9.15|>=1.9.16 (jiné větve mají jiné patche)|Malformed HTTP2/compressed message může shodit Node client/server; wallet žádný grpc-js server nespouští. [GHSA-99f4](https://github.com/advisories/GHSA-99f4-grh7-6pcq).|
|@goldenera/cryptoj → viem → ws8.18.3|>=8.21.0|CryptoJ se používá pro klíče a podpisy, ale nevidím viem WebSocket RPC transport ani ws server/client použití; native browser websocket není npm ws. [GHSA-96hv](https://github.com/advisories/GHSA-96hv-2xvq-fx4p).|
|unstorage → h3 1.15.5|>=1.15.6|SSE injection vyžaduje h3 event stream; authored src nemá unstorage ani createEventStream. Skutečný StorageService používá Capacitor Preferences a SecureStoragePlugin. [GHSA-22cc](https://github.com/advisories/GHSA-22cc-p3c6-wpvm).|
|axios → form-data4.0.5|>=4.0.6|CRLF v Node multipart názvech/souborech; wallet customClient JSON, nikoliv Node multipart proxy. [GHSA-hmw2](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx).|
|shadcn → MCP SDK/Hono/Express|SDK>=1.26.0, Hono>=4.12.25, node-server>=1.19.10, path-to-regexp>=8.4.0 pro uvedené high|Shadcn je v dependencies, ale jde zde o CLI a zkopírované UI zdroje; žádný spuštěný MCP/Hono runtime v authored aplikaci nebyl nalezen. Po aktualizaci přesunout do devDependencies, pokud žádný runtime import není.|

**Cesty v auditu jsou reprezentativní, nikoliv kompletní reachability mapa.** Například shadcn je deklarován také ve web/core/ui, přesto JSON může hlásit cestu pouze přes `apps__extension`. Takový prefix nestačí pro odsunutí nálezu; rozhoduje graph aktivního PWA buildu a použití zranitelného API. Oddělený PWA počet z tohoto reportu nevypočítávám.

Absence importu byla ověřena v authored `frontend/**/src` souborech; kompletní byte-level produkční bundle reachability analýza není součástí této rychlé triáže. Nezaměňovat „neprokázaná runtime cesta“ za „není třeba opravovat“.

## High: aktivní PWA build/generování a odložené cesty

- Vite7.3.1 high jsou ve výstupu přiřazeny reprezentativní cestě `apps/extension > vite`. Aktivní PWA používá odlišný alias `rolldown-vite@7.3.1`; nelze automaticky přenést patched range balíčku `vite` na alias ani prohlásit PWA za nepostiženou. PWA migrace na Vite8.2.2 zůstává aktivní; před ní posoudit sdílený kód konkrétního advisory/aliasu. Extension Vite/CRX migrace je odložená. Dev-server rizika jsou oddělená od produkčního Java runtime.
- Rollup4.x fix>=4.59.0 a Rollup2.x fix>=2.80.0 (CRXJS) pro GHSA-mw96-cpmx-2vgc. Reportovaná cesta přes extension není automatickým vyloučením z PWA: PWA Workbox/build tooling může sdílet tutéž instalovanou verzi. Ověřit skutečný graph a řešit aktivní PWA rodiče; CRXJS-only cesta zůstává odložená.
- PostCSS8.5.6 high sourceMappingURL file read mají opravy>=8.5.12 a>=8.5.18; navržená8.5.26 obě pokrývá. Vstupem je CSS zpracované buildem, riziko při zpracování nedůvěryhodného CSS v CI. Nanoid v jeho grafu vyžaduje pro3.x nejméně3.3.18 pro uvedené high.
- PWA Workbox/Terser → serialize-javascript: fix>=7.0.3 pro dotčenou větev; assets-generator → sharp:>=0.35.0. Ověřit nové kompatibilní rodiče/transitivní lock; násilný major override může rozbít build.
- Reprezentativní CRXJS→cheerio→undici7.16.0 cesta je extension tooling, produktově odložená; poslední uvedená oprava>=7.29.0. Nesmí se tím automaticky vyřadit případné další cesty na tutéž verzi z aktivního PWA buildu. Audit nepředstavuje důkaz Node HTTP zranitelnosti produkční SPA.
- Kubb→ws zahrnuje8.18/8.19 i7.5.10; opravy>=8.21.0 a>=7.5.11 podle větve. Kubb/shell-quote zůstávají aktivní generační tooling pro PWA; tar/Capacitor CLI je odložené nativní tooling.

## Praktický postup

1. Prioritně Axios1.20.0 a kompatibilní frontend/build patch aktualizace; znovu audit a porovnat GHSA set, ne jen počet paths.
2. Prověřit a případně odstranit nepoužívané Firebase/unstorage; shadcn jako tooling. Přítomnost v package.json není důkaz aktivního runtime použití.
3. Obnovit transitivní lock přes kompatibilní rodiče; kde rodič stále drží zranitelnou verzi, navrhnout cílený zdokumentovaný override **teprve po** peer/API testu. Patch limit v tabulce je pro konkrétní advisory, není záruka nulových ostatních advisories.
4. CI/generátory aktualizovat odděleně od velkých Stackflow/Kubb/Boot migrací; bezpečnost vývojového prostředí se započítává, přesto ji nepopisovat jako potvrzené útoky na uživatele.
5. Po aktivních aktualizacích frozen install, PWA web build/tsc, offline/service-worker update a auth/signing/browser-vault testy plus Java integrační testy. Extension/native build není aktuální podmínkou. Tento scan je npm-only; aktivní Maven/container CVE nepokrývá, native CocoaPods/Gradle security je odložená roadmapa.

## Referenční critical/high záznamy celého workspace

Následující tabulka zachovává jednotlivé advisory records včetně opakovaných GHSA pro různé větve; nejde o další unikátní počet. Cesty jsou přímo z pnpm výstupu; nejsou to izolované PWA počty a jejich první workspace prefix sám neurčuje aktivní relevanci.

| Severity | Balíček/verze | GHSA | Patch range | Cesty |
|---|---|---|---|---|
| high | hono 4.11.1 | [GHSA-3vhc-576x-3qv4](https://github.com/advisories/GHSA-3vhc-576x-3qv4) | >=4.11.4 | apps__extension>shadcn>@modelcontextprotocol/sdk>@hono/node-server>hono |
| high | hono 4.11.1 | [GHSA-f67f-6cw9-8mq4](https://github.com/advisories/GHSA-f67f-6cw9-8mq4) | >=4.11.4 | apps__extension>shadcn>@modelcontextprotocol/sdk>@hono/node-server>hono |
| high | @isaacs/brace-expansion 5.0.0 | [GHSA-7h2j-956f-4vf2](https://github.com/advisories/GHSA-7h2j-956f-4vf2) | >=5.0.1 | apps__extension>shadcn>ts-morph>@ts-morph/common>minimatch>@isaacs/brace-expansion |
| high | @modelcontextprotocol/sdk 1.25.1 | [GHSA-345p-7cg4-v4c7](https://github.com/advisories/GHSA-345p-7cg4-v4c7) | >=1.26.0 | apps__extension>shadcn>@modelcontextprotocol/sdk |
| high | tar 7.5.7 | [GHSA-83g3-92jg-28cx](https://github.com/advisories/GHSA-83g3-92jg-28cx) | >=7.5.8 | apps__web>@capacitor/cli>tar |
| high | minimatch 3.1.2 | [GHSA-3ppc-4f35-3m26](https://github.com/advisories/GHSA-3ppc-4f35-3m26) | >=3.1.3 | .>eslint>minimatch |
| high | minimatch 5.1.6 | [GHSA-3ppc-4f35-3m26](https://github.com/advisories/GHSA-3ppc-4f35-3m26) | >=5.1.7 | apps__web>vite-plugin-pwa>workbox-build>@surma/rollup-plugin-off-main-thread>ejs>jake>filelist>minimatch |
| high | minimatch 9.0.5 | [GHSA-3ppc-4f35-3m26](https://github.com/advisories/GHSA-3ppc-4f35-3m26) | >=9.0.6 | .>eslint-plugin-unused-imports>@typescript-eslint/eslint-plugin>@typescript-eslint/parser>@typescript-eslint/typescript-estree>minimatch |
| high | minimatch 10.1.1 | [GHSA-3ppc-4f35-3m26](https://github.com/advisories/GHSA-3ppc-4f35-3m26) | >=10.2.1 | apps__extension>shadcn>ts-morph>@ts-morph/common>minimatch |
| high | rollup 4.54.0 | [GHSA-mw96-cpmx-2vgc](https://github.com/advisories/GHSA-mw96-cpmx-2vgc) | >=4.59.0 | apps__extension>vite>rollup |
| high | rollup 2.79.2 | [GHSA-mw96-cpmx-2vgc](https://github.com/advisories/GHSA-mw96-cpmx-2vgc) | >=2.80.0 | apps__extension>@crxjs/vite-plugin>rollup |
| high | minimatch 3.1.2 | [GHSA-7r86-cg39-jmmj](https://github.com/advisories/GHSA-7r86-cg39-jmmj) | >=3.1.3 | .>eslint>minimatch |
| high | minimatch 5.1.6 | [GHSA-7r86-cg39-jmmj](https://github.com/advisories/GHSA-7r86-cg39-jmmj) | >=5.1.8 | apps__web>vite-plugin-pwa>workbox-build>@surma/rollup-plugin-off-main-thread>ejs>jake>filelist>minimatch |
| high | minimatch 9.0.5 | [GHSA-7r86-cg39-jmmj](https://github.com/advisories/GHSA-7r86-cg39-jmmj) | >=9.0.7 | .>eslint-plugin-unused-imports>@typescript-eslint/eslint-plugin>@typescript-eslint/parser>@typescript-eslint/typescript-estree>minimatch |
| high | minimatch 10.1.1 | [GHSA-7r86-cg39-jmmj](https://github.com/advisories/GHSA-7r86-cg39-jmmj) | >=10.2.3 | apps__extension>shadcn>ts-morph>@ts-morph/common>minimatch |
| high | minimatch 3.1.2 | [GHSA-23c5-xmqv-rm74](https://github.com/advisories/GHSA-23c5-xmqv-rm74) | >=3.1.4 | .>eslint>minimatch |
| high | minimatch 5.1.6 | [GHSA-23c5-xmqv-rm74](https://github.com/advisories/GHSA-23c5-xmqv-rm74) | >=5.1.8 | apps__web>vite-plugin-pwa>workbox-build>@surma/rollup-plugin-off-main-thread>ejs>jake>filelist>minimatch |
| high | minimatch 9.0.5 | [GHSA-23c5-xmqv-rm74](https://github.com/advisories/GHSA-23c5-xmqv-rm74) | >=9.0.7 | .>eslint-plugin-unused-imports>@typescript-eslint/eslint-plugin>@typescript-eslint/parser>@typescript-eslint/typescript-estree>minimatch |
| high | minimatch 10.1.1 | [GHSA-23c5-xmqv-rm74](https://github.com/advisories/GHSA-23c5-xmqv-rm74) | >=10.2.3 | apps__extension>shadcn>ts-morph>@ts-morph/common>minimatch |
| high | serialize-javascript 6.0.2 | [GHSA-5c6j-r48x-rmvq](https://github.com/advisories/GHSA-5c6j-r48x-rmvq) | >=7.0.3 | apps__web>vite-plugin-pwa>workbox-build>@rollup/plugin-terser>serialize-javascript |
| high | hono 4.11.1 | [GHSA-q5qw-h33p-qvwr](https://github.com/advisories/GHSA-q5qw-h33p-qvwr) | >=4.12.4 | apps__extension>shadcn>@modelcontextprotocol/sdk>@hono/node-server>hono |
| high | @hono/node-server 1.19.7 | [GHSA-wc8c-qw6v-h7f6](https://github.com/advisories/GHSA-wc8c-qw6v-h7f6) | >=1.19.10 | apps__extension>shadcn>@modelcontextprotocol/sdk>@hono/node-server |
| high | tar 7.5.7 | [GHSA-qffp-2rhf-9h96](https://github.com/advisories/GHSA-qffp-2rhf-9h96) | >=7.5.10 | apps__web>@capacitor/cli>tar |
| high | tar 7.5.7 | [GHSA-9ppj-qmqm-q256](https://github.com/advisories/GHSA-9ppj-qmqm-q256) | >=7.5.11 | apps__web>@capacitor/cli>tar |
| high | flatted 3.3.3 | [GHSA-25h7-pfq9-p65f](https://github.com/advisories/GHSA-25h7-pfq9-p65f) | >=3.4.0 | .>eslint>file-entry-cache>flat-cache>flatted |
| high | undici 7.16.0 | [GHSA-f269-vfmq-vjvj](https://github.com/advisories/GHSA-f269-vfmq-vjvj) | >=7.24.0 | apps__extension>@crxjs/vite-plugin>cheerio>undici |
| high | undici 7.16.0 | [GHSA-vrm6-8vpv-qv8q](https://github.com/advisories/GHSA-vrm6-8vpv-qv8q) | >=7.24.0 | apps__extension>@crxjs/vite-plugin>cheerio>undici |
| high | undici 7.16.0 | [GHSA-v9p9-hfj2-hcw8](https://github.com/advisories/GHSA-v9p9-hfj2-hcw8) | >=7.24.0 | apps__extension>@crxjs/vite-plugin>cheerio>undici |
| high | h3 1.15.5 | [GHSA-22cc-p3c6-wpvm](https://github.com/advisories/GHSA-22cc-p3c6-wpvm) | >=1.15.6 | packages__core>unstorage>h3 |
| high | flatted 3.3.3 | [GHSA-rf6f-7fwh-wjgh](https://github.com/advisories/GHSA-rf6f-7fwh-wjgh) | >=3.4.2 | .>eslint>file-entry-cache>flat-cache>flatted |
| high | picomatch 2.3.1 | [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) | >=2.3.2 | apps__extension>@crxjs/vite-plugin>@rollup/pluginutils>picomatch |
| high | picomatch 4.0.3 | [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) | >=4.0.4 | .>eslint-plugin-unused-imports>@typescript-eslint/eslint-plugin>@typescript-eslint/parser>@typescript-eslint/typescript-estree>tinyglobby>picomatch |
| high | path-to-regexp 8.3.0 | [GHSA-j3q9-mxjg-w52f](https://github.com/advisories/GHSA-j3q9-mxjg-w52f) | >=8.4.0 | apps__extension>shadcn>@modelcontextprotocol/sdk>express>router>path-to-regexp |
| high | lodash 4.17.21 | [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) | >=4.18.0 | apps__web>vite-plugin-pwa>workbox-build>lodash |
| high | defu 6.1.4 | [GHSA-737v-mqg7-c878](https://github.com/advisories/GHSA-737v-mqg7-c878) | >=6.1.5 | apps__web>@vite-pwa/assets-generator>unconfig>defu |
| high | vite 7.3.1 | [GHSA-v2wj-q39q-566r](https://github.com/advisories/GHSA-v2wj-q39q-566r) | >=7.3.2 | apps__extension>vite |
| high | vite 7.3.1 | [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583) | >=7.3.2 | apps__extension>vite |
| high | @xmldom/xmldom 0.8.11 | [GHSA-wh4c-j3r5-mjhp](https://github.com/advisories/GHSA-wh4c-j3r5-mjhp) | >=0.8.12 | apps__web>@capacitor/cli>plist>@xmldom/xmldom |
| critical | protobufjs 7.5.4 | [GHSA-xq3m-2v4x-88gg](https://github.com/advisories/GHSA-xq3m-2v4x-88gg) | >=7.5.5 | apps__web>firebase>@firebase/firestore>@grpc/proto-loader>protobufjs |
| high | axios 1.13.4 | [GHSA-pmwg-cvhr-8vh7](https://github.com/advisories/GHSA-pmwg-cvhr-8vh7) | >=1.15.1 | packages__api>axios |
| high | axios 1.13.4 | [GHSA-pf86-5x62-jrwf](https://github.com/advisories/GHSA-pf86-5x62-jrwf) | >=1.15.1 | packages__api>axios |
| high | axios 1.13.4 | [GHSA-6chq-wfr3-2hj9](https://github.com/advisories/GHSA-6chq-wfr3-2hj9) | >=1.15.1 | packages__api>axios |
| high | axios 1.13.4 | [GHSA-43fc-jf86-j433](https://github.com/advisories/GHSA-43fc-jf86-j433) | >=1.13.5 | packages__api>axios |
| high | @xmldom/xmldom 0.8.11 | [GHSA-2v35-w6hq-6mfw](https://github.com/advisories/GHSA-2v35-w6hq-6mfw) | >=0.8.13 | apps__web>@capacitor/cli>plist>@xmldom/xmldom |
| high | @xmldom/xmldom 0.8.11 | [GHSA-f6ww-3ggp-fr8h](https://github.com/advisories/GHSA-f6ww-3ggp-fr8h) | >=0.8.13 | apps__web>@capacitor/cli>plist>@xmldom/xmldom |
| high | @xmldom/xmldom 0.8.11 | [GHSA-x6wf-f3px-wcqx](https://github.com/advisories/GHSA-x6wf-f3px-wcqx) | >=0.8.13 | apps__web>@capacitor/cli>plist>@xmldom/xmldom |
| high | @xmldom/xmldom 0.8.11 | [GHSA-j759-j44w-7fr8](https://github.com/advisories/GHSA-j759-j44w-7fr8) | >=0.8.13 | apps__web>@capacitor/cli>plist>@xmldom/xmldom |
| high | axios 1.13.4 | [GHSA-q8qp-cvcw-x6jj](https://github.com/advisories/GHSA-q8qp-cvcw-x6jj) | >=1.15.2 | packages__api>axios |
| high | protobufjs 7.5.4 | [GHSA-66ff-xgx4-vchm](https://github.com/advisories/GHSA-66ff-xgx4-vchm) | >=7.5.6 | apps__web>firebase>@firebase/firestore>@grpc/proto-loader>protobufjs |
| high | protobufjs 7.5.4 | [GHSA-75px-5xx7-5xc7](https://github.com/advisories/GHSA-75px-5xx7-5xc7) | >=7.5.6 | apps__web>firebase>@firebase/firestore>@grpc/proto-loader>protobufjs |
| high | protobufjs 7.5.4 | [GHSA-jvwf-75h9-cwgg](https://github.com/advisories/GHSA-jvwf-75h9-cwgg) | >=7.5.6 | apps__web>firebase>@firebase/firestore>@grpc/proto-loader>protobufjs |
| high | protobufjs 7.5.4 | [GHSA-685m-2w69-288q](https://github.com/advisories/GHSA-685m-2w69-288q) | >=7.5.6 | apps__web>firebase>@firebase/firestore>@grpc/proto-loader>protobufjs |
| high | @babel/plugin-transform-modules-systemjs 7.28.5 | [GHSA-fv7c-fp4j-7gwp](https://github.com/advisories/GHSA-fv7c-fp4j-7gwp) | >=7.29.4 | apps__web>vite-plugin-pwa>workbox-build>@babel/preset-env>@babel/plugin-transform-modules-systemjs |
| critical | shell-quote 1.8.3 | [GHSA-w7jw-789q-3m8p](https://github.com/advisories/GHSA-w7jw-789q-3m8p) | >=1.8.4 | packages__api>@kubb/core>@kubb/react-fabric>react-devtools-core>shell-quote |
| high | axios 1.13.4 | [GHSA-hfxv-24rg-xrqf](https://github.com/advisories/GHSA-hfxv-24rg-xrqf) | >=1.16.0 | packages__api>axios |
| high | @grpc/grpc-js 1.9.15 | [GHSA-5375-pq7m-f5r2](https://github.com/advisories/GHSA-5375-pq7m-f5r2) | >=1.9.16 | apps__web>firebase>@firebase/firestore>@grpc/grpc-js |
| high | @grpc/grpc-js 1.9.15 | [GHSA-99f4-grh7-6pcq](https://github.com/advisories/GHSA-99f4-grh7-6pcq) | >=1.9.16 | apps__web>firebase>@firebase/firestore>@grpc/grpc-js |
| high | axios 1.13.4 | [GHSA-777c-7fjr-54vf](https://github.com/advisories/GHSA-777c-7fjr-54vf) | >=1.16.0 | packages__api>axios |
| high | axios 1.13.4 | [GHSA-p92q-9vqr-4j8v](https://github.com/advisories/GHSA-p92q-9vqr-4j8v) | >=1.16.0 | packages__api>axios |
| high | axios 1.13.4 | [GHSA-j5f8-grm9-p9fc](https://github.com/advisories/GHSA-j5f8-grm9-p9fc) | >=1.16.0 | packages__api>axios |
| high | axios 1.13.4 | [GHSA-3g43-6gmg-66jw](https://github.com/advisories/GHSA-3g43-6gmg-66jw) | >=1.15.2 | packages__api>axios |
| high | axios 1.13.4 | [GHSA-35jp-ww65-95wh](https://github.com/advisories/GHSA-35jp-ww65-95wh) | >=1.16.0 | packages__api>axios |
| high | form-data 4.0.5 | [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) | >=4.0.6 | packages__api>axios>form-data |
| high | undici 7.16.0 | [GHSA-vxpw-j846-p89q](https://github.com/advisories/GHSA-vxpw-j846-p89q) | >=7.28.0 | apps__extension>@crxjs/vite-plugin>cheerio>undici |
| high | ws 8.19.0, 8.18.0, 8.18.3 | [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) | >=8.21.0 | packages__api>@kubb/core>@kubb/react-fabric>@kubb/fabric-core>ws; packages__api>@kubb/core>@kubb/react-fabric>ws; packages__core>@goldenera/cryptoj>viem>ws |
| high | ws 7.5.10 | [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) | >=7.5.11 | packages__api>@kubb/core>@kubb/react-fabric>react-devtools-core>ws |
| high | @modelcontextprotocol/sdk 1.25.1 | [GHSA-8r9q-7v3j-jr4g](https://github.com/advisories/GHSA-8r9q-7v3j-jr4g) | >=1.25.2 | apps__extension>shadcn>@modelcontextprotocol/sdk |
| critical | websocket-driver 0.7.4 | [GHSA-xv26-6w52-cph6](https://github.com/advisories/GHSA-xv26-6w52-cph6) | >=0.7.5 | apps__web>firebase>@firebase/database>faye-websocket>websocket-driver |
| high | protobufjs 7.5.4 | [GHSA-wcpc-wj8m-hjx6](https://github.com/advisories/GHSA-wcpc-wj8m-hjx6) | >=7.6.1 | apps__web>firebase>@firebase/firestore>@grpc/proto-loader>protobufjs |
| high | vite 7.3.1 | [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | >=7.3.5 | apps__extension>vite |
| high | brace-expansion 2.0.2 | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | >=2.1.2 | .>eslint-plugin-unused-imports>@typescript-eslint/eslint-plugin>@typescript-eslint/parser>@typescript-eslint/typescript-estree>minimatch>brace-expansion |
| high | brace-expansion 1.1.12 | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | >=1.1.16 | .>eslint>minimatch>brace-expansion |
| high | js-yaml 4.1.1 | [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m) | >=4.3.0 | .>eslint>@eslint/eslintrc>js-yaml |
| critical | tar 7.5.7 | [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw) | >=7.5.19 | apps__web>@capacitor/cli>tar |
| high | tar 7.5.7 | [GHSA-8x88-c5mf-7j5w](https://github.com/advisories/GHSA-8x88-c5mf-7j5w) | >=7.5.18 | apps__web>@capacitor/cli>tar |
| high | shell-quote 1.8.3 | [GHSA-395f-4hp3-45gv](https://github.com/advisories/GHSA-395f-4hp3-45gv) | >=1.9.0 | packages__api>@kubb/core>@kubb/react-fabric>react-devtools-core>shell-quote |
| high | hono 4.11.1 | [GHSA-88fw-hqm2-52qc](https://github.com/advisories/GHSA-88fw-hqm2-52qc) | >=4.12.25 | apps__extension>shadcn>@modelcontextprotocol/sdk>@hono/node-server>hono |
| high | fast-uri 3.1.0 | [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx) | >=3.1.4 | apps__extension>shadcn>@modelcontextprotocol/sdk>ajv>fast-uri |
| high | sharp 0.33.5 | [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | >=0.35.0 | apps__web>@vite-pwa/assets-generator>sharp |
| high | postcss 8.5.6 | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) | >=8.5.12 | apps__web>postcss |
| high | brace-expansion 1.1.12 | [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | >=1.1.17 | .>eslint>minimatch>brace-expansion |
| high | brace-expansion 2.0.2 | [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | >=2.1.3 | .>eslint-plugin-unused-imports>@typescript-eslint/eslint-plugin>@typescript-eslint/parser>@typescript-eslint/typescript-estree>minimatch>brace-expansion |
| high | undici 7.16.0 | [GHSA-4cwx-7wf7-3272](https://github.com/advisories/GHSA-4cwx-7wf7-3272) | >=7.29.0 | apps__extension>@crxjs/vite-plugin>cheerio>undici |
| high | fast-uri 3.1.0 | [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) | >=3.1.5 | apps__extension>shadcn>@modelcontextprotocol/sdk>ajv>fast-uri |
| high | brace-expansion 2.0.2 | [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | >=2.1.4 | .>eslint-plugin-unused-imports>@typescript-eslint/eslint-plugin>@typescript-eslint/parser>@typescript-eslint/typescript-estree>minimatch>brace-expansion |
| high | brace-expansion 1.1.12 | [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | >=1.1.18 | .>eslint>minimatch>brace-expansion |
| high | js-yaml 4.1.1 | [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) | >=4.3.1 | .>eslint>@eslint/eslintrc>js-yaml |
| high | nanoid 3.3.11 | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) | >=3.3.16 | apps__web>postcss>nanoid |
| high | nanoid 3.3.11 | [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | >=3.3.18 | apps__web>postcss>nanoid |
| high | postcss 8.5.6 | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | >=8.5.18 | apps__web>postcss |
| high | fast-uri 3.1.0 | [GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6) | >=3.1.1 | apps__extension>shadcn>@modelcontextprotocol/sdk>ajv>fast-uri |
| high | tar 7.5.7 | [GHSA-r292-9mhp-454m](https://github.com/advisories/GHSA-r292-9mhp-454m) | >=7.5.21 | apps__web>@capacitor/cli>tar |
| high | fast-uri 3.1.0 | [GHSA-4c8g-83qw-93j6](https://github.com/advisories/GHSA-4c8g-83qw-93j6) | >=3.1.3 | apps__extension>shadcn>@modelcontextprotocol/sdk>ajv>fast-uri |
| high | fast-uri 3.1.0 | [GHSA-v39h-62p7-jpjc](https://github.com/advisories/GHSA-v39h-62p7-jpjc) | >=3.1.2 | apps__extension>shadcn>@modelcontextprotocol/sdk>ajv>fast-uri |
