# GoldenEra Wallet — aktivní PWA frontend, transakce a build

**Aktivní rozsah po upřesnění uživatele: pouze PWA a její backend. Nativní aplikace a extension jsou předpřipravené mimo vývoj; jejich čtyři poznámky jsou přesunuté na konec a nezapočítávají se do aktivních priorit.**

Review k 2026-08-31, commit `d2dc2830dd2618c138eff209df1abd1be190537a`. Zdrojový kód a manifesty nebyly měněny. Zabezpečení vaultu a Java backend mají samostatné reporty. Priority: P1 opravit před vydáním příslušné platformy; P2 opravit v nejbližší iteraci. Nálezy neznamenají, že byl celý systém penetračně otestován.

## F1 — [P1] Souběžné potvrzení může odeslat dvě samostatné platby

Místo: [TxSubmitCard.tsx:286](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/components/TxSubmitCard.tsx:286), zejména 286–295, a předání `isLoading={isSubmitting}` na řádku 537.

`onConfirm` neobsahuje guard proti souběžnému volání. Tlačítko zůstává aktivní během `refetchNextNonce()` a `refetchBalances()`; `isSubmitting` pokrývá až samotný POST. Druhé kliknutí může zahájit nový nonce request ještě před prvním POSTem, ale jeho odpověď může přijít až po přijetí první platby. Pak druhé volání podepíše stejnou částku a příjemce s dalším nonce: nejde o opakování stejného hashe, které by node odmítl.

Ověření: reprodukce extrahovala přímo současnou funkci `onConfirm`, použila skutečný `@goldenera/cryptoj@0.2.0` a řízené odpovědi mock API. Nezávislé ověření subagentem použilo také skutečné TanStack `QueryClient` a `QueryObserver`: dvě podepsané platby s nonce 1 a 2, dva nonce fetches a žádné zrušení. Deduplikace dotazů tomuto pořadí nebrání, protože první nonce už je dokončený při zahájení druhého. Žádná transakce nebyla odeslána do skutečné sítě. Podmínkou je dvojí kliknutí v preflight fázi a odpovídající síťové pořadí.

Náprava: synchronní guard celé operace, busy stav od prvního potvrzení až do dokončení a jednorázová identita review. Zamčení/cancel musí invalidovat ještě neodeslanou operaci; již přijatý POST nelze UI tlačítkem odvolat.

## F5 — [P2] Neplatný QR kód trvale zablokuje aktuální skener

Místo: [ScanQrCodePage.tsx:58](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/pages/ScanQrCodePage.tsx:58), řádky 58–64, a cancel guard níže.

`hasNavigated.current` se nastaví před `stringToQrData()`. Libovolný běžný QR kód, například URL, vyhodí výjimku; callback ji neobslouží. Flag zůstane true, další validní kódy se ignorují a `onCancel` se stejným guardem také ihned vrací. `stopScan()` se vůbec nezavolá.

Ověřeno extrakcí současného callbacku s neplatným vstupem: flag true, žádná navigace ani zastavení. Náprava: validovat v try/catch před nastavením navigačního flagu, ukázat srozumitelnou chybu a povolit další sken/cancel.

## F6 — [P2] Token s nulovým počtem desetinných míst je zobrazen jako token s osmi

Místo: [TokenList.tsx:49](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/components/TokenList.tsx:49); stejný problém [TokenDetailPage.tsx:85](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/pages/TokenDetailPage.tsx:85) a [TransferDetail.tsx:47](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/components/TransferDetail.tsx:47).

`numberOfDecimals || 8` považuje platnou nulu za chybějící údaj. Token s decimals=0 a raw balance=100 se ukáže jako `0.00000100` namísto 100. Send přitom používá `?? 8`, tedy zobrazení a podepisované jednotky se rozcházejí.

Náprava: používat nullish fallback a otestovat decimals 0/8/18 napříč balance, historií, receive i send. Formátovač také pro decimals=0 nyní připojí `.0`; to je menší formátovací odchylka, nikoli další závažný nález.

## F7 — [P2] Validace částky používá osm desetinných míst i pro jiné tokeny

Místo: [TxSubmitCard.tsx:48](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/components/TxSubmitCard.tsx:48), řádky 48–50.

Form schema volá `Amounts.parseTokens`, které v zamčeném balíčku používá osm decimals. Pozdější podpis správně používá `parseWithDecimals(..., tokenDecimals)`. Například `0.000000001` tokenu s 18 decimals je platných 1 000 000 000 nejmenších jednotek, ale schema částku zkrátí na nulu a odmítne jako nekladnou.

Ověřeno skutečným `@goldenera/cryptoj@0.2.0`. Náprava: validovat stejnou škálou jako podpis a odmítat neplatný formát/přesnost bez neobsloužené výjimky parseru. Metadata tokenu musí být známa před validací částky.

## F8 — [P2] Změna filtru historie může schovat existující převody i ovládání stránek

Místo: [TransferList.tsx:159](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/components/TransferList.tsx:159), řádky 159–170; vykreslení prázdného stavu a pagination na 240–290.

`pageNumber` se při změně `transferType` neresetuje. Na třetí stránce historie uživatel zvolí filtr, který má jen jednu stránku: request nadále žádá třetí stránku, přijde prázdný content a UI ukáže „No transactions yet“. Pagination se vykresluje pouze v neprázdné větvi, takže nelze přejít zpět na první stránku vybraného filtru.

Náprava: resetovat stránku se změnou filtru/adresy/tokenu a ošetřit pokles `totalPages` po pollingu. Samostatná chyba backendového skládání pending/confirmed je v backend reportu; nejde o duplicitu.

## F10 — [P2] Standardní typecheck nefunguje a release pipeline ho nespouští

Místo: [turbo.json:4](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/turbo.json:4), řádky 4–13; [frontend/package.json:15](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/package.json:15).

Root script volá `turbo typecheck`, ale tato task není v Turbo configu. Ověřený příkaz končí `Could not find task typecheck in project`. Web/extension navíc vůbec nemají typecheck script a jejich build je jen Vite transformace. Přímá kontrola aplikačními tsconfigy odhalila 32 TS chyb pro web a 5 pro extension, které build ignoruje (type-only importy, NodeJS namespace, nepoužité proměnné). Čísla se překrývají v shared core; nejsou to desítky nezávislých runtime chyb.

Náprava: zavést funkční task včetně pořadí sestavení deklarací UI a typecheck scriptů pro obě aplikace; přidat do CI. V samostatném core tsconfigu kontrola po UI build prošla. Lint má převážně formátovací dluh; report jej nepočítá jako samostatné bezpečnostní nálezy.

## F11 — [P1] PostgreSQL 18 v quickstartu používá špatný persistentní mount

Místo: [README.md:75](/home/andrej/Projects/goldenera/goldenera-wallet/README.md:75) spolu s image na řádku 64.

Compose používá `postgres:18.1-alpine`, ale hostitelská data mountuje do `/var/lib/postgresql/data`. Od verze 18 je default PGDATA `/var/lib/postgresql/18/docker` a doporučený volume target `/var/lib/postgresql`. Dokumentovaný mount tedy nepokrývá aktivní PGDATA. Oficiální současný entrypoint navíc detekuje starý mount a odmítá takové uspořádání; konkrétní historický digest 18.1 nebyl spuštěn. Minimálně persistenční konfigurace je pro tuto verzi chybná a recreate může oddělit aplikaci od jejích dosavadních databázových dat.

Náprava: opravit target podle verze image; u existujících dat udělat zálohu a řízenou migraci/pg_upgrade, nepouze přepnout mount nebo major verzi nad starým clusterem. Zdroje: [oficiální image — PGDATA](https://hub.docker.com/_/postgres#pgdata), [oficiální entrypoint](https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh). Ztráta databáze zde znamená backendová metadata, nikoli přímé smazání klientských privátních klíčů.

## Ověření a omezení

- Frozen instalace všech šesti workspace projektů: pnpm 10.28.2, Node 24.19.0, 1236 balíčků, pouze v `/tmp`. Lifecycle skripty instalace byly vypnuté; dostupné binární build nástroje poté fungovaly.
- Web `vite build`: PASS včetně PWA/service workeru po nastavení `TMPDIR=/tmp`. První selhání na zděděném Windows temp adresáři bylo prostředí, nikoli chyba projektu.
- Extension `vite build`: PASS včetně ZIP. Runtime API kompatibilitu tento výsledek neověřuje.
- UI `tsup` včetně deklarací: PASS. API/UI přímý typecheck: PASS. Core typecheck po UI build: PASS.
- Root `pnpm typecheck`: FAIL (Turbo task). Přímé aplikační tsc: web 32, extension 5 diagnostik.
- Lint 84 autorských TS/TSX souborů: 847 errors, 32 warnings; 538 quotes a 273 semi. Nebyly prováděny automatické opravy.
- Transakční a QR reprodukce: mock API, skutečný crypto balíček; žádné reálné převody, žádné čtení uživatelských secrets.
- Android/iOS instalace, reálná biometrie, kamera, release na Store a živý node/DB end-to-end test nebyly provedeny.
- Vedlejší kompatibilní omezení: transakce mají napevno `Network.MAINNET` (`TxSubmitCard.tsx:334`); při připojení backendu k TESTNET je node odmítne. Pokud je wallet záměrně mainnet-only, má konfigurace takové připojení včas odmítnout; bez potvrzeného požadavku na testnet to nepočítám jako další chybu.
- Android manifest výslovně nedeklaruje CAMERA požadované scanner pluginem. Protože další scanner závislosti mohou permission dodat transitivním manifest mergerem, bez merged manifestu to nepočítám jako potvrzenou chybu; zkontrolovat v nativním build smoke testu.
- Fixní odhad fee 150 B nebyl automaticky označen jako chyba: několik reprezentativních podepsaných TRANSFER mělo 137–144 B. Pro krajní velikosti částek/nonce a měnící se síťové poplatky doplnit testy podle skutečného encoded size.

## Odložené poznámky pro případ obnovení native/extension vývoje

Následující položky nejsou požadavky na aktuální PWA release ani blokery jejího vývoje. Uchovány pouze jako reference, protože širší review proběhlo před upřesněním scope.

### F2 — [Odloženo, mimo aktivní rozsah] Rozšíření posílá API požadavky na vlastní extension origin

Místo: [client.ts:3](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/api/src/client.ts:3), řádky 3–8; [manifest.config.ts:27](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/apps/extension/manifest.config.ts:27).

Jediný Axios klient má `baseURL: '/'`. Popup ani sidepanel tuto hodnotu nenastavují a `createApp({ isExtension: true })` pouze mění rozpoznání platformy. V nainstalovaném rozšíření proto `/api/core/v1/wallet/tokens`, balances a submit míří na `chrome-extension://<id>/api/...`, kde backend neexistuje. Úspěšný Vite build tuto chybu neodhalí.

Náprava: explicitní HTTPS API URL pro extension před inicializací aplikace, odpovídající oprávnění hostu a CORS politika. Same-origin default ponechat pro web nasazený spolu s backendem. Testovat nainstalovaný release ZIP, nikoli jen build.

### F3 — [Odloženo, mimo aktivní rozsah] Nativní release načítá peněženku z vývojového serveru

Místo: [capacitor.config.ts:7](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/apps/web/capacitor.config.ts:7), řádky 7–10. Stejné nastavení je zkopírováno do nativních `capacitor.config.json`.

Konfigurace bez rozlišení debug/release nastavuje `server.url` na vývojový frontend. APK/IPA tedy nepoužívá auditované HTML/JS v `webDir: dist`, nýbrž kód dodaný tímto serverem. Jeho dostupnost a změny ovládají přístup k wallet; vzdálenému kódu jsou současně dostupné nativní pluginy používané pro vault. Jde o riziko release sestaveného z aktuální konfigurace, nikoli důkaz napadení domény.

Náprava: dev URL podmínit vývojovým režimem, release balit s lokálními assets; adresu backendu řešit odděleně. Změnu originu doprovodit testem migrace dostupnosti stávajícího vaultu/WebAuthn. `cleartext: true` do release nepřenášet. Účel `server.url` a produkční omezení potvrzuje [oficiální konfigurace Capacitoru](https://capacitorjs.com/docs/config).

### F4 — [Odloženo, mimo aktivní rozsah] Android MAIN/LAUNCHER je sloučený s filtrem URI

Místo: [AndroidManifest.xml:20](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/apps/web/android/app/src/main/AndroidManifest.xml:20), řádky 20–26.

Jediný filtr launcher activity obsahuje jak MAIN/LAUNCHER, tak VIEW/BROWSABLE a požadovaný scheme `goldenera`. Běžný launcher intent nemá URI; proto neprojde data testem filtru. Aplikace nemusí být dostupná v launcheru, i když ji lze spustit explicitní activity z Android Studia.

Ověření: statická konfigurace plus pravidla [Android intent matching](https://developer.android.com/guide/components/intents-filters#DataTest). APK na zařízení nebylo sestaveno/spuštěno. Náprava: oddělit MAIN/LAUNCHER bez `<data>` od samostatného deep-link filtru a ověřit `resolve-activity` pro MAIN/LAUNCHER.

### F9 — [Odloženo, mimo aktivní rozsah] Čerstvá instalace balíčků neodpovídá nativním projektům

Místo: [Podfile:1](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/apps/web/ios/App/Podfile:1) a [capacitor.settings.gradle:3](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/apps/web/android/capacitor.settings.gradle:3).

Nativní integrace má napevno vygenerované `.pnpm` cesty na Capacitor 8.0.1 a starší pluginy, ale frozen lockfile instaluje 8.0.2 a novější odpovídající pluginy. Tyto 8.0.1 adresáře v čisté instalaci chybí. CocoaPods nezvládne už úvodní require a Gradle odkazuje na neexistující projekty; starý lokální node_modules store může problém maskovat.

Náprava: spouštět `cap sync` po frozen install/build, ověřit čisté nativní sestavení a preferovat stabilní workspace symlink cesty tam, kde konfigurace není generována CLI. Další dopady synchronizace jsou v plánu aktualizací. Xcode/Android SDK build nebyl zde spuštěn.
