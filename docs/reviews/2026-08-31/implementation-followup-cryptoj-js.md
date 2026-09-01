# Follow-up: JS CryptoJ 0.5.0

Datum implementace: 2026-09-01. Bez commitu, deploye, publish kroku, čtení `.env`, MAINNET operace nebo skutečné transakce. Tato etapa neprováděla bezpečnostní audit, OSV ani CVE analýzu.

## Ověřený release

Oficiální npm registry `dist-tags.latest` ukázal **`@goldenera/cryptoj@0.5.0`**. Oficiální GitHub release/tag je [`v0.5.0`](https://github.com/GoldenEraGlobal/goldenera-cryptoj-js/releases/tag/v0.5.0), commit `06298b504e53b5ae7fa4342d680bc3feef3ed667`, publikovaný2026-08-31T21:55:17Z. Npm tarball má registry integrity `sha512-is1niyCf702mOskCh3mOFp7b1JomHG8BJgpU0K5wv3PKxmk7W2NFadDF+9q9lAehI66nxZFh+F/5Vk1rxhqVdg==`.

Release je jedencommit nad0.4.1,13změněných souborů,220additions/56deletions. Release notes deklarují Java-compatible RLP; konkrétní source diff byl proto zkontrolován proti [`v0.4.1…v0.5.0`](https://github.com/GoldenEraGlobal/goldenera-cryptoj-js/compare/v0.4.1...v0.5.0), neodvozen jen zkrátkého release textu.

## Funkční/API dopad

- `Tx.timestamp` je nyní `bigint`; builder přijímá bezpečný`number`, `bigint` nebo`Date`. Decoder tak neztrácí Java signed-long hodnoty nadJS safe integer.
- `Tx.nonce`, `signature` a `sender` mohou být při dekódování unsigned/null transakce `null`; `TxBuilder.sign()` vrací explicitní `SignedTx` snenulovým podpisem/senderem. Wallet podpisová cesta tedy zůstává typově silná.
- Decoder kontroluje přesný field count, Java int/long, nulový/strukturálně platný podpis a Java UInt256 rozsah Wei. Encoder zachovává unsigned/null a signed scalar wire tvar.
- Mint/burn payload amount používá Wei writer sJava UInt256 limitem.
- `Amounts.parseTokens` se srovnalo sJava chováním. Wallet submission tuto metodu nepoužívá; používá již škálovaný`bigint` a `Amounts.wei`.
- `PrivateKey.fromMnemonic` používá rawUTF-8 PBKDF2 pro shodu sJava0.0.5 a užsám neprovádí BIP-39 wordlist/checksum validaci. `PrivateKey.fromMnemonicLegacyJs` zůstává pro obnovu historických JS klíčů sUnicode passphrase.

## Wallet adaptační rozhodnutí

GoldenEra Wallet nikdy nepředává přihlašovací heslo trezoru jako BIP-39 passphrase. Uložený mnemonic je anglický BIP-39 text a derivace vždy používá prázdnou passphrase/index0. Pro existující12/24-word wallet je tedy0.5 raw-UTF8 derivace byte-stejná; vaultpassword/PRF/legacybiometric obal se CryptoJ derivace netýká.

Protože0.5 `fromMnemonic` přijme libovolný neprázdný text, `WalletUtil` nyní odděluje validaci od derivace:

1. `assertValidMnemonic` volá oficiální `PrivateKey.isValidMnemonic`, který kontroluje anglický wordlist, délku a checksum.
2. `restoreFromMnemonic` tuto kontrolu provede vždy, i když je voláno přímo mimoImportPage.
3. Teprve potom volá Java-compatible `PrivateKey.fromMnemonic`.
4. `isValidMnemonic` používá stejný explicitní validator.

Regrese pokrývá validní12/24slov, invalidníchecksum složený pouze zplatných slov, neznámé slovo,11slov a přímé`restoreFromMnemonic` throw. Unicode fixture navíc dokládá rozdíl mezi novýmJava raw-UTF8 klíčem a historickýmJS recovery klíčem; wallet je omylem nezaměňuje.

Transakční cesta nadále explicitně volí `Network.MAINNET`, `TxType.TRANSFER`, stejnérecipient/token/amount/fee/nonce a `encodeTx(tx,true)`. Release nezavádí novýwallet wire version; platnéV1 podpisy zůstaly přesně stejné a odpovídajíJavaCryptoJ0.0.5 fixture.

## Manifest, lock a artifact

- `packages/core/package.json`: `@goldenera/cryptoj` `^0.4.1` → `^0.5.0`.
- `pnpm-workspace.yaml`: přesně zkontrolovaný čerstvýrelease přidán do existující minimum-release-age výjimky jako`@goldenera/cryptoj@0.5.0`.
- `pnpm-lock.yaml`: jediný CryptoJ package snapshot je0.5.0; peergraph je čistý.
- Drawer/BaseUI produkční zdroj se vtéto etapě neměnil.

Předchozí0.4.1+finálníDrawer dist je `/tmp/goldenera-wallet-cryptoj050-baseline-dist`. Finální0.5 candidate má stále30souborů:25jmen ibytes zůstalo stejných; `index.html` a`sw.js` změnily reference/precache; tři hashed chunks byly nahrazeny třemi novými (`vendor-crypto`, aplikační`index`, malý`web`). To odpovídá nové knihovně a WalletUtil validačnímu guardu. Přesný names/hash diff je `/tmp/wallet-cryptoj050-dist-diff.json`; byte-identita s0.4.1 se správně netvrdí.

## Vlastní validace

- lockfile update + `pnpm install --frozen-lockfile`:PASS.
- `pnpm peers check`:0issues.
- NativeTypeScript7.0.2: API/UI/core/web app+config/extension app+config,7/7PASS.
- Full frontend lint:0errors/9jižznámých warnings mimo změnu.
- Upstream CryptoJ0.5 source suite:4files,52/52PASS včetně6Java-conformance testů; upstream typecheckPASS.
- Wallet scoped Crypto compatibility:15/15PASS.
- Immutable fixtures:4mnemonic→address,3přesné signedV1 wirebytes/hash,2historické encrypted vaulty včetněwrong-password/tamper; Java0.0.5 fixture syncPASS.
- Bigint timestamp signed encode/decode/re-encode/hashPASS.
- Celý wallet Vitest:10files,114/114PASS, včetněDrawer9.
- PWA Vite8 production build:3802modules,33precache entries,PASS.
- Extension shared graph/typecheck aVite8ZIP build:3806modules,PASS; pouze dříve evidované config-loader/chunk-size warnings.

## Nezávislá acceptance

Nezávislý testlead dokončil celý zmrazenýcandidate bez potvrzeného produkčního bugu:

-Crypto4address/3wire/2vault aJava0.0.5 contract:PASS;
-forwardupgrade/password/legacybio/PRF6/6 včetněrealCDP PRF2/2:PASS;
-Drawerproduction6/6 nad0.5bundlem:PASS;
-old0.4.1→new0.5service-worker update sestálouadresou, vaultem a reload/unlock:1/1PASS;
-standardproduction25/25 aPWA→Java0.0.5fullstack13/13PASS;
-externí/Mainnet transaction submit:0.

Detailníprovenance je v [nezávislémCryptoJ QA](implementation-followup-cryptoj-js-qa.md). Fyzickýautentikátor aniSafari/Firefox device pokrytí zChromium výsledku není tvrzeno. PoGREEN byl canonicaldist bezpečně synchronizován,Java21/25 oba28/28 aaktuálníJAR/Docker artifacts dokončeny v [finálnímartifact reportu](implementation-followup-final-artifact.md).
