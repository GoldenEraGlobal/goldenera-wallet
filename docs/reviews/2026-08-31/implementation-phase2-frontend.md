# Etapa 2 — opravy aktivního PWA frontendu

**Vlastní frontendový rozsah je dokončen.** Globální závěrečný S4 security QA/checkpoint a final static/JAR ověření ještě řídí root, security a backend agent; tento report je nesmí vydávat za hotové.

Rozsah: F1, F5, F6, F7, F8 a doložení F10. Nativní/extension F2/F3/F4/F9 zůstávají výslovně mimo aktivní vývoj. S1–S7 spravoval security agent; B1–B8/F11 backend agent a final QA. Žádný deploy ani commit.

## Implementované chování

| Nález | Oprava | Regresní pokrytí |
|---|---|---|
| F1 | Každé review má vlastní `TransferSubmission`; synchronní pending guard platí před prvním await. Session snapshot se kontroluje po preflightu, před získáním klíče/podpisem a před POST. Cancel/unmount/změna relace abortuje čekající requesty. Již odeslané review nelze znovu použít, ani když se ztratí odpověď. | `frontend-submission.test.ts`; browser double-confirm, cancel a auto-lock během odložené nonce odpovědi |
| F5 | QR je validováno před navigačním flagem. Neplatný QR ukáže chybu, další sken i Cancel fungují. Scanner drží vlastní listener a serializuje SDK start/teardown, aby pozdní permission/start odpověď neoživila opuštěnou stránku. Stream tracks a průhledné body classes se uklízejí. | `frontend-scanner.test.tsx` (invalid→valid, cancel, late permission); skutečný Chromium fake-camera stream se syntetickými decoded QR payloady |
| F6 | Nullish fallback zachovává decimals=0 v token listu/detailu i transfer detailu. `formatWei` používá přesné `10n ** BigInt(decimals)`, správně zobrazuje nulu decimals bez `.0` a znaménko. | `frontend-amounts.test.ts`; browser zůstatek100 celých jednotek v seznamu i detailu |
| F7 | Jediný strict BigInt parser škáluje podle načtených token metadata; chybějící metadata, chybný formát, nekladná částka a přebytečná přesnost jsou validační chyby. Podepisuje se přesně zkontrolovaná raw částka uložená v review. Send/Receive NumericFormat už nepoužívají decimalScale, které by mohlo vstup potichu zaokrouhlit před validátorem. | unit decimals0/8/18/28; browser18-decimal `0.000000001` → raw1000000000; poslední cílený browser whole-token1.1 musí odmítnout bez review1 |
| F8 | History component se stavem stránky je keyed podle wallet adresy/tokenu/filtru/pageSize, takže nový filtr nikdy nezačne requestem staré stránky. Polling při zmenšení počtu stránek srovná index na poslední platnou stránku. Pagination není uvězněná jen v neprázdné větvi. | `frontend-history.test.tsx` pro filtr/wallet/token/poll shrink; browser page3→Burn musí požádat page1 |
| F10 | Aktivní workspace typecheck a PWA build task fungují; CI spouští typecheck, lint, unit/integration, reálné Chromium E2E a asset generátor. | Etapa1 plus závěrečné příkazy této etapy |

F1 neznamená, že lze odvolat již přijatý blockchain POST. Po zahájení POST se review spotřebuje; při chybě UI upozorňuje na odeslaný požadavek a žádá kontrolu historie před novou platbou. Cancel v preflightu nevyvolá podpis/POST. Klíč se neuchovává v async closure před nonce/balance čekáním; bere se aktuálně přes security store teprve po ověření session.

Review kopíruje potvrzované token metadata, množství a poplatek. Přepočet během čekání tak nezmění uživatelem odsouhlasené jednotky/poplatek. `balance` nadále znamená disponibilní částku po pending rezervacích; nové B1 total/locked/spendable fields se nesmějí zaměnit za použitelný limit. Wallet OpenAPI snapshot byl obnoven ze skutečné phase2 aplikace a Kubb klient znovu generován.

## Souborová mapa

- `packages/core/src/components/TxSubmitCard.tsx` a `utils/TransferSubmission.ts`: příprava review, jednorázové potvrzení, cancel/session gate a čtení klíče až před podpisem.
- `utils/TokenAmount.ts`, `utils/WalletUtil.ts`, TokenList/TokenDetail/TransferDetail/ReceiveTransfer: přesná validace a formátování tokenových jednotek.
- `pages/ScanQrCodePage.tsx`, `utils/QrUtil.ts`: validace, recovery a ukončení kamery/listeneru.
- `components/TransferList.tsx`: identita historie a korekce indexu po pollingu.
- `tests/regressions/frontend-*.test.ts(x)` a `e2e/frontend-regressions.spec.ts`, `e2e/frontend-scanner.spec.ts`: reprodukce původních chyb a ochrany proti opakování.

Cesty v této sekci jsou relativní k `frontend/`. Jde o skutečné změny chování, nikoli potlačení lint pravidel.

## Dosavadní a závěrečná validace

- Vlastní nové unit/RTL regresní testy: **34 PASS**; scanner/history testy zpočátku odhalily chybějící aliasy mockovaných workspace modulů. Po opravě resolution v test configu jsou green; produkční implementace se kvůli testům neobcházela.
- Prvních6 skutečných Chromium frontend regresí: **6/6 PASS** (double-confirm, cancel, auto-lock během nonce, decimals0, malá18-decimal částka, filtr historie). První pokus neotevřel browser kvůli chybějícím host libraries; úspěšný běh používá stejné izolované `/tmp` knihovny jako test lead.
- Následný společný produkční běh: **23/23 PASS**, včetně obou skutečných fake-camera QR scénářů, základních wallet flow,9security scénářů a SW offline/update. Potom byl uzavřen poslední F7 detail potichého NumericFormat zaokrouhlení dvěma řádky a přidán24. browser case. **Po posledním F7 fixu byl test leadem potvrzen produkční24/24 browser PASS.** Následný pozdní S4 security race fix má samostatný otevřený nezávislý QA checkpoint; poté je požadován definitivní společný rebuild/run a13-case real-backend kontrola. Tento frontend agent už source nemění.
- Produkční Vite build i aplikační tsc byly green. Finální root `pnpm typecheck`: **4/4 PASS**; `pnpm lint`: **0 errors/9 warnings** (zbylé any a useCopy exhaustive-deps). Logy jsou v `evidence/phase2-frontend/final-typecheck.txt` a `final-lint.txt`.
- Crypto golden vectors z etapy1 jsou zachované; testy podepisují pouze syntetické veřejné peněženky. Žádná platba nešla na živou síť.

## Nezávislé backend review

Při readonly kontrole B1–B8/F11 byly navíc nalezeny a QA reprodukovány dvě mezery B2:

1. Neprázdná zkrácená upstream stránka (`total=100`, `list=50`) mohla vrátit partial balance/pending rezervaci. QA přidalo `checkPageCompleteness` před obě agregace, ověřilo RED→GREEN i legitimní poslední50-row stránku. Offset je long a správně zohledňuje postincrement pageNumber.
2. Encoded aliasy `/%61pi/.../balances` a `/api/.../%62alances` obešly API bucket nebo10-token cost, přesto je Tomcat obsloužil. QA používá Spring RequestPath/pathWithinApplication/decoded PathSegment na obou rozhodovacích místech. Context path a doslovné plus jsou otestovány, malformed path vrací400.

Oba bounded patche byly tímto frontend agentem nezávisle znovu přečteny a schváleny; QA celé **26 Java21/PostgreSQL/Tomcat testů PASS,0skipped**. Produkční Java soubory tento agent nepřepisoval. Backend finalpackage/JAR ověří backend lead až po PWA staticsync.

## Assets, závislosti a hranice tvrzení

- Scoped Sharp0.35.4 override byl final QA ověřen posouzením používaného API a skutečným generováním/dekódováním6PNG/ICO assetů. `pnpm test:assets` je v CI. Původní Sharp checkpoint etapy1 je tím uzavřen, bez širokého peer/force override.
- Online npm audit byl po aktualizaci odmítnut auto-review i přes existující uživatelský souhlas; nebyl obcházen. Poslední QA offline porovnání starého autorizovaného snapshotu zanechává jediný známý GHSA v odložené extension Rollup větvi. To není nový online audit ani tvrzení, že neexistují nová advisories.
- Připraven `scripts/sync-static.mjs`: vyžaduje produkční index/manifest/SW, odmítá symlinky a neznámé hand-written static resources, zálohuje starý generated output do `/tmp`, odstraňuje staré hashed chunks a kontroluje přesnou file-set/SHA256 shodu. CI používá sync+check; Docker rovněž neoverlayuje staré chunks.
- **Finální staticsync a JAR/HTTP hash signoff ještě čekají na definitivní browser GREEN; zatím není tvrzeno vydání finálního balíčku.** Následné ověření bude doplněno.

## Závěrečný handoff vlastnictví

Na výslovný pokyn root koordinátora bylo konečné generování a synchronizace `src/main/resources/static` předáno **backend_review**. Tento agent sync ještě nespustil, nezabalil finální JAR ani neprovedl deploy. Backend začne až po definitivním společném security/PWA buildu a QA, takže starší dist nelze omylem vydávat za finální.

Předané přesné příkazy z adresáře `frontend/`:

```bash
TMPDIR=/tmp mise exec -- node scripts/sync-static.mjs --report ../docs/reviews/2026-08-31/implementation-final-static-manifest.json
TMPDIR=/tmp mise exec -- node scripts/sync-static.mjs --check
```

Potom backend lead provede `package` a svůj `src/test/verify_packaged_pwa.py` pro přesnou shodu dist/static/JAR a HTTP servírovaných souborů. Konečný společný artifact výsledek bude v hlavním review indexu/backend reportu.

Vlastní finální frontend checkpointy:34 nových unit/RTL regresí PASS, PWA workspace typecheck4/4PASS, lint0errors/9warnings, po posledním F7fixu společný produkčníbrowser24/24PASS podle testleada. Původní F1/F5/F6/F7/F8/F10 frontend scope je splněn; odložené native/extension položky, nový online npm audit blokovaný reviewerem a zmíněný pozdní globální S4/artifact checkpoint zůstávají transparentně oddělené.
