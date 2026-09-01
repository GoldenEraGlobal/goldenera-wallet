# Follow-up: Vaul → Base UI Drawer

Datum implementace: 2026-09-01. Bez commitu, deploye, MAINNET operace nebo změny CryptoJ. Tato etapa neprováděla bezpečnostní audit ani CVE analýzu.

## Zdroj migrace a API mapping

Implementace vychází z oficiální dokumentace [Base UI Drawer](https://base-ui.com/react/components/drawer) a [shadcn Base UI Drawer včetně migrace z Vaul](https://ui.shadcn.com/docs/components/base/drawer). Pro přesnou strukturu byl read-only načten oficiální shadcn `base-mira` registry item; projekt nebyl přepsán CLI.

| Původní Vaul/vaul-base | Base UI 1.7.0 | Implementace |
|---|---|---|
| `Drawer.Root` / `open` / `defaultOpen` | `Drawer.Root` | controlled i uncontrolled; callback zachován |
| `direction="bottom"` | `swipeDirection="down"` | wrapper default `down`; podporuje také `up/left/right` |
| `Overlay` | `Backdrop` | stabilní `data-slot="drawer-overlay"` |
| Vaul `Content` | `Viewport > Popup > Content` | oddělená focus/gesture vrstva a selectable scroll content |
| `asChild` / render funkce | `render` element nebo funkce | stávající button callsites fungují beze změny |
| `data-vaul-no-drag` | `data-base-ui-swipe-ignore` | close a family action buttons |
| `data-vaul-drawer-*` CSS | Base `data-swipe-*`, `data-open/closed`, nested attrs a CSS vars | staré selektory odstraněny |

Generický wrapper záměrně zachovává původní UX: modal default, bottom sheet, viditelný swipe handle, overlay se slabým blur, původní výškové limity80/90vh, safe-area padding a side drawer 75%/24rem. Base UI zajišťuje focus trap/return, Escape a outside dismissal; Popup CSS používá jeho swipe a nested proměnné. Shadcn požadavek pro iOS absolute overlay je splněn `body { position: relative; }`.

## Inventář změn a callsites

- `packages/ui/src/components/ui/drawer.tsx`: přímý `@base-ui/react/drawer`, oficiální kompozice Portal/Backdrop/Viewport/Popup/Content, swipe handle a directional/nested CSS.
- `packages/ui/src/components/ui/family-drawer.tsx`: odstraněn `vaul-base`; stejná Base UI kompozice, required hidden Title/Description, správný uncontrolled+callback state update, reset view při close a swipe-ignore pro interaktivní prvky.
- `packages/ui/src/components/ui/pull-to-refresh.tsx`: detekuje nové sloty viewport/popup/content/backdrop; staré Vaul selektory odstraněny.
- `packages/ui/src/styles/globals.css`: positioned body pro iOS overlay.
- `packages/ui/package.json` + `pnpm-lock.yaml`: odstraněny přímé i lock snapshots `vaul` a `vaul-base`; aktuální Base UI1.7.0 zůstává.
- `apps/web/vite.config.ts`: Vaul odstraněn z vendor group regexu.
- extension popup/sidepanel HTML: odstraněn mrtvý `data-vaul-drawer-wrapper`.
- Family callsites `ChangeTheme` a `TransferFilter`: konkrétní accessible title/description.
- Generické callsites byly prověřeny v `DevMenu`, `ReceiveTransfer`, `TransferDetail` a `TxSubmitCard`; jejich veřejné wrapper API se nemuselo měnit.

Po vyloučení historických `*.tsbuildinfo`, `node_modules` a build outputů není v authored frontend source, manifestu ani lock package snapshots žádný `vaul`, `vaul-base`, `data-vaul` nebo `vaul-drawer` výskyt.

## Funkční parity

- Controlled open: Receive, transfer detail, transaction review, theme a filter nadále dostávají každý close reason přes `onOpenChange(false)`.
- Uncontrolled open/trigger: DevMenu a Family trigger nyní používají Base UI state. Family varianta navíc opravuje původní případ `defaultOpen + onOpenChange`, který dříve callbackem nahradil interní setter.
- Focus/a11y: generické drawers zachovávají Base UI Title; Family má required skrytý Title+Description podle konkrétního flow. Base Popup vrací focus triggeru nebo předchozímu prvku.
- Gesture: `swipeDirection="down"` je default a viditelný handle zůstává; Base UI swipe movement/strength/snap/nested proměnné řídí transformace. Scroll/text content je oddělen v `Drawer.Content`; explicitní action prvky mají `data-base-ui-swipe-ignore`.
- Pull-to-refresh ignoruje celý nový drawer DOM podle stabilních `data-slot` atributů.
- Skutečně vnořené generické drawers jsou podporované Base UI Root nestingem a `data-nested-drawer-open` stack styly. Family „views“ nadále animují výměnu obsahu a resetují výchozí view při zavření.

## Vlastní validace kandidáta

- Offline lockfile-only update: PASS.
- Frozen offline install s již ověřeným lockfile a `--trust-lockfile`: PASS; odstraněno26 transitivních packages. Flag zabránil nové síťové supply-chain kontrole podle explicitního omezení této etapy.
- Native TypeScript7.0.2: API/UI/core/web app+config/extension app+config,7/7 přímých invokací PASS.
- UI tsup ESM/CJS/DTS build: PASS.
- Plný frontend lint:0errors/9 již známých warnings mimo Drawer změny.
- PWA Vite8 production build: PASS,3801modules,33precache entries.
- Extension shared-UI Vite8 ZIP build: PASS,3805modules; pouze stávající native-config loader a chunk-size warnings.
- Nezávislé scoped component QA:9/9PASS; anatomy/ARIA, controlled/uncontrolled state, Escape/outside/Close, focus restore, input/direction, skutečně nested Drawer, Family view reset/swipe-ignore a PTR popup isolation.
- Celý aktuální Vitest běh po přidání Drawer regresí:10files,110/110PASS.

První browser QA kandidát odhalil skutečnou hit-testing regresi: později rendrovaný full-screen Viewport měl `pointer-events:auto` a překrýval viditelný Backdrop. Oprava ponechává Viewport průchozí (`pointer-events:none`) a Popup explicitně interaktivní (`pointer-events:auto`); modalita, focus trap a outside dismissal v Base Root zůstaly aktivní. Po opravě znovu prošel scoped TS7UI/core typecheck, fresh PWA build3801/33 a DrawerRTL9/9.

Nezávislý finální production Chromium běh skončil **6/6PASS**: outside press po opravě, Close/Escape/focus návrat, controlled Receive/Transfer/transaction review, Family theme/filter, input/scroll/PTR izolace a skutečný CDP touch swipe. Běh měl0 transaction submitů. Drawer produkční zdroj je tímtozmrazen.

Nezávislý QA dokončil RTL i productionbrowser část. CDP touch emulace ověřila reálný browser gesture path, ale nenahrazuje fyzický iOS/Android device test. Finální static sync se záměrně odkládá, protože po Drawer GREEN následuje uživatelem požadovaná samostatná aktualizace JS `@goldenera/cryptoj`.
