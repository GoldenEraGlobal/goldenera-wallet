# Skutečný node/explorer – výslovně povolené čtecí ověření

Po samostatném povolení uživatele byl proveden backendový smoke a **1/1 produkční
PWA browser smoke, bez přeskočení**, proti jím nakonfigurovanému MAINNET endpointu.
Nešlo o transakční test: **0 odeslaných mutací a 0 odeslaných transakcí**.

Backend provedl celkem **14 GET a 20 výslovně čtecích bulk POST**; nebyl žádný
blokovaný outbound pokus. POST zde není vydáván za GET ani za nulu POST requestů.
Byly povoleny pouze tyto tři POST dotazy:

- `/api/explorer/v1/account/balance/page/bulk`
- `/api/explorer/v1/mem-transfer/page/bulk`
- `/api/explorer/v1/transfer/page/bulk`

Jejich sémantika byla před povolením ověřena v aktuálním lokálním `goldenera-node`:
controllers AccountBalanceApiV1, MemTransferApiV1 a TransferApiV1 pouze mapují výsledek
`getPageBulk`; příslušné ExAccountBalanceCoreService, ExMemTransferCoreService a
ExTransferCoreService mají `@Transactional(readOnly=true)` a končí repository
`findAll(spec, pageable)`. Nevolají mempool submit, webhook, admin ani zápisové služby.
Použil se proto skutečný produkční klient bez testového překladu POST na GET.

## Ochrany testovacího prostředí

Test-only launcher `src/test/java/global/goldenera/wallet/MainnetReadOnlySmoke.java`:

- načetl jen NODE_BASE_URL a NODE_API_KEY z `.env` do paměti procesu; credentials
  nebyly vypsány, vloženy do argumentů procesu ani exportovány do reportů;
- `.env` neměnil a nepoužil z něj datasource; vytvořil nový lokální PostgreSQL18.6
  a přepsal všechny databázové connection údaje před startem aplikace;
- skutečně odstranil BeanDefinitions SubscriptionSyncService a SubscriptionCleanupService
  před jejich inicializací a po startu ověřil jejich nepřítomnost;
- použil samostatný HttpClient s redirects **NEVER** a před čtením ověřil instalaci
  guardu; guard povoloval jen přesný konfigurovaný origin a konkrétní čtecí cesty;
- povolil nejvýše 200 outbound read pokusů, malé stránky a nejvýše tři adresy;
- blokoval jakýkoli jiný POST/PUT/PATCH/DELETE, včetně tx a webhook operací;
- na lokálním wallet serveru povoloval pouze GET/HEAD/OPTIONS. Browser navíc zakázal
  zápisové wallet požadavky, automatickou device registration lokálně potlačil
  a nikdy neprovedl Confirm/Send.

Běžná produkční konfigurace tímto testovacím režimem nebyla změněna. Guard ani
testovací endpoint nejsou součástí produkčního JARu. API key může na serveru vyvolat
běžné access logging/rate-limit metriky; tvrzení o nulových mutacích se týká
odeslaných aplikačních operací, nikoliv nezávislé interní činnosti běžícího node.

## Skutečně pozorované výsledky

- Node info a seznam tokenů: úspěšné čtení, 1 dostupný token.
- Veřejná adresa byla vybrána z maximálně tří explorer balance záznamů; žádný
  soukromý klíč skutečného uživatele nebyl použit.
- Potvrzená invarianta available ≤ spendable a spendable + locked ≤ total.
- History stránky 0/1 měly počty 1/0 a stejné totalElements 1 v okamžiku čtení.
- Úspěšně načten nonce, fee doporučení a prázdný účet syntetické adresy.
- PWA zobrazila reálný token/detail/historii veřejné testovací wallet a ověřila
  GET čtení veřejné watch adresy; prázdné addresses správně vrátily HTTP400.

Živý vzorek obsahoval **V1 balances a token s 8 decimals**. Není prohlašován za
živé ověření V2 vestingu, decimals0, velkého mempoolu nebo reorgu. Tyto případy
pokrývají oddělené syntetické/regresní testy. Identifikace MAINNET zde odpovídá
uživatelem dodanému endpointu; neproběhla samostatná kryptografická atestace genesis.

Redigovaná evidence:

- `implementation-mainnet-readonly.json`: backend výsledky a konečné method/path počty.
- `implementation-mainnet-readonly-browser.json`: browserový souhrn bez credentials.
- `implementation-mainnet-readonly-cleanup.json`: ukončený vlastní PID a odstraněné
  dva vlastní dočasné kontejnery. `cleanupComplete=true` je také v read reportu.

Port18086 byl po testu uzavřen. Žádná produkční databáze, wallet ani blockchain
nebyly tímto ověřením změněny a žádný online package audit nebyl tímto povolením proveden.
