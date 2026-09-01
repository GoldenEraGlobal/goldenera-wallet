# Drawer migration – funkční QA

Datum ověření: 2026-09-01

Tento dokument pokrývá pouze běžnou funkčnost, přístupnost a kompatibilitu migrace z Vaul na Base UI Drawer/Shadcn. Nejde o bezpečnostní audit. Produkční data, mainnet ani odeslání transakce nejsou součástí ověření.

## Akceptační matice

| Oblast | Požadované ověření | Stav |
| --- | --- | --- |
| Wrapper | `Root`, `Trigger`, `Close`, `Portal`, `Backdrop`, `Viewport`, `Popup`, `Title` a `Description` jsou zapojené podle Base UI anatomie a zachovávají veřejné wrapper API | PASS |
| Řízený stav | `open`/`onOpenChange` funguje pro trigger, close, Escape, klik mimo popup a programové zavření bez dvojitého callbacku nebo rozpojení UI/stavu | PASS |
| Fokus a klávesnice | Po otevření je fokus uvnitř modalu, Escape zavře a fokus se vrátí na původní trigger | PASS |
| Přístupný název | Každý skutečný drawer má dostupný `Title` a podle potřeby `Description`; browser accessibility tree má dialog s názvem a popisem | PASS |
| Scroll a vstupy | Scrollovatelný obsah a editace inputu nevyvolají nechtěné zavření/drag | PASS |
| Swipe/drag | Wrapper zachová směr swipe, viditelný handle a Family interaktivní potomci mají Base UI swipe-ignore | PASS v Chromium pointer emulaci |
| Family/nested | Přepínání family views zachová otevřený modal; zanořený drawer se zavře bez zavření rodiče | PASS |
| Pull-to-refresh | Dotyk začínající v novém `Popup`/drawer oblasti nespustí page refresh ani souběžné gesto | PASS |
| Reálné flows | Receive, Send review bez potvrzení, transfer detail, transfer filter a theme/settings projdou otevřením, interakcí a všemi způsoby zavření | PASS |
| Cleanup závislostí | Zdrojové importy, přímé manifesty a lockfile již neobsahují `vaul` ani `vaul-base` | PASS |

## Plánované vrstvy důkazu

1. Statický read-only review wrapperu a všech call sites ověří strukturu, řízený stav, názvy dialogů, selektory a odstranění Vaul API.
2. Vitest + Testing Library prověří callbacky, Escape/outside, návrat fokusu, přístupné role/názvy a izolaci pull-to-refresh.
3. Playwright nad čerstvým produkčním PWA buildem projde reálné wallet flows. Send skončí na review a nikdy nestiskne potvrzení.
4. Deterministické pointer/touch gesto ověří swipe jen tehdy, pokud Chromium emulace poskytne skutečný průběh stavu a viditelný výsledek. Jinak bude limit výslovně uveden; emulace není fyzické mobilní zařízení.

## Výsledky

- `tests/regressions/drawer-migration.test.tsx`: **9/9 PASS**. Sada ověřuje anatomii a ARIA vazby, controlled i uncontrolled změny, Escape/outside/Close, návrat fokusu, editovatelný input, vodorovný směr, nested parent/child, Family reset a swipe-ignore a izolaci pull-to-refresh.
- `e2e/drawer-migration.spec.ts` nad čerstvým produkčním PWA buildem: **6/6 PASS**. Prošly Receive, Send review bez potvrzení, transfer filter/detail, theme/settings, Escape/outside/focus/scroll a skutečný Chromium pointer drag na swipe handle.
- Playwright fixture blokovala externí originy. Počet potvrzených/odeslaných testovacích transakcí byl **0**.
- V aktivním source, přímých manifestech a lockfile nejsou importy ani balíčky `vaul`/`vaul-base`.
- Pointer drag je browserová emulace Chromium na desktop hostu. Dokládá zapojení Base UI gesture pipeline a viditelný výsledek, ne fyzický dotyk, soft keyboard ani konkrétní mobilní zařízení.

Zdrojem očekávané anatomie a interakcí byly oficiální dokumentace [Base UI Drawer](https://base-ui.com/react/components/drawer) a [shadcn Base Drawer](https://ui.shadcn.com/docs/components/base/drawer).
