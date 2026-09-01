# Nezávislé závěrečné QA — PWA a Java backend

Stav k 31. 8. 2026. Reviewer `final_qa` neměnil souběžně vlastněné bezpečnostní ani
frontendové zdroje. Vedle nezávislého review převzal po dohodě pouze Sharp dependency
checkpoint, jeho test a reporty. Žádný deploy, commit, produkční API ani skutečná
peněženka. Native/extension zůstávají mimo aktivní rozsah.

## Závislosti a asset generator — dokončeno

`@vite-pwa/assets-generator@1.0.2` má přímý `sharp:^0.33.5`. Byly přečteny skutečné
distribuované zdroje, nikoliv pouze manifest: `createSharp` používá konstruktor
`create`, `resize(width,height,options)`, `composite`, `png`/`webp` a `toBuffer`;
favicon používá `toFormat` a `sharp-ico.encode`. Pomocný `sharp-ico@0.1.5` používá
také `metadata`, `clone`, resize a běžný raw input. Žádný z těchto použitých API
nebyl v migraci odstraněn. Posouzeny byly oficiální
[Sharp 0.34 změny](https://sharp.pixelplumbing.com/changelog/v0.34.0/),
[Sharp 0.35 změny](https://sharp.pixelplumbing.com/changelog/v0.35.0/) a
[0.35.4 release](https://sharp.pixelplumbing.com/changelog/v0.35.4/).
Node 24 splňuje nové minimum; nástroj nepoužívá odstraněné deprecated parametry.

V `frontend/pnpm-workspace.yaml` je **jediný přesně omezený override**
`@vite-pwa/assets-generator@1.0.2>sharp: 0.35.4`. `pnpm dedupe` zároveň přesunul
existující wildcard závislost `sharp-ico` na stejnou opravenou verzi, bez druhého
override. Sharp 0.33.5 již v lockfile není. Parent funkce zůstala zachovaná.

`pnpm install --frozen-lockfile` prošel. Skutečný CLI `pwa-assets-generator` byl
spuštěn se stejným presetem `minimal-2023` a vstupem `public/logo_full.png` jako
projektový script; kopie vstupu i všechny výstupy byly v izolovaném `/tmp`.
Reprodukovatelný test je `frontend/tests/tooling/pwa-assets.mjs`:

```bash
node frontend/tests/tooling/pwa-assets.mjs
```

Test ověřuje přesnou množinu šesti souborů, PNG formát/rozměry, ICO frame,
dekóduje skutečné pixely, kontroluje alpha rohy a neprázdný obsah. Výsledky:

| Výstup | Rozměry | Bajty | Výsledek |
|---|---|---:|---|
| pwa-64x64.png | 64 × 64 | 4215 | PASS |
| pwa-192x192.png | 192 × 192 | 22196 | PASS |
| pwa-512x512.png | 512 × 512 | 108452 | PASS |
| maskable-icon-512x512.png | 512 × 512 | 54588 | PASS |
| apple-touch-icon-180x180.png | 180 × 180 | 10019 | PASS |
| favicon.ico | 48 × 48 | 3752 | PASS |

Runtime hlásil Sharp **0.35.4 / libvips 8.18.6**. Maskable ikona byla také vizuálně
zkontrolována. Strojový výstup: `implementation-final-pwa-assets.json`. Test pokrývá
skutečně používaný PNG/ICO workflow, nikoliv všechny formáty/kombinace Sharp na všech OS.
Override odstranit, až upstream rozšíří podporovaný rozsah, a tento test zopakovat.

## Audit — offline stav, online checkpoint blokovaný

Nový `pnpm audit --json` byl předložen stejnému approval mechanismu s uvedením
historického souhlasu uživatele. Reviewer jej **odmítl**: seznam názvů/verzí může
obsahovat neveřejná package metadata a zděděný souhlas nebyl uznán jako dostatečná
autorizace tohoto payloadu a cílového npm endpointu. Operace nebyla opakována ani
obcházena jiným endpointem či nástrojem. Nový online audit zatím **neproběhl**.

Bez síťového uploadu byl finální lock porovnán se starším, původně autorizovaným
snapshotem 180 unikátních GHSA. Zůstává **1 dříve známý high / 0 critical**:
Rollup 2.79.2 pod odloženým CRXJS extension. Cesty starého auditu jsou pouze
reprezentativní. V aktivním PWA grafu již není žádný zásah tohoto starého snapshotu;
**to není tvrzení o čistém aktuálním online auditu**.

[Sharp advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) je vyřešena
instalací opraveného Sharp. Snapshot s SHA-256 finálního locku a přesnými omezeními:
`implementation-final-offline-advisory-comparison.json`. Offline porovnání nepokrývá
nově zveřejněné advisory, Maven/JRE/OS ani prokazatelnost exploitu v aplikaci.

## Nezávislé bezpečnostní review a regrese

Byly ručně přečteny WalletStore, WalletVaultService, WalletSessionService,
BiometricService, StorageService, LegacyBiometricMigration, UnlockCard,
BiometricUnlock, auto-lock hook a příslušné integrační/browser testy.

Finální nezávislý běh: **44/44 PASS** — 32 trvalých security integračních případů,
1 nezávislý expiry probe a 11
kryptografických golden vectors (`wallet-lifecycle`, `biometric-prf`,
`crypto-compatibility`). Použit skutečný WebCrypto, CryptoJ a Zustand; authenticator
a storage failure injection jsou výslovně mockované. Fyzická biometrie ověřena nebyla.

Review výslovně vyžádalo další fault boundaries: commit seedu následovaný selháním
read-back; cleanup credentials po úspěšném password commitu; silent remove no-op;
neúspěšný backup commit. Implementační agent je doplnil, nezávislý běh je zahrnuje.
První dvě chyby ponechávají obnovitelný totožný seed a přístup novým heslem, reset
s no-op mazáním nehlásí odstraněnou peněženku.

**Nalezeno a opraveno při nezávislém QA:** legacy recovery capability po UV neměla deadline,
držela mnemonic/password v dočasném formuláři ve stavu `locked`. Syntetický test
posunul čas o hodinu a `completeLegacyRecovery` stále přijal ticket. Požadovaná
oprava přidává dvouminutovou expiraci, kontroly přes await/před commitem a odstranění
citlivého stavu formuláře po timeout/resume. Oprava byla nezávisle zkontrolována:
private ticket se ruší při lock/reset/open/cancel/unmount, deadline se kontroluje
přes await a před zápisem/odemčením. Původní neúspěšný probe nyní **PASS**; tři
trvalé regrese navíc pokrývají expiry, explicitní cancel a revokaci během await.
**S1–S7 source review sign-off je udělen.** Dočasný probe byl po ověření předán
autorovi k odstranění, jeho případ je trvale zahrnut v lifecycle suite. Log
nezávislého běhu: `/tmp/wallet-final-qa-security-results.log`.

## Dodatečná backendová regrese — dokončeno

Frontend reviewer našel, že balance/pending smyčka odmítala jen prázdnou neúplnou
stránku. Upstream `totalElements=100` a `list.size=50` se při pageSize100 vyhodnotil
jako kompletní; pending rezervace tak mohly být podhodnocené. QA přidalo dva testy
přes skutečné MockMvc→RestClient→HTTP: **oba nejprve selhaly, API vrátilo200 místo500**.

Oprava ve WalletBusinessService nyní ověřuje počet skutečných řádků proti očekávanému
počtu pro daný offset/total v obou smyčkách ještě před mapováním/agregací. Neúplná
nebo přebytečná stránka vyvolá chybu, ne částečný zůstatek. Legitimní krátká poslední
stránka zůstává funkční; testy navíc ověřují správné odečtení všech fee/amounts.

`nonEmptyTruncatedBalancePagesFailClosed` a `nonEmptyTruncatedPendingPagesFailClosed`
jsou v BackendCompatibilityTest. Frontend reviewer provedl nezávislé read-only
review opravy a schválil její offset/long/count výpočet i umístění před agregací.
Finální celý běh skutečným JDK21/PostgreSQL18.6/Tomcat: **25 testů,0 failures,0 errors,0 skipped,
BUILD SUCCESS**,34.5s. Příkaz:

```bash
mise exec java@openjdk-21.0.2 -- ./mvnw -o -Dlicense.skipCheckLicense=true test
```

Red log: `/tmp/wallet-final-qa-incomplete-pages-before.log`; green log:
`/tmp/wallet-final-qa-backend-tests.log`. Nejde o záruku atomického snapshotu node
balance/mempoolu napříč requesty. Licenční goal ponechán podle společného plánu na
jediné závěrečné spuštění po dokončení všech editací.

## Dodatečná backendová regrese: encoded route rate limiting — dokončeno

Druhý nezávislý candidate byl ověřen na skutečném Tomcatu, nikoliv jen MockMvc:
`/%61pi/core/v1/wallet/balances` router akceptoval, ale public bucket se vůbec
neodečetl; `/api/core/v1/wallet/%62alances` odečetl jen1 token místo10. Oba aliasy
pak přijaly druhý požadavek HTTP200 místo429. Spring firewall tyto varianty
neblokoval. Test provedl pouze šest syntetických lokálních requestů, žádný load test.

ThrottlingFilter i ThrottlingService nyní používají stejnou cestu z
[Spring RequestPath](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/server/RequestPath.html)
a dekódované segmenty
[PathSegment.valueToMatch](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/server/PathContainer.PathSegment.html).
Tím se pro prefix i cenu používá stejná sémantika jako při routování. Nejde o
form-URLDecoder: literal plus zůstává plus a context path se odděluje. Chybný parse
vrací400. Regrese ověřuje kanonickou cestu i oba aliasy, deset odečtených tokenů,
odmítnutí druhého požadavku a samostatně context/literal-plus chování.

`encodedBalanceAliasesCannotBypassThePublicBucketOrEndpointCost` je trvalý test
v BackendCompatibilityTest. Po této opravě celý finální běh obsahuje **26 testů
PASS,0 failures,0 errors,0 skipped, BUILD SUCCESS**,34.4s. Red evidence:
`/tmp/wallet-final-qa-encoded-path-both-before.log`; finální green evidence:
`/tmp/wallet-final-qa-backend-final-tests.log`. Tato sada zahrnuje i obě předchozí
truncation regrese. Změny ponechávají firewall a další routing ochrany aktivní. Frontend reviewer
provedl následné nezávislé read-only review této normalizace a regresí a udělil
explicitní sign-off; oba dodatečné backendové checkpointy jsou uzavřené.

## Zbývající závěrečné checkpointy
- Finální frontend build/statics, service-worker update scénář a fullstack browser
  běh eviduje frontend/test agent; jejich poslední výsledky budou doplněny.
- Java agent musí po statics synchronizaci sestavit finální JAR, ověřit obsah a
  provést závěrečný license goal. Jeho finálních26 PostgreSQL/Tomcat testů již prošlo, ale
  předchozí phase1 JAR není finální release artifact. Poslední nezávislá sada po
  opravách truncation a encoded-path obsahuje26 testů PASS.
- Nový online npm audit zůstává blokovaný explicitní autorizací uznanou reviewerem.

Úspěšné testy nenahrazují fyzická zařízení, nejstarší podporované browser verze,
produkční DB upgrade rehearsal ani audit všech kryptografických knihoven.


## Poslední nezávislé S4 ověření — invalidace po dokončení mutace

Po předchozím browser checkpointu testlead odhalil session otevřenou v jiném tabu
během probíhající mutace, navázanou na její počáteční token. Po commitu mohla
zůstat platná, dokud nepřišel opožděný storage event. Závěrečný omezený QA recheck
ověřil druhou invalidaci po ověřeném create/import/delete/password commitu.
Publisher vrací přesný token, který sám serializoval a zapsal; vlastní session
se otevírá s tímto completion tokenem, nikoliv s cizím tokenem načteným po await.

Nezávislé QA následně reprodukovalo nezbytnou chybovou variantu téže race:
password commit uspěl, jiný tab se otevřel během zápisu, ale cleanup credentials
selhal. Původní oprava odmítla migraci, přesto cizí snapshot zůstal platný.
Red log: `/tmp/wallet-final-qa-s4-failure-before.log`. Security agent doplnil
invalidaci také na chybovém ukončení již oznámené mutace. Obecné storage/read a
initialize chyby nadále nepublikují, takže nevzniká smyčka opakovaných invalidací.
Pokud publikování samo selže, UI upozorní na nutnost zavřít ostatní wallet taby.

Trvalá matice v wallet-lifecycle.test.ts má11 scénářů se skutečným WebCrypto/Zustand,
řízeným čekáním před/po zápisu a záměrně nedoručenými storage events:

- Delete: úspěch, chyba před odstraněním, chyba ověření po odstranění.
- Create/import: úspěch a chyba read-back po zápisu pro oba způsoby vytvoření.
- Password migration: úspěch, chyba před commitem, read-back chyba a cleanup chyba.

Každá větev ruší session otevřenou uvnitř mutace bez čekání na storage event.
Testy navíc ověřují zachování stejného seedu a funkčního původního nebo nového
hesla podle toho, zda commit nastal. Nezávislý původně neúspěšný cleanup probe
nyní prošel a byl odstraněn po převzetí případu do trvalé matice.

Finální nezávislý běh bez filtrů/skips: **54/54 PASS** —43 security integračních
případů a11 crypto vectors; log `/tmp/wallet-final-qa-s4-final-recheck.log`.
**S4 sign-off je udělen i pro dokončení a chybové ukončení mutací.** Ověření
nepředstírá fyzickou biometrii. Následující rebuild/static/JAR a nové finální
browser/fullstack běhy vlastní jejich implementační agenti; tento recheck je
sám nepotvrzuje. Online audit nebyl opakován.

## Uzavření společných artifact checkpointů

Backend vlastník následně dokončil clean verify26/26, license74/74 a přesnou
30-file dist/static/JAR/HTTP shodu nad finálním99/24/13PWA buildem. Navíc prošel
výslovně povolený MAINNETread-only backend/PWA smoke1/1 (14GET+20čtecíchPOST,
0mutací/tx); testovací prostředí uklizena. Viz
[artifact report](implementation-final-backend-artifact.md) a
[read-only report](implementation-mainnet-readonly.md). Nový online audit zůstává
blokovaný reviewerem; tento artifact checkpoint ho nenahrazuje.
