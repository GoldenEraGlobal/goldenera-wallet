# Drawer migrace – finální funkční QA dodatek

Datum finálního browser ověření: 2026-09-01.

Tento dodatek uzavírá pouze funkční QA migrace z Vaul na Base UI Drawer/Shadcn. Test běžel nad čerstvým lokálním production preview a izolovaným route mock API. Nepoužil `.env`, mainnet ani skutečné odeslání transakce a nejde o bezpečnostní audit.

## Výsledek

| Vrstva | Rozsah | Výsledek |
| --- | --- | --- |
| Component/RTL | anatomy a ARIA, controlled/uncontrolled state, Close/backdrop/Escape, focus return, směr a input, nested Drawer, Family view reset a PTR izolace | **9/9 PASS** |
| Chromium browser | Receive, backdrop/Escape/PTR, Send review Cancel, transfer filter/detail, Theme/Family a CDP touch swipe | **6/6 PASS** |
| Production sestavení | fresh build a typecheck po opravě hit testingu Viewport/Popup | **GREEN** |

Finální scoped příkaz použil `frontend/e2e/drawer-migration.spec.ts`, jeden Chromium worker, port `4187`, timeout 480 sekund a `WALLET_E2E_PRODUCTION=1`. Všech šest scénářů prošlo za 2,6 minuty. Přesný dříve červený scénář `Receive closes on outside press and Escape without invoking pull-to-refresh` po opravě prošel, takže Backdrop je znovu kliknutelný, Escape zavírá drawer a drawer gesto nespouští pull-to-refresh.

Send review se pouze posunul a zavřel přes Cancel/Escape. Route fixture po každém relevantním scénáři ověřila `submitted.length === 0`; žádná transakce nebyla potvrzena ani odeslána.

## Limit dotykového ověření

Chromium scénář použil skutečný browser input přes CDP `Input.dispatchTouchEvent`: dotyk začal na swipe handle, postupoval dolů a drawer se zavřel bez balance refresh requestu. To ověřuje integraci Base UI gesta, DOM hit testing a ochranu pull-to-refresh v Chromium. Jde však o deterministickou softwarovou emulaci; výsledek neprokazuje chování fyzického dotykového panelu, mobilního OS ani konkrétního WebView.

Chybějící browser runtime knihovny byly pro QA staženy jako tři distribuční Ubuntu `.deb` balíčky, rozbaleny bez instalace pouze do task-specific `/tmp` a načteny přes `LD_LIBRARY_PATH`. Produkční ani systémové soubory tím nebyly změněny.
