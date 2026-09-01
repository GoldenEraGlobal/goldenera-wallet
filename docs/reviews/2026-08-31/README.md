# GoldenEra Wallet — review a následná implementace

Aktivní rozsah: **PWA frontend a Java backend**. Native aplikace a extension jsou podle uživatele předpřipravené a mimo aktuální vývoj. Koordinátor zadává implementaci, testy a nezávislé QA subagentům. Bez commitu, deploye, produkčních transakcí, skutečných uživatelských klíčů nebo změn produkční databáze.

Původní review z 31. 8. 2026 našlo **22 aktivních nálezů: 6× P1, 15× P2, 1× P3**. To je **historický výchozí stav, nikoliv počet stále neopravených problémů**. Po schválení uživatelem následovaly aktualizace, opravy a regresní testy. Zdrojové soubory, balíčky, lockfile a testy jsou nyní změněné. Původní nezměněný souhrn je v [initial-review-summary.md](initial-review-summary.md).

## Aktuální stav implementace

| Oblast | Stav a evidence |
|---|---|
| Aktualizace PWA | Implementované migrace Node24, pnpm11, Vite8, React19.2, Stackflow2/3, Kubb5, nativeTypeScript7.0.2, CryptoJJS0.5.0, BaseUIDrawer a souvisejících knihoven. Programatické nástroje mají oficiálníTS6APIbridge, produkčnítypecheck skutečně běžíTS7. [Etapa1 frontend](implementation-phase1-frontend.md), [TS7](implementation-followup-typescript.md), [Drawer](implementation-followup-drawer.md), [CryptoJJS](implementation-followup-cryptoj-js.md). |
| Aktualizace Java | Boot4.1.1, Jackson3, Hibernate7, Liquibase5, Springdoc3, Maven3.9.16 a kompatibilní knihovny. [Etapa1 backend](implementation-phase1-backend.md). |
| S1–S7 | Implementováno; nezávislé review i původně neúspěšný probe expirace legacy migrace nyní prošly. 43 trvalých security testů +11 crypto vectors PASS, včetně expiry i completion/error tokenů; součást99frontend testů. [Etapa2 security](implementation-phase2-security.md), [závěrečné QA](implementation-final-qa.md). |
| F1/F5/F6/F7/F8 | Implementováno,34novýchunit/RTLregresí a6původníchbrowserregresíPASS. PoTS7/Drawer/CryptoJ follow-upech prošlo114Vitest,25standardproduction,6Drawer a13fullstack;finálnístatics/JARshoda dokončena. |
| F10 | Root Turbo typecheck a aktivní PWA lint/CI kontroly zprovozněny v aktualizační etapě. |
| B1–B8/F11 | Implementováno, původní sada23 PostgreSQL/Tomcat testů PASS. Navíc nezávisle potvrzena a opravena neúplná upstream stránka zůstatků/pending; celý finální26-testový běh PASS,0 failures/errors/skipped. Navíc ověřen a opraven bypass public bucket/ceny přes encoded URL aliasy. Obě opravy prošly druhým nezávislým review. [Etapa2 backend](implementation-phase2-backend.md). |
| Sharp tooling | Přesně omezený override Sharp0.35.4, skutečný generator CLI a dekódování všech6 PNG/ICO výstupů PASS, frozen install PASS. [QA](implementation-final-qa.md). |
| Service worker update | Přechod předchozí→definitivní produkční build ověřen ve finální24-testové sadě, historický vault zachován. |
| Release artifact | **Aktualizováno po pasivním lokálním follow-upu:** Java21 clean verify34/34,license75/75,TS7 typecheck4/4,přesná dist/static/JAR shoda30assets a nový lokálnílinux/amd64Dockerimage zfinálního source. [Pasivní follow-up a aktuální artifact](../2026-09-01/passive-security-review.md). |
| Skutečný MAINNET READ smoke | Backend a1/1PWA browser PASS;14GET+20výslovněčtecíchbulkPOST,0mutací/tx. Schedulery vypnuté, exact-origin guard, redirectsNEVER, testDB oddělená. [Read report](implementation-mainnet-readonly.md). |
| Aktivní GitHub Actions |11stablefullSHA, pnpm/setup2, artifact7/8, actionlint a nezávisléreviewPASS. Workflow nebyl naGitHubu spuštěn. [CI report](implementation-final-ci.md). |
| Čerstvý online audit | **Blokován approval reviewerem** pro odeslání package metadat. Neopakováno ani neobcházeno. Finální offline srovnání starého snapshotu180 GHSA našlo jen1 high v odložené extension,0 critical; nejde o nový online audit. [Snapshot](implementation-final-offline-advisory-comparison.json). |

## Mapa původních nálezů na opravy a testy

Původní závažnosti zůstávají kvůli sledovatelnosti. Detailní review reporty popisují stav před opravou; aktuální výsledky jsou v implementačních reportech a QA.

| ID | Původní priorita | Opravené chování / regresní evidence |
|---|---|---|
| S1 | P1 | PRF/HKDF/AES-GCM wrapper, password fallback, samostatná jednorázová UV legacy migrace s novým heslem a2min ticketem. WebCrypto/fault boundaries, viz QA. |
| S2 | P1 | Storage fail-closed, existující vault nelze přepsat Create/Import; ověřený atomický zápis. wallet-lifecycle.test.ts. |
| F1 | P1 | Souběžný submit blokovaný už před preflight; session snapshot a validace zůstatku/nonce. frontend-submission.test.ts. |
| B1 | P1 | V1/V2 kontrakt a total/locked/spendable/disponibilní zůstatek. v2BalancesKeepLockedRewardsOutOfAvailableFundsAndV1StillWorks. |
| B2 | P1 | Validace filtrů a row/page/time budgety; další finální regrese odmítá neúplné upstream stránky. invalidWalletFiltersAndPaginationNeverReachTheNode, excessiveNodeResultsAndPageWorkAreBoundedInsteadOfScanningTheChain a nové truncation/encoded-path testy. |
| F11 | P1 | PostgreSQL18 parent mount, bezpečné pokyny pro existující data; skutečné data_directory ověřeno. |
| S3 | P2 | Mazání je ověřené; chyby a silent no-op nesmí hlásit no_wallet. wallet-lifecycle.test.ts. |
| S4 | P2 | Vault identity/revision, Web Locks, cross-tab invalidace a synchronní storage token před použitím klíče. Integrační/dvouokenní browser testy. |
| S5 | P2 | Epoch/AbortSignal guardy blokují pozdní dokončení po locku. Lifecycle/PRF testy. |
| S6 | P2 | Deadline při resume, activity neobnoví expirovanou session; navíc timeout/revokace recovery ticketu. Integrační/browser/nezávislý expiry probe. |
| S7 | P2 | Nepovinná registrace zařízení neblokuje lokální auth/backup, vlastní timeout. Stalled-register regrese. |
| B3 | P2 | Přesný offset pending/confirmed, bez vynechání/duplikátů. allHistoryRowsAppearExactlyOnceAcrossPendingConfirmedBoundaries. |
| B4 | P2 | GE fee rezervace zahrnují pending všech tokenů. nativeBalanceReservesFeesFromOtherTokensEvenWithNativeOnlyFilter. |
| B5 | P2 | Výchozí nedůvěra forwarded IP, explicitní trusted proxy. Skutečný Tomcat spoof-XFF test. |
| B6 | P2 | Connect/read deadline, omezený read retry, submit bez automatického opakování, bounded response buffer. Stalled-header/body HTTP testy. |
| B7 | P2 | Forward FK migration ON DELETE CASCADE a cleanup. PostgreSQL old-schema→new-schema i repository regrese. |
| F5 | P2 | Neplatné QR neuzamkne navigaci/skener. frontend-scanner.test.tsx a QR unit testy. |
| F6 | P2 | decimals=0 zůstává platná nulová přesnost. frontend-amounts.test.ts. |
| F7 | P2 | Send validace používá skutečná token decimals a atomické hodnoty. frontend-amounts/submission testy. |
| F8 | P2 | Filtr resetuje stránku historie, bezpečné empty/paging chování. frontend-history.test.tsx. |
| F10 | P2 | PWA typecheck je skutečný Turbo/CI task, TS chyby po upgradu opraveny. Etapa1 frontend. |
| B8 | P3 | Povinný validovaný webhook UUID a opravený quickstart. Configuration-binding regrese. |

Frontend testy jsou v frontend/tests, browser testy ve frontend/e2e; backendové názvy odkazují na src/test/java/global/goldenera/wallet/BackendCompatibilityTest.java. Skutečný PostgreSQL/Tomcat se kombinuje pouze s lokálním node stubem a syntetickými daty, bez broadcastu do produkční sítě.

## Vědomě držené verze a omezení

- Produkčnífrontend typecheck používá nativeTypeScript7.0.2. Typescript-eslint/tsup/Kubb zatím používají oficiálníTS6APIbridge, protožeTypeScript7 neposkytuje jejich podporovanéJavaScript compilerAPI; kontroly nejsou vypnuté.
- Java backend používá veřejnýCryptoJ0.0.5 aRLP0.0.1 spřipnutýmiSHA; frontend používá`@goldenera/cryptoj@0.5.0`. CrossJava,4address/3wire/2vault a forwardupgrade regrese prošly.
- Extension manifest/dependency graph,TS7typecheck aZIPbuild byly aktualizovány a prošly. Native/extension feature nálezyF2/F3/F4/F9 zůstávají mimo aktivníproduktovývývoj; Android/iOS device build vyžaduje příslušnéSDK/Xcode.
- Fyzická biometrie, Android/iOS device testy, nejstarší browser verze a upgrade kopie produkční DB nebyly ověřeny. PRF browser fixture není skutečný autentizátor.
- Offline npm srovnání nenahrazuje čerstvý audit ani Maven/JRE/OS analýzu.

## Historické podklady

| Dokument | Obsah před implementací |
|---|---|
| [Původní souhrn](initial-review-summary.md) | Výchozích22 nálezů, build/typecheck chyby a původní omezení review |
| [Security review](security-review.md) | S1–S7 původní příčiny a reprodukce |
| [Frontend review](frontend-review.md) | PWA nálezy a oddělená native/extension příloha |
| [Backend review](backend-review.md) | B1–B8 původní příčiny a podmínky |
| [Návrh aktualizací](dependency-upgrades.md) | Původní migrační analýza a zdroje |
| [Původní npm audit](npm-audit-analysis.md) | Autorizovaný full-workspace snapshot,180 unikátních advisory |
| [Původní inventář](dependency-inventory.json) | Historických100npm/34Maven položek |
| [Reprodukční podklady](evidence/README.md) | Bezpečné původní reprodukce, nikoliv aktuální projektová test suite |

## Finální lokální dodávka

- Frontend114/114unit/integration,25standardproduction browser,6/6Drawer,6/6forward/PRF,1/1SWupgrade a13/13syntheticfullstack prošly; všechny testy použily veřejná/syntetickádata a0externích transactionsubmitů.
- Po pasivním follow-upu finálníJava21cleanverify:34/34testů;75/75licensecheck. Docker JDK25 build ztéhožsource úspěšně zkompiloval Java21 bytecode a vytvořil lokální singlearch image.
- [SpustitelnýJAR](/home/andrej/Projects/goldenera/goldenera-wallet/target/goldenera-wallet-0.0.1.jar),SHA-256`c42b68aa2aa4b5e5d1838d7df79fa30594d0a50c38e9f1f9bf363b73ee0c361d`.
- [Aktuální pasivní artifact report](../2026-09-01/passive-security-review.md):30souborů dist/static/JAR/image-JAR je byteidentických. Lokálnílinux/amd64 image `goldenera-wallet:local-final-passive-20260901` má digest`sha256:20388e68308255092697ec22557da1f70d416e32cb1ff8f48023c501b27c3d92`.
- Vlastnísyntetické aJAR-smokePID/kontejnery jsouuklizené. `.env` nebyl čten/měněn; žádnýcommit/deploy/release/imagepush/securityscan/produkčnítransakce.

Otevřené limity zůstávají uvedené výše: podle poslední instrukce se neprováděl další bezpečnostní/CVE scan, fyzická biometrie a nejstaršíSafari/Firefox/device matice nejsou ověřené, GitHub-hosted workflow nebyl spuštěn a nativefeature nálezy zůstávajíodložené. PůvodníTS6/CryptoJ versionholdy byly mezitím vyřešeny popsanýmiTS7APIbridge aCryptoJ0.5/0.0.5 migracemi.


### Dodatečný závěrečný S4 checkpoint

Nezávisle ověřena a uzavřena race se session otevřenou během probíhající mutace
před doručením storage eventu, včetně následně reprodukované chyby cleanup po
password commitu. Vlastní session se váže na přesný publikovaný completion token;
invalidace nastává také při chybovém ukončení zahájené mutace.11 trvalých scénářů
pokrývá úspěchy i chyby create/import/delete/password migration a zachování seedu.
Samostatný finální security/crypto běh **54/54 PASS,0 skipped**; podrobnosti a omezení
v posledním dodatku [nezávislého QA](implementation-final-qa.md). Předchozí nižší
počty security testů výše jsou mezikroky; nové finální browser/fullstack a artifact
checkpointy se potvrzují jejich vlastními reporty až po posledním rebuildu.
