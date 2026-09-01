# Follow-up — nedokončené ověření a TS7/CryptoJ kompatibilita

Tento dokument odděluje skutečně otevřené body od již dokončeného review/implementace. Výchozí artefakt měl99 JS unit/integration testů,24 produkčních browser scénářů,13 syntetických full-stack scénářů,26 Java integračních testů a1 guarded MAINNET read-only smoke; vše prošlo. S1–S7, jejich11 mutation-exit scénářů, skutečný SW update,6 generovaných image assets i přesná dist/static/JAR/HTTP shoda30 souborů už byly ověřeny. Starší průběžné reporty je nelze znovu označovat za nedokončené.

## Otevřené body před tímto follow-upem

| Bod | Původní skutečný stav | Co lze dokončit / hranice |
|---|---|---|
| TypeScript7 | Použit6.0.3 kvůli JavaScript API konzumentům. | Frontend agent migruje skutečný compiler/CLI na7; oficiální TS6 API bridge pro nástroje se vykáže zvlášť. Nezávisle ověřit verzi každé používané tsc cesty, typecheck, DTS, lint, generátor a testy. |
| Interní Java CryptoJ | Dostupný0.0.1 artifact, nejnovější privátní release nebyl prokázán. | Backend agent ověří skutečné souřadnice/verzi a migruje bez přepsání již vydané verze. JS CryptoJ0.4.1 byl již aktuální; jeho aktuálnost a wire kompatibilita se ověří znovu. |
| Čerstvý online audit | Export package graphu byl explicitně zamítnut approval reviewerem. | Zde se bez změny schváleného stavu neopakuje a neobchází jiným endpointem. Offline srovnání starého snapshotu není nový audit. Koordinátor řeší případný nový autorizovaný běh až nad finálním grafem. |
| Skutečná WebAuthn/PRF browser cesta | Dosud JS mock navigator.credentials; skutečné WebCrypto, ale ne skutečný browser authenticator stack. | Chromium CDP má `hasPrf`; implementovat skutečné navigator.credentials create/get přes virtuální CTAP2 a rozlišit jej od fyzického senzoru. Žádné uživatelské passkeys ani hardware credentials. |
| Fyzický autentikátor / browser minimum | Fyzické FaceID/fingerprint/USB a nejstarší podporované browsery nebyly otestovány. | Emulátor není náhrada fyzického výsledku. Minimální podporované verze potřebují konkrétní produktovou matici; současný Chrome výsledek se nesmí vydávat za Safari/Firefox/device pokrytí. |
| Docker image build/runtime | Ověřen JAR a jeho skutečné HTTP assets, nikoli celý Dockerfile/multiarch image. | Lze lokální build a izolovaný run bez push, pokud je lokální Docker a bezpečně dostupné privátní build dependencies. Nevkládat credentials do vrstev/contextu. Backend vlastní tento krok a cleanup. |
| GitHub workflow execution | Actionlint/manifests/inputs/fullSHA a lokální ekvivalenty prošly; hosted workflow nebyl spuštěn. | Workflow má push/release/registry zápisy. Nespoštět ho jako údajně neškodný test. Lokální lint/build ověření neověří skutečné GitHub permissions, cache restore, artifacts nebo registry publish. |
| Produkční DB upgrade rehearsal | Testována reálná dočasná PG18 databáze, staré schéma a FK migrace; nikoli kopie produkčních dat. | Bez autorizované anonymizované kopie dat netvrdit produkční rehearsal. Nevytahovat produkční DB dump jen kvůli testu. |
| Publikování/commit/deploy | Lokální JAR hotový; nic nebylo pushnuto, zveřejněno nebo nasazeno. | Není implicitní součástí „dodělat testy“. Žádný GitHub release, image push, commit/push nebo mainnet transakce. |
| Native/extension | Funkční F2/F3/F4/F9 byly mimo aktivní vývoj. | Případné nově přikázané aktualizace jejich package/config držení a minimální build smoke oddělit od nového feature vývoje. Neoznačovat device/runtime chyby za uzavřené pouhým frontend buildem. |
| Celkový audit všech crypto/JRE/OS kombinací | Neproveden a nebyl nahrazen testy. | Uvést jako rozsah omezení; nenahrazovat chybějící fresh audit tvrzením „bez zranitelností“. |

## Zachovaná baseline

Před změnami follow-upu byl schválený TS6/PWA dist zkopírován do `/tmp/goldenera-wallet-followup/baseline-dist`; souborový manifest je `baseline-manifest.json`. Původní nejstarší release z úvodního review zůstává v `/tmp/goldenera-wallet-review/frontend/apps/web/dist`. Kopie neobsahují `.env` a testy nepoužívají skutečné uživatelské klíče.

Původní veřejné goldeny z CryptoJ0.2.0 zůstávají v `frontend/tests/fixtures/crypto-v0.2.0.json`:4 derivace mnemonic/passphrase/index→address,3 přesné signed TRANSFER bytes/hash a2 historické encrypted vaulty. Jejich očekávání se nebudou přegenerovávat jen proto, aby nová knihovna prošla. Nový parser/compiler ani lib nesmí změnit seed, derivaci, adresu, signature/wire bytes, nonce/amount typ nebo schopnost číst starý ciphertext.

## Tvrdá acceptance pro existující peněženky

1. Nejstarší původní v1 password-only vault musí fungovat po upgradu bez ručního importu seedu.
2. Již opravený v2 wallet record musí přežít upgrade stejného originu se stejnou identitou, revizí, adresou a seedem.
3. Starý nebezpečný biometrický wrapper musí stále vést přes výslovnou UV/password migraci; nesmí se vrátit do běžného authenticate.
4. Nový PRF wrapper musí jít odemknout po načtení nové aplikace se stejným credential a stejným originem. Credential ani wrapper nesmí být nevratně odstraněn při chybě migrace.
5. Fault matrix před/po write commit, readback, cleanup, expiry/cancel i delayed cross-tab events musí zachovat bezpečný přístup původním nebo ověřeným novým heslem podle skutečně dokončeného zápisu.
6. Browser/service-worker upgrade musí skutečně načíst nový build; seed backup doporučení není náhrada fungující migrace. Downgrade staré aplikace po změně formátu není tvrzen jako podporovaný.

Nezávislé ověření po migraci: compiler/API verze, frozen install, unit/integration, původní goldeny, produktový typecheck, lint/DTS/Kubb, aktuální produkční browser sada, fresh backend full-stack a finální dist/static/JAR manifest. MAINNET smoke pouze přes separátní guarded launcher a dočasnou DB; povolené jsou jen ověřené čtecí operace,0 transakcí a0 semantických mutací.

## Virtuální PRF ověření

Nový `frontend/e2e/webauthn-virtual.spec.ts` používá `WebAuthn.enable` / `addVirtualAuthenticator` přes CDP, `hasPrf`, skutečné browser `navigator.credentials` a credentialAdded/credentialAsserted events. Neobsahuje nahrazení navigator.credentials ani JS fake credential responses. Testuje PRF enrollment/unlock, odmítnutí bad UV a autentikátor bez PRF s password fallbackem. Používá doménu localhost pro RP ID, ne IP origin.

Příslušné rozhraní a emulační parametry jsou doloženy [oficiálním CDP WebAuthn protokolem](https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/). Virtuální CTAP2 ověří browser/FIDO/PRF integraci; nedokazuje fyzický fingerprint, ochranu hardware ani synchronizaci passkeys mezi skutečnými zařízeními.

Výsledek: první pokus na IP originu podle očekávání nevytvořil PRF wrapper; password fallback prošel. Na platném localhost RP následně prošly **2/2** případy: reálný virtual CTAP2 PRF enrollment/assertion, odemčení a bad-UV odmítnutí; a skutečný browser fallback autentikátoru bez PRF. Produkční BiometricService nebylo potřeba měnit.

Forward compatibility matrix nad novým TS7 buildem prošla **6/6**: nejstarší v1/password; v1 plus skutečný legacy WebAuthn credential a řízená změna hesla; předchozí opravený v2/password; předchozí v2 plus skutečný PRF credential přežívající načtení nového buildu; oba samostatné genuine-PRF/fallback případy. V každém upgradu zůstala adresa stejná a následný reload se znovu odemkl; password-only a PRF záznam zůstaly byte-identické, legacy migrace bezpečně změnila ciphertext a odstranila starý wrapper až po ověření. Předchozí v2 record byl navíc uložen jako veřejná fixture `vault-v2-before-ts7.json` a dvě nové permanentní integrační regrese. Celá suite má nyní **101/101 PASS**.

Všechny kontrolované `tsc` vstupy nezávisle hlásí **7.0.2**. Oficiální TS6 API bridge zůstává transparentně oddělený pro nástroje, které ještě compiler API7 nepodporují. Frontend agent prokázal byte-identitu30 runtime PWA souborů TS6→TS7; proto se u compiler-only shody netvrdí neexistující service-worker controller change, ale explicitní načtení nového releasu a znovuověření storage/credential přístupu.


## Fresh OSV offline snapshot

Na výslovný pokyn koordinátora byly obecnými veřejnými GET staženy celé oficiální OSV dumpy, bez názvů nebo verzí projektu v requestu. npm snapshot:228452 records,221789230bytes,last-modified2026-08-31T20:49:52Z,SHA-256 `be383d6bf6d792beb765380c66c03634515c94b01216723ae3f8eba0ffb142aa`; Maven:7058 records,10270749bytes,last-modified2026-08-29T22:19:25Z,SHA-256 `7ba70a0239f8c590ae29d3520859cacff8a0d2cdde7830eb94524eb0742ae6c5`. ZIP CRC i server MD5 metadata prošly. Zdroj a layout: [OSV data dumps](https://google.github.io/osv.dev/data/), [offline scanner dokumentace](https://google.github.io/osv-scanner/usage/offline-mode/).

Oficiální OSV-Scanner2.5.1 binárka byla ověřena proti release SHA-256 `f9f25499a2c8cc367b3af45df2ea7eeca7fbccceab9c35079968f4b3652194be`. Scan používá `--offline --no-resolve`; projektový graph se nikam neposílá a API se nepoužívá. První nesprávný cache layout skončil fail-closed bez API fallbacku. Přesná pinned source ukázala skutečný `osv-scalibr/<ecosystem>/all.zip` layout.

Final pnpm lock obsahoval1227 packages. Lokální match našel2 records,0high/critical: esbuild0.27.7 / GHSA-g7r4-m6w7-qqqr LOW (affected0.27.3–<0.28.1; build tooling/Windows devserver) a uuid7.0.3 / GHSA-w5hq-g745-h8pq MODERATE (affected<11.1.1; transitive xcode z Capacitor CLI). Frontend opravil oba transitive nálezy scoped overrides: esbuild0.28.2 a xcode→uuid11.1.1. Frozen install, Kubb hash, tsup/API/UI/core/PWA/extension build, PBX parse/UUID i cap iOS sync smoke prošly. Postfix lock má1200 packages a nový offline match **0findings**.

Finální Maven runtime/compile/test graph s CryptoJ0.0.5 má226 components a **0findings**. Build-plugin realm měl nejprve284 components/24 raw records (1 critical,10 high,13 moderate); byly opraveny BouncyCastle, Jackson2/3, CommonsIO/Lang, Plexus, Handlebars a další transitivity. Poslední fixed graph má349 components a4 raw records:2 high +2 moderate, všechny Jetty9.4.58 pouze pod Maven Site3.22 previewserverem. `site:site -DgenerateReports=false`, cleanverify/runtime/container Jetty nepoužívají. Maven Central nemá OSV požadované fixed Jetty9.4.60/63; další dostupná oprava je API-breaking Jetty12, zatímco MavenSite4 je jen previewM16. Není proto použit nebezpečný major override. Výsledek je výrazně lepší, ale **není fresh-audit clean**;4build-only inactive findings zůstávají transparentní technický limit.

Tohle není `npm audit` a negarantuje advisories mimo OSV snapshot nebo privátní/nepublikované balíčky. Dataset provenance je v `/tmp/goldenera-wallet-followup/osv/dataset-metadata.json`; lock hash a raw scan result zůstávají v témže izolovaném adresáři.


## CryptoJ0.0.5 nezávislá kontrola

Java JAR0.0.1→0.0.5 je additivní:282→328entries,0removed/46added. U197 původních top-level classes nebyl odstraněn žádný public/protected signature. Nový JAR používá classfilemajor65(Java21). JAR SHA-2560.0.1=`d2b3bc54c6c36196a08614c9767960eb43a848e949468c52f1d8f3f2d8be71f6`;0.0.5=`7d5eadaf13d4451d473e4eaf990dc52bedbde9fac3b13142f8f16e14f68ed30e`. Nový backend prošel28Java tests a povinný PWA→CryptoJ0.0.5 full-stack **13/13 PASS**. Runtime Maven graph nad tímto JARem má0OSVfindings. Žádná existující verze nebyla přepsána pod stejnými souřadnicemi.

## Cross-browser doplnění

Current Firefox153 smoke **2/2 PASS** používá dva skutečné PWA scénáře: create/backup/reload/unlock a import/router/lock/wrong-password/unlock. WebKit26.5 byl stažen do `/tmp`, ale hostu chybí41 runtime libraries(GStreamer/ICU/GTK/media). Podle zadání nebyl použit `apt`, root ani systémová instalace; WebKit se nespustil, což není PWA failure. Konfigurace jej spouští jen s explicitním `WALLET_E2E_WEBKIT=1` na připraveném hostu. Ani current engine není důkaz starého browser floor. Statický Tailwind4 floor zůstává Chrome111, Safari16.4 a Firefox128; fyzicky nejstarší verze zde testovány nejsou.

## Následná hranice práce

Po dosavadním lokálním snapshotu uživatel výslovně ukončil další advisory/OSV/CVE/image-security analýzu. Nebyly proto prováděny žádné další downloady, rematche, per-package dotazy ani bezpečnostní rozšiřování. Výsledky výše jsou historický již dokončený checkpoint, ne tvrzení o pokračujícím nebo úplném auditu. Zbývající práce tohoto follow-upu je pouze funkční kompatibilita TypeScriptu, CryptoJ, vaultů, browserů, full-stack a read-only PWA.

Připravovaná migrace drawer komponent na Base UI/Shadcn není součástí tohoto artefaktu a nezačala, aby se nesmíchaly výsledky. Vyžaduje samostatný funkční QA krok po uzavření současného buildu.

## Finální funkční checkpoint follow-upu

- TypeScript native compiler7.0.2 potvrzen ve všech kontrolovaných workspace cestách; oficiální TS6 API bridge zůstává pouze pro kompatibilitu nástrojů.
- 101/101 Vitest PASS; PWA runtime30/30 byte-identický s předchozím opraveným TS6 buildem.
- CryptoJ JS0.4.1 proti původní0.2:4 adresy,3 přesné wire/signature/hash vektory,2 legacy vaulty plus wrong-password/tamper PASS.
- Java CryptoJ0.0.1→0.0.5:0removed JAR entries,46added,0removed public/protected signatures, Java21 classfiles. Nový13/13 syntetický full-stack a1/1 guarded MAINNET read PWA PASS;0transakcí.
- Forward wallet matrix6/6PASS; genuine Chromium virtual-authenticator PRF/fallback2/2PASS. Nejde o fyzický hardware.
- Current Firefox153 smoke2/2PASS. WebKit26.5 nebyl spuštěn, protože bez systémové instalace chybí41 host libraries; žádnýapt/root zásah neproběhl.
- Nový UI drawer follow-up nebyl zahájen.

Výsledky: `/tmp/goldenera-wallet-followup/final-vitest.txt`, `forward-upgrade-matrix.txt`, `virtual-webauthn-localhost.txt`, `firefox-current.txt`, `cryptoj005-fullstack13.txt`, `cryptoj005-mainnet-readonly.txt`. Produkční nebo uživatelské privátní klíče ani reálné transakce nebyly použity.
