# GoldenEra Wallet — code review PWA a backendu, návrh aktualizací

Datum: **31. 8. 2026**. Wallet commit: `d2dc2830dd2618c138eff209df1abd1be190537a`. **Aktivní rozsah: PWA frontend a její Java backend. Nativní aplikace i extension jsou podle upřesnění uživatele předpřipravené a aktuálně mimo vývoj.** Pracovali tři subagenti: bezpečnost klíčů/lifecycle, Java backend a samostatně závislosti. Hlavní reviewer prověřil transakce, API integraci, web/PWA, rozšíření, nativní konfiguraci a build; zásadní transakční nález ověřil ještě nezávislý subagent.

**Výsledek v aktivním rozsahu: 22 nálezů — 6× P1, 15× P2, 1× P3.** Další čtyři poznámky týkající se jen native/extension jsou odložené a do těchto priorit se nepočítají. P1 doporučuji opravit před produkčním vydáním dotčené platformy. Část nálezů má výslovné podmínky: konkrétní node verze, více otevřených oken, přímý přístup na serverový port nebo existující DB vazby. Počet není počet prokázaných vzdálených exploitů. Žádný P0 nebyl potvrzen.

Zdrojový kód, závislosti a lockfile zůstaly beze změny. V repozitáři přibyly pouze tyto reporty a bezpečné reprodukční podklady. Buildy, instalace dependencies a experimenty proběhly v oddělených `/tmp` kopiích. Nebyly použity skutečné uživatelské privátní klíče, odeslány skutečné transakce, aktualizovány externí systémy ani nasazena aplikace.

## Dokumenty

| Dokument | Obsah |
|---|---|
| [Bezpečnost klíčů a lifecycle](/home/andrej/Projects/goldenera/goldenera-wallet/docs/reviews/2026-08-31/security-review.md) | S1–S7: biometrie, vault, mazání, více oken, souběžné odemčení, auto-lock, síťová registrace |
| [Frontend, platformy a build](/home/andrej/Projects/goldenera/goldenera-wallet/docs/reviews/2026-08-31/frontend-review.md) | Aktivní F1/F5/F6/F7/F8/F10/F11: dvojí platba, QR, částky, historie, build, PostgreSQL volume; F2/F3/F4/F9 v odložené příloze |
| [Java backend](/home/andrej/Projects/goldenera/goldenera-wallet/docs/reviews/2026-08-31/backend-review.md) | B1–B8: node kontrakt, limity API, historie, poplatky, proxy, timeout, DB cleanup, quickstart |
| [Návrh aktualizací](/home/andrej/Projects/goldenera/goldenera-wallet/docs/reviews/2026-08-31/dependency-upgrades.md) | Nové verze, kompatibilita, konkrétní migrační zásahy, pořadí aktualizací a primární zdroje |
| [Bezpečnostní audit npm](/home/andrej/Projects/goldenera/goldenera-wallet/docs/reviews/2026-08-31/npm-audit-analysis.md) | Uživatelem povolený audit celého workspace, nikoli samostatné PWA; deduplikace a posouzení použití v aktivním PWA |
| [Úplný inventář závislostí](/home/andrej/Projects/goldenera/goldenera-wallet/docs/reviews/2026-08-31/dependency-inventory.json) | 100 npm a 34 Maven unikátních položek včetně package manageru, aliasu, parentu a pluginů; deklarované/zamčené/nové verze a zdroje |

## Nálezy podle priority

| ID | Priorita | Problém a praktický dopad |
|---|---|---|
| S1 | P1 | Webová biometrie odvozuje šifrovací klíč z uloženého veřejného credential ID; kopie storage stačí k offline obnově hesla. |
| S2 | P1 | Selhání čtení vaultu se tváří jako prázdná wallet; Create/Import pak může přepsat původní seed. |
| F1 | P1 | Dvojí Confirm během preflight může podepsat dvě platby s odlišnými nonce. |
| B1 | P1 | Klient neumí balance V2 současného node; odpověď selže při deserializaci. Po opravě je nutné správně mapovat spendable/locked. |
| B2 | P1 | Prázdné `addresses=` zahájí globální scan balances a mempoolu; anonymní request má neomezený náklad. |
| F11 | P1 | PostgreSQL 18 quickstart mount neobsahuje skutečné PGDATA; chybná persistence/startup. |
| S3 | P2 | Delete Wallet potlačí chybu mazání a oznámí úspěch, přestože seed zůstal uložen. |
| S4 | P2 | Druhé okno může vyměnit vault, zatímco první drží starý klíč a ukazuje recovery phrase jiné wallet. |
| S5 | P2 | Dobíhající duplicitní unlock obnoví klíč i po pozdějším ručním locku. |
| S6 | P2 | Resume může zrušit expirovaný timeout a přidělit další dvě minuty odemčení. |
| S7 | P2 | Neodpovídající nepovinná registrace zařízení zablokuje lokální unlock i zobrazení nové fráze. |
| B3 | P2 | Přechod pending/confirmed zahazuje offset; historie obsahuje duplikáty a některé převody chybí. |
| B4 | P2 | Native-only balance neodečítá fee pending převodů ostatních tokenů. |
| B5 | P2 | Důvěra všem proxy umožní při přímém přístupu rotováním XFF obejít IP rate limiting. |
| B6 | P2 | HTTP klient node nemá deadline odpovědi, takže request/subscription může čekat neomezeně. |
| B7 | P2 | Cleanup zařízení s navázanými účty selže na FK: migrace nemá DB cascade. |
| F5 | P2 | Neplatný QR nastaví navigační flag před validací a zablokuje skener i cancel. |
| F6 | P2 | Platné decimals=0 se změní na 8; zůstatky a historie ukazují jinou škálu částek než Send. |
| F7 | P2 | Send validace vždy škáluje na 8 decimals a odmítá platné malé částky tokenů s vyšší přesností. |
| F8 | P2 | Změna filtru historie neresetuje stránku; zobrazí falešně prázdnou historii bez ovládání stránek. |
| F10 | P2 | Root typecheck neexistuje v Turbo configu; aplikační tsc chyby release build nekontroluje. |
| B8 | P3 | Quickstart vynechává NODE_WEBHOOK_UID; nefunguje registrace subscription. Není to automaticky pád celého backendu. |

Odloženo mimo aktuální PWA scope: F2 (API URL extension), F3 (native dev server URL), F4 (Android launcher) a F9 (native dependency paths). Zůstávají na konci frontend reportu pro případ budoucího obnovení vývoje.

Každý detailní nález obsahuje konkrétní soubor/řádky, podmínky, dopad, míru ověření a návrh nápravy. Nepoužívané vadné API, chybějící funkce, neověřené platformní podmínky a stylistický dluh jsou od aktivních nálezů odděleny.

## Co skutečně prošlo ověřením

| Kontrola | Výsledek |
|---|---|
| Frozen npm workspace instalace | PASS, pnpm 10.28.2, 1236 balíčků, Node 24.19.0; install lifecycle skripty vypnuté |
| Web build včetně PWA/service workeru | PASS |
| Extension build včetně ZIP — mimo aktivní scope | Původně ověřeno PASS, informativní; není požadavkem PWA release |
| UI build včetně `.d.ts`, API/UI typecheck | PASS |
| Core typecheck po sestavení UI deklarací | PASS |
| Root `pnpm typecheck` | FAIL: Turbo task není deklarována |
| Typecheck aplikačními tsconfigy | FAIL: aktivní web/PWA 32 diagnostik; dříve ověřená extension 5 pouze informativně |
| Lint autorského frontendu | 84 TS/TSX souborů; 847 errors, 32 warnings, převážně quotes/semi; bez autofixu |
| Java compile | PASS, Maven offline, 188 souborů včetně generated klienta, release 21 |
| Bezpečnostní fault-injection reprodukce | 7/7 PASS, skutečný Zustand/WebCrypto, mock storage/platform/síť |
| Dvojí platba | PASS se skutečným TanStack QueryObserver a cryptoj; nonce 1 a 2, bez skutečné sítě |
| QR a přesnost částek | Reprodukovány neplatný QR deadlock a odmítnutí platné malé částky |
| Online npm audit po výslovném souhlasu | Dokončen, exit 1 kvůli nálezům: 203 výskytů v celém workspace, nikoli jen v PWA (4 critical, 92 high, 96 moderate, 11 low), 199 advisory records / 180 různých advisory URL; není to 203 prokázaných exploitů aplikace |
| Java harness | Potvrzeny V2 chyba, paginace, fee filtr, prázdné addresses a chování chybějící env proměnné |

Reprodukční skripty a výstupy jsou v [evidence](/home/andrej/Projects/goldenera/goldenera-wallet/docs/reviews/2026-08-31/evidence/README.md). Skripty nejsou nová projektová test suite; zaznamenávají konkrétní scénáře review a používají popsané izolované závislosti.

## Doporučené pořadí práce

1. Opravit ochranu biometrického hesla a zacházení s chybami vaultu. Naplánovat migraci starých biometrických dat; pouhý upgrade balíčků tyto chyby nevyřeší.
2. Zabránit souběžným platbám a neplatným dokončením auth operací po lock/reset; řešit sdílení stavu více oken. Přidat regresní scénáře uvedené v reportu.
3. Sladit wallet s konkrétním node kontraktem V2/spendable, opravit API bounds, paginaci, fee rezervace, důvěru proxy a timeouty.
4. Opravit PostgreSQL persistence a ověřit nasazení PWA, její offline chování, service worker update a nejstarší podporované prohlížeče. Native sync/launcher a konfiguraci extension nyní neřešit.
5. Zprovoznit CI typecheck a poté aktualizovat závislosti po kompatibilních skupinách podle samostatného návrhu. Velké migrace runtime/routeru/generátorů nepřimíchávat do prvních bezpečnostních oprav.

## Rozsah a omezení

Původní širší review pokrylo autorské oblasti 73 Java zdrojů, frontend core/UI/apps, generated API kontrakty, DB migrace, konfiguraci, Docker a CI. Finální aktivní priority a doporučení jsou omezené na PWA+backend; native/extension výsledky zůstávají pouze informativní. Vygenerované/minifikované vendor assets nebyly ručně auditovány řádek po řádku. Podklady o node kompatibilitě vycházejí ze současného čistého lokálního node checkoutu (`7ace5ac8ef4a13e1f034c16be6ed16c4ebe33b2d`), nikoli z domněnky o verzi provozované v produkci.

Nebyly spuštěny Android/iOS device testy, skutečná biometrie, plný server s PostgreSQL, kompletní živé wallet→node end-to-end scénáře ani kryptografický audit všech tranzitivních knihoven. Frontend build běžel s Node 24; CI/Docker dosud používají Node 22. Po počátečním odmítnutí exportu inventáře auto-review uživatel výslovně povolil odeslání názvů/verzí balíčků. Npm bulk audit byl následně úspěšně spuštěn; nic se neobcházelo a žádný zdrojový kód ani klíče se neposílaly. Výsledky npm nepokrývají Maven, nativní knihovny, JRE/OS image ani prokazatelnost zneužití v aplikaci. Návrh aktualizací a samostatný audit report uvádějí ověřené zdroje a podmínky. Úspěšný compile/build ani absence dalšího nálezu nejsou potvrzením bezpečnosti celého systému.
