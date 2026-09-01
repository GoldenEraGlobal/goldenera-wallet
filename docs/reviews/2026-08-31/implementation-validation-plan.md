# Implementační a validační plán PWA + backend

Aktivní práce má podle následného zadání uživatele dvě etapy: (1) aktualizovat balíčky a opravit migrační dopady, (2) opravit všech 22 aktivních nálezů. Native/extension F2/F3/F4/F9 nejsou release blokery této práce. Tento plán nahrazuje původně doporučené pořadí review pouze pro provádění změn; žádný bezpečnostní nález tím není považován za opravený.

## Odpovědnost a bezpečné ověřovací prostředí

- Frontend migrační agent vlastní zdroje aplikace, manifesty/lockfile a npm scripts; backend agent vlastní Java/Maven/DB konfiguraci. Testovací agent vlastní `frontend/tests/**`, `frontend/e2e/**`, `frontend/vitest.config.ts` a `frontend/playwright.config.ts`.
- Crypto vektory jsou veřejné BIP39 testovací fráze, nikoli uživatelské účty. Nikdo nesmí poslat prostředky na jejich adresy ani jejich předem podepsané bytes do živé sítě. Browser fixture blokuje všechny jiné originy než localhost/127.0.0.1 a všechny API endpointy musí být explicitně mockované.
- PWA browser test startuje aktuální `frontend/apps/web` přes Vite; produkční režim testuje nový `apps/web/dist` přes Vite preview. Netestuje staré commitované Java static assets. Lokální full-stack kontrola se připojí pouze k testovacímu backendu s mock node/test databází.
- Playwright profily jsou dočasné a oddělené od skutečného uživatelského browseru. Testcontainers musí vlastnit vlastní DB/container; nikdy nepoužít produkční JDBC URL nebo sdílený datový volume.
- Browser screenshoty/traces smějí obsahovat jen veřejná testovací data. Fyzická biometrie a implementace platformního autentikátoru nejsou prokázány mockem nebo virtuálním WebAuthn.

## Etapa 1: průchod migrací

### Zachování klíčů, vaultu a wire kontraktu

Baseline `frontend/tests/fixtures/crypto-v0.2.0.json` vznikla z původní frozen instalace cryptoj 0.2.0. Čtyři mnemonic/passphrase/index→address vektory, tři přesné encoded signed TRANSFER/hash vektory a dva legacy AES-GCM vaulty byly nezávisle porovnány s 0.4.1: **PASS**. Timestamp transakcí je fixní 1700000000000; náhodné salt/IV jsou fixní pouze při generování těchto veřejných fixtures. Běžná aplikace stále používá náhodné salt/IV.

`tests/unit/crypto-compatibility.test.ts` kontroluje derivaci a přesné bytes/hash, dešifrování historického vaultu, odmítnutí špatného hesla a modifikovaného ciphertextu a odlišné salt/IV dvou běžných uložení. Tím se změna dependency nesmí nepozorovaně stát změnou účtu nebo formátu transakce.

`tests/integration/wallet-lifecycle.test.ts` používá skutečný crypto/Zustand/storage adapter a in-memory náhrady platformních pluginů: import, create/backup, lock, načtení nové instance, unlock, chybná hesla a úspěšný reset. Síťová registrace a biometrie jsou izolované náhrady; nejde o fyzický plugin test.

První běh migrační baseline: **15 PASS, 4 explicitně přeskočené pending security regressions**; po přidání Kubb request/error/cancellation a QR kontraktu **26 PASS, stejné4 pending skips**. Jednorázový běh s `WALLET_PENDING_REGRESSIONS=1` nad dosud neopraveným kódem: **4 baseline PASS, 4 očekávané regrese FAIL (S2/S3/S5/S7)**. Log `/tmp/goldenera-wallet-validation/lifecycle-baseline-red.txt`. Regresní assertions vyjadřují správné zamýšlené chování, nikoli očekávání současné chyby. Před dokončením etapy 2 musí být přepínač odstraněn a všechny tyto testy aktivní a zelené.

Nový produkční PWA build přes Vite preview a Chromium151: **4/4 E2E PASS** (create/backup/reload, import/lock/wrongpass/unlock, token/history/browserback, skutečně podepsaný send do izolovaného mock API). Samostatná full-stack kontrola stejného nového production PWA přes lokální Boot4:18084, skutečný jednorázovýPostgres18.6 a syntetickýnode: **4/4 aktivní E2E PASS**; offline test se v tomto režimu záměrně nespouští a má samostatnýběh. Backendová nezávislá kontrola12 integračních testů nenašla migrační problém; Java dekódování všech3 veřejných JSsigned vectors potvrzuje stejné hash/sender/amount/nonce.

### Build, browser a backend gates

- Clean frozen install, root typecheck, aktuální web build a Vitest nesmějí vyžadovat historické node_modules nebo staré generated deklarace.
- Browser E2E: create → password → backup guard → dashboard; import veřejného seedu; lock/wrong password/unlock; reload/persistence; token detail/history/back; review/send přes zachycený mock POST a ověření skutečně podepsaných amount/nonce/sender/recipient.
- Po velké migraci Stackflow ověřit back/forward, remount auth/backup stacku, hash, opakované přechody settings/lock, scan/cancel a původní parametry token/send. Neúspěšný import nebo změna stavu nesmí ponechat nefunkční stack.
- Backend agent zavádí skutečné Spring integrační testy a Postgres Testcontainers s lokálním stub node: JSON kontrakt/Jackson, startup, route mappings, generovaný klient, migrace schématu, repository a signed-tx forwarding. Public signed vectors může sdílet s frontendem bez odvozování tajných produkčních klíčů.
- Produkční PWA smoke se spustí po vytvoření nového `apps/web/dist`; připojení k mockovanému API a testovací backend integrace se vykazují odděleně. Offline/SW smoke vyžaduje samostatný browser context s povoleným service workerem, zatímco běžné E2E používá blokované service workery kvůli deterministickému routingu.

## Etapa 2: konkrétní opravy a regresní akceptace

| ID | Konkrétní implementační cíl | Ověřit správné chování |
|---|---|---|
| S1 | WebAuthn PRF wrap hesla, bezpečný password-only fallback, migrace starých biometrických záznamů. | Kopie credential ID/metadata/ciphertext nestačí k dešifrování; chybějící PRF, cancel, cizí credential, tamper a relock neodemknou. Legacy seed zůstává obnovitelný. |
| S2 | Rozlišit nepřítomný vault od storage error; zablokovat onboarding při chybě; create/import nesmějí přepsat existující wallet. | Jednorázová chyba keys/get, trvalá storage chyba, souběžný create ze dvou tabů: žádný seed overwrite. Po retry je dostupný původní účet. |
| S3 | Propagovat delete chyby a transakčně spravovat wallet data. | Fault injection v každém write/remove/marker kroku; nehlásit úspěšnou deletion při zbytkovém seedu, neztratit existující seed při create/import rollbacku. Po restartu jednoznačný stav/retry. |
| S4 | Identita/revize vaultu a cross-tab invalidace klíčů/session. | Dva taby A, druhý delete/import B → první okamžitě zamčen; show phrase nemůže vrátit B pod identitou A. Souběžná editace nesmí vést k last-write-wins ztrátě wallet. |
| S5 | Synchronous auth guard + generation invalidation na lock/reset. | Dvě auth operace s řízeným pořadím; lock/reset mezi await a dokončením → žádná pozdní reinjekce key/mnemonic. |
| S6 | Absolutní deadline session; ověření při visibility/resume před obnovením UI. | Uplynulé 2 minuty při suspendu, visible event před timer callbackem, aktivita na hraně deadline → stále zamčeno. Nezáviset pouze na běhu JS timeoutu. |
| S7 | Oddělit nepovinnou registraci zařízení od lokálního auth/backup flow. | Nikdy nedokončený register promise nezablokuje create/import/unlock; odmítnutí se bezpečně zaznamená bez secretů. |
| F1 | Jediná synchronně střežená confirm operace přes preflight i submit, invalidace cancel/lock. | Skutečný TanStack QueryObserver + dvě potvrzení během nonce/balances → nejvýše jeden signed POST. Kliknutí po prvním úspěchu také neopakuje review. Odeslaný POST není prezentován jako odvolatelný. |
| F5 | Validace QR před navigačním flagem, chybu zobrazit a scanner zachovat ovladatelný. | URL/poškozený QR → viditelná chyba, validní další scan funguje, cancel vždy uklidí kameru/listenery; žádný permanentní hasNavigated. |
| F6 | Nullish fallback decimals a přesný formátovač bez Number exponentu. | Balance/history/detail/receive: decimals 0/8/18 a velké celé číslo odpovídají nejmenším jednotkám; 0 nepřejde na8. |
| F7 | Validace amount podle skutečných metadata decimals, přesnost bez zaokrouhlení. | Token18 přijme0.000000001, token0 odmítne1.1; 0/negativní/NaN/exponent/nadbytečná přesnost se bezpečně odmítnou, validní velké hodnoty se signují beze změny. |
| F8 | Reset/clamp page při změně filtru/adresy/tokenu a zmenšení historie. | Z page2 zvolit filtr s1stránkou → request page0 a existující záznam; po pollingu zmenšené totalPages dostupná navigace. |
| F10 | Funkční task graph typecheck, aplikační scripts a CI před release. | Jediný root příkaz kontroluje autorský shared core/UI/API+web a končí nonzero při vložené dočasné TS chybě; žádná reliance na stale .d.ts. |
| F11 | Správný PG18 persistent mount a bezpečný návod pro existující data. | Nový testovací container uloží marker, recreate se stejným dedikovaným volume marker zachová. Není proveden major upgrade nebo přesun produkčních dat. |
| B1 | Node V2 kontrakt a oddělení total/locked/spendable/pending. | Mocknode V1 iV2 JSON; total100,locked60,spendable40 mapuje disponibilní40 před pending; neznámý enum bezpečně selže bez nesprávného spendable. |
| B2 | Validovat neprázdné adresy a pevné hranice hromadných dotazů/práce. | Missing/empty/whitespace/oversized addresses →4xx a nula nodecalls; validní maximum projde; rozbitá paginace node má bounded deadline/call budget. |
| B3 | Přesný combined pending+confirmed offset. | Pending0,1,size−1,size,size+1; sebrat všechny stránky → žádné duplicity/chybějící confirmed, správné total/last. |
| B4 | Native fee rezervace všech outgoing pending bez ohledu na token filtr. | Native100 + custom pendingfee7 → native93 pro native-only i all-token dotaz; incoming/custom unrelated address fee se neodečte. |
| B5 | Důvěra pouze explicitním proxy a bezpečný přímý port default. | Nevěrohodný peer srotujícím XFF má stále jeden bucket; trusted proxy přepisuje původní headers; config/startup vysvětluje ingress hranici. |
| B6 | Konečný read/request deadline, bounded retry budget a neblokující subscription. | Lokální node přijme request bez odpovědi → timeout v rozpočtu; startup/readiness i servlet threads se nezablokují neomezeně. |
| B7 | Nová dopředná FK migration nebo explicitní delete children. | Skutečný Postgres ze staré migrace + device/user_account; upgrade a cleanup smaže požadovaný parent/child a zachová nesouvisející data. |
| B8 | NODE_WEBHOOK_UID v quickstartu a skutečná UUID validace. | Validní lokální UUID subscription projde; absent/placeholder/neplatná UUID vyvolá jasnou lokální konfigurační chybu. |

## Návrh bezpečné PWA biometrie pro etapu 2

Následující struktura je doporučený návrh implementace, nikoli již nasazené chování. Heslem chráněný mnemonic zůstane autoritativní záloha; PRF je druhý způsob zpřístupnění hesla pouze po uživatelském ověření. Biometrie nesmí být podmínkou vytvoření nebo obnovy wallet.

WebAuthn PRF poskytuje výstup svázaný s autentikátorem; `credential.rawId` je identifikátor, nikoli toto tajemství. Pro novou registraci použít `userVerification: 'required'` a `extensions.prf.eval.first`. `prf.enabled` se očekává pouze u registrace; výstup `results.first` nemusí být při create dostupný a pak je nutná následná assertion se stejným credential a PRF vstupem. U authenticate validovat skutečný `results.first`, nikoli hledat `enabled`. Tyto protokolové body vycházejí z [W3C WebAuthn Level 3 PRF](https://www.w3.org/TR/webauthn-3/#prf-extension).

Navrhovaný versioned biometrický envelope:

```text
version: 2
scheme: webauthn-prf-hkdf-sha256-aes256gcm
credentialId: base64url veřejného ID
rpId: current hostname
walletId / vaultRevision: veřejná identita aktuálního vaultu
prfInput: náhodných32B, veřejné
hkdfSalt: náhodných32B, veřejné
iv: náhodných12B
ciphertext: AES-GCM(password, AAD(version,scheme,rpId,walletId,credentialId))
```

Klíč odvodit HKDF-SHA256 z PRF32B výstupu s pevným aplikačním info a uvedenou solí. PRF výstup, odvozený CryptoKey ani plaintext heslo nikdy nepersistovat a neposílat do API, analytics či logů. Ve storage smí být pouze metadata a ciphertext. Storage-only útočník tak nemá vstup HKDF. Po locku zneplatnit právě rozpracované autentizace; lokální buffer s PRF výstupem nulovat po použití, ale netvrdit zaručené vymazání JS stringů z paměti.

Aktivaci označit za dokončenou až po úspěšném vytvoření/assertion, získání PRF, encrypt/decrypt roundtripu, ověření vault identity a atomickém uložení úplného envelope. Chybějící API/PRF output, odmítnutí credential, timeout či storageselhání ponechá funkční password-only režim. Nikdy nezavádět fallback derivaci z credentialID nebo náhodný klíč uložený vedle ciphertextu. `isUserVerifyingPlatformAuthenticatorAvailable()` samotné nedokazuje podporu PRF.

### Migrace stávajících nebezpečných záznamů

1. Existující `ge_secure:mnemonic` zachovat byte-for-byte, dokud není prokázána úspěšná dešifrovatelnost nové podoby. Neprovádět plošné `clear()` ani mazání seedu při detekci legacy biometrie.
2. Nový kód nesmí legacy biometrický payload nadále přijímat jako běžný bezpečný unlock. Uživatel dostane informaci, že musí heslo potvrdit pro obnovu bezpečné biometrie; standardní password unlock zůstane dostupný.
3. Nemařit přístup uživatele, který si heslo nepamatuje a dříve používal jen biometrii: legacy metadata neodstranit nevratně bez potvrzené alternativy. Bezpečná explicitní migrační cesta může po skutečné WebAuthn user verification starého credential jednorázově otevřít starý wrapper pouze v paměti, ověřit jím původní seed, zobrazit/ověřit backup a vyžádat nové heslo. Tento jednorázový bridge pouze zachraňuje existující přístup; neodstraňuje historickou slabinu kopie legacy storage. Pokud takovou recovery cestu nechceme implementovat, před smazáním legacy blobu musí být potvrzené aktuální heslo nebo zkontrolovaný mnemonic backup.
4. Nový PRF envelope uložit jako celý verzovaný záznam; až po ověření persistovaného roundtripu odstranit legacy ID/password/flag. Nedokončený enrollment ponechá původní password-vault a jasný retry stav. Přepnutí musí být střežené i proti dalšímu tabu a souběžnému reset/importu.
5. Vymazání současných legacy dat nemůže zneplatnit dříve odcizenou kopii. Upozornění proto nesmí tvrdit retroaktivní zabezpečení dříve kompromitovaného seedu; při podezření na krádež je potřeba nová wallet a uživatelem řízený přesun prostředků, nikdy automatický transfer v migraci.

Pro PWA lokální službu není potřeba serverově synchronizovat PRF tajemství. Potenciální sync passkey je vlastnost zvoleného autentikátoru a neznamená automaticky obnovu místního encrypted vaultu na jiném zařízení. RP origin musí zůstat stabilní; změna domény je zvláštní migrační projekt.

### Testovací matice PRF

- Capability none / `enabled:false` / create returns enabled true without outputs / assertion missing output / cancelled user verification.
- Happy path create+assertion s32B výstupem, stejné credential+input→stejné unwrap; jiný credential, jiný PRF input, jiný walletId či modifikovaná AAD/ciphertext→odmítnutí.
- Neplatná délka/typ výstupu; `credentials.get()` vrací null; timeout; vault změní druhýtab; lock/reset během WebAuthn.
- Legacy metadata + správné/chybné heslo; přerušení při každém persist kroku; explicitní legacy recovery při zapomenutém hesle; odmítnutý enrollment nikdy nesmaže mnemonic.
- Storage-only pokus z credential ID a všech uložených metadat musí selhat; test nesmí mít PRF tajemství schované v jiném persistovaném klíči.
- Playwright virtuální authenticator/CDP může ověřit browser API integraci; pokud použitá verze neumí PRF, explicitně injektovat mock `navigator.credentials` pouze v testu a označit výsledek jako mock extension semantics. Skutečný fingerprint/FaceID ani bezpečnost hardware tento test neprokazuje.

## Příkazy a aktuální omezení prostředí

```sh
pnpm test
WALLET_PENDING_REGRESSIONS=1 pnpm test
pnpm test:e2e
# Po novém pnpm --filter web build:
WALLET_E2E_PRODUCTION=1 pnpm test:e2e
```

V aktuálním WSL prostředí je nutné `TMPDIR=/tmp`, protože zděděná Windows temp cesta není zapisovatelná. Browser runtime byl izolovaně stažen do `/tmp/goldenera-wallet-playwright-browsers`; tři chybějící host libraries jsou pouze rozbalené pod `/tmp/goldenera-wallet-browser-libs/root` a pro spuštění se používá `LD_LIBRARY_PATH`, systémové balíčky se neměnily. Sandbox blokuje Chromium IPC, takže pro lokální E2E je potřeba autorizovaný nástrojový běh mimo sandbox. Tyto okolnosti nejsou chyby wallet.

Samostatná produkční service-worker kontrola: **1/1 PASS** — skutečný aktivní SW, síťoffline/abortAPI, reload cached PWA a lokální passwordunlock veřejného testovacího vaultu. Aktualizace SW mezi dvěma release buildy ani fyzický authenticator nebyly v etapě1 testovány. Playwright po bězích uklidil vlastní Vite/Chromium procesy; backendovýtestlauncher/container uklízí jejich vlastník.

Výsledky v tomto dokumentu jsou průběžné. Etapa2 se nepovažuje za hotovou, dokud se nespustí všechny aktivní regrese, nový produkční PWA build a backend integration gates; skipped/fyzicky neověřené položky musí být uvedeny ve finálním reportu.
