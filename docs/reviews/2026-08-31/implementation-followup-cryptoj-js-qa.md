# CryptoJ JS update – nezávislá funkční kompatibilita

Datum: 2026-09-01

Rozsah je omezený na funkční/API/protokolovou kompatibilitu nové stabilní verze `@goldenera/cryptoj` v aktivní PWA. Nejde o bezpečnostní audit. Používají se pouze veřejné deterministické fixtures; žádná data z `.env`, mainnet zápisy ani odeslání transakce.

## Neměnná referenční sada

Původní `frontend/tests/fixtures/crypto-v0.2.0.json` zůstává autoritativní historická reference a nebude přegenerována podle nové knihovny:

- 4 kombinace mnemonic/passphrase/index → přesná adresa,
- 3 transakce → přesné signed bytes a hash, včetně zero-decimal a velkého integeru,
- 2 historické v1 encrypted vaulty, včetně Unicode hesla,
- wrong-password a tamper odmítnutí.

Nová synchronizační regrese porovnává stejné 4 adresy a 3 transakční kontrakty s Java 0.0.5 fixture `src/test/resources/contracts/signed-transfers.json`. Java `BackendCompatibilityTest.publicJavascriptVectorsDecodeWithUpdatedJavaCryptoLibraries` je následně dekóduje a kontroluje hash, sender, amount a nonce.

Baseline před změnou nové JS verze: `tests/unit/crypto-compatibility.test.ts` **12/12 PASS**.

## Akceptační matice po `CRYPTO_JS_READY`

| Oblast | Podmínka | Stav |
| --- | --- | --- |
| Release/API | Finální manifest/lock ukazuje novou stabilní verzi; použité importy a signatury walletu mají stejné zdokumentované chování nebo řízenou migraci | PASS |
| Derivace | Všechny 4 původní adresy zůstávají přesně stejné | PASS |
| Wire | Všechny 3 původní signed bytes a hash zůstávají přesně stejné; decoder vrací stejné amount/nonce/hash | PASS |
| Java 0.0.5 | Java fixture je byte/hash/address shodná a Java decoder přijme bytes nové JS knihovny | PASS |
| Vault | Oba historické ciphertexty i opravený v2 vault se odemknou se stejným seedem/adresou; chybné heslo/tamper jsou odmítnuty | PASS |
| Forward upgrade | 6 stávajících password/legacy/PRF scénářů zachová seed/address a přístup po reloadu | PASS |
| PRF | 2 skutečné Chromium CDP virtual-authenticator scénáře projdou; nejde o fyzický hardware | PASS |
| Frontend regressions | Celá Vitest sada včetně 9 Drawer regresí projde | PASS 114/114 |
| PWA browser | Produkční Drawer flows 6/6 se opakují, pokud nová knihovna mění bundle | PASS 6/6 |
| SW update | Stejný origin načte starý 0.4.1 artifact, aktualizuje na nový artifact a zachová vault/adresu/reload | PASS 1/1 |
| Full stack | 13 syntetických PWA → Java CryptoJ 0.0.5 scénářů projde; submit pouze do lokálního stubu | PASS 13/13 |

Nové očekávané wire konstanty se smějí přidat pouze vedle historických hodnot a s explicitním protokolovým release note. Změna historických expected hodnot sama o sobě není přijatelná oprava testu.

## Release a API review

Finální přímá závislost je `@goldenera/cryptoj` 0.5.0. Nainstalované `index.js`, `index.mjs` a `index.d.ts` jsou byte-identické s buildem lokálního oficiálního checkoutu na commitu `06298b504e53b5ae7fa4342d680bc3feef3ed667`; jejich SHA-256 jsou `1c102848…1f377`, `48090518…101e0` a `873bc118…cf5`. Lockfile i core manifest odkazují na 0.5.0.

Funkční změny relevantní pro wallet jsou:

- `Tx.timestamp` je `bigint`, nonce/signature/sender mohou být při dekódování unsigned wire `null`; podpis přes `TxBuilder.sign` vrací signed tvar. Wallet vytváří pouze signed transfer a jeho call sites tím nejsou rozbité.
- Decoder zachovává Java `long`, unsigned/null wire a kontroluje Java-compatible rozsah částek. Přidaná regrese podepsala, dekódovala a znovu enkódovala timestamp `9007199254740993n` bez ztráty.
- `PrivateKey.fromMnemonic` používá raw UTF-8 seed kompatibilní s Java 0.0.5. Samotná metoda proto není validační API. `WalletUtil` nyní nejdřív volá `PrivateKey.isValidMnemonic` a až potom novou Java derivaci. Validních 12/24 slov prošlo; valid-word chybný checksum, neznámé slovo a 11 slov byly odmítnuty i přímým restore.
- Pro historické JS klíče s Unicode BIP-39 passphrase existuje explicitní `fromMnemonicLegacyJs`. Veřejná regrese odlišuje přesný Java raw-UTF8 výsledek od přesného legacy JS výsledku. Wallet UI passphrase nepoužívá, takže běžné existující anglické seedy zůstaly na nové Java cestě se stejnou adresou.

Nezávisle spuštěná upstream sada CryptoJ 0.5.0 prošla **52/52** a walletová Vitest sada **114/114**. Scoped kompatibilita má **15/15**: 4 adresy, 3 přesné signed wire/hash vektory, Java fixture sync, 2 legacy vaulty, randomizaci nového vault ciphertextu, wrong-password/tamper, validační matici, Unicode Java/legacy rozlišení a bigint timestamp.

## Browser, update a full stack

- Forward/PRF matice: **6/6 PASS** — původní password vault, řízená legacy biometrická migrace, předchozí v2 password, předchozí v2 s reálným PRF credential, skutečný Chromium CDP virtual-authenticator PRF a password fallback bez PRF.
- Explicitní PWA service-worker update z uloženého produkčního buildu s CryptoJ 0.4.1 na 0.5.0: **1/1 PASS**. Stejný origin po změně controller/assets zachoval vault, adresu a další reload/unlock.
- Standardní produkční browser regrese mimo Drawer: **25/25 PASS**; produkční Drawer flows byly znovu spuštěny nad stejným 0.5 bundlem: **6/6 PASS**.
- Čerstvý syntetický backend Java CryptoJ 0.0.5 + PostgreSQL 18.6 + lokální node stub: **13/13 PASS**. Jediný podpis/submit scénář šel výhradně do lokálního stubu; žádná mainnet transakce ani mainnet read smoke se v této etapě nespouštěly.

Finální `frontend/apps/web/dist` má 30 souborů a tree hash `10e6a1eef5492288fc42045baa7c3f04f63eb47e1a4d6cbbf45296794c4d9a91`. Hash byl stejný před i po všech testech. Manifest je `/tmp/goldenera-wallet-cryptoj050-final-dist-manifest.json`; Playwright JSON pro standardních 25 a full-stack 13 je `/tmp/goldenera-wallet-cryptoj050-standard25.json` a `/tmp/goldenera-wallet-cryptoj050-fullstack13.json`.

Nebyl potvrzen žádný nový produkční bug v kandidátu 0.5.0. Historické expected hodnoty nebyly změněny. V souladu s uživatelským omezením nebyl proveden žádný advisory, CVE ani jiný bezpečnostní scan; tato etapa je čistě funkční a datově kompatibilní.
