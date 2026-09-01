# GoldenEra Wallet – backend code review

Read-only kontrola Java backendu, konfigurace, Liquibase schématu a integrace s aktuálním lokálním `goldenera-node` / `goldenera-cryptoj`. Zdrojový repozitář jsem neměnil. Hodnocení neobsahuje tvrzení o běžícím produkčním node; kompatibilita níže se vztahuje k aktuálnímu lokálnímu zdrojovému kódu node.

Při závěrečné kontrole byly wallet, node i cryptoj pracovní stromy čisté. Relevantní V2 změny tedy nebyly necommitované lokální úpravy; poslední commit zasahující uvedené balance soubory byl v node `a908569`, v cryptoj `944fe53`. Starší nasazený node používající výhradně V1 nemusí nález B1 vykazovat.

## Ověření

- Backend zkopírován do `/tmp/goldenera-wallet-backend-review`, kompilován přes skill `java-mise-toolchain`: `mise exec -- ./mvnw -o -DskipTests compile`. Výsledek **BUILD SUCCESS**, 188 Java souborů včetně vygenerovaného klienta, Java release 21. Log: `/tmp/goldenera-wallet-backend-compile.log`.
- Reprodukční Java harness používá skutečné zkompilované wallet třídy, skutečný Jackson mapper, MapStruct mapper a Spring MockMvc; node služby nahrazuje deterministickými podtřídami. Zdroj: `/tmp/goldenera-wallet-backend-review/ReviewHarness.java`, výstup: `/tmp/goldenera-wallet-backend-review/harness-output.txt`.
- Harness prokázal odmítnutí `V2`, rozbité stránkování, nesprávný poplatek při token filtru a přijetí prázdných adres controllerem.
- Neukládal jsem žádné tajné hodnoty a neposílal transakce ani webhook registrace do reálného node. Repo nemá `src/test`; nebyl spuštěn celý server s PostgreSQL. Databázový nález vychází z konkrétního FK v migraci a použitého batch delete, nikoli z integračního PostgreSQL testu.

## Nálezy

### B1 [P1] Aktualizovat kontrakt zůstatků: současný node vrací nepodporované `V2`

**Primární místo:** [v1.json:1](/home/andrej/Projects/goldenera/goldenera-wallet/src/main/resources/node-openapi/v1.json:1), schema `components.schemas.AccountBalanceDtoV1.properties.version` (celý JSON je na jediném řádku). Místo pádu při použití klienta: [ExplorerNodeService.java:106](/home/andrej/Projects/goldenera/goldenera-wallet/src/main/java/global/goldenera/wallet/service/node/ExplorerNodeService.java:106).

Uložený kontrakt povoluje pouze `V1`; podle něj Maven generuje `AccountBalanceDtoV1.VersionEnum`, jehož `fromValue("V2")` vyhodí výjimku. Aktuální crypto podporuje `AccountBalanceStateVersion.V2`, `creditLockedMiningReward` nastavuje `V2` a node tento `version` posílá v explorer balance DTO. Stačí jediný takový zůstatek ve stránce: Jackson nedeserializuje celou odpověď, `/wallet/balances` skončí 500 a peněženka nezíská balance. Vypnutí `FAIL_ON_UNKNOWN_PROPERTIES` nepomáhá, protože nejde o neznámé pole, ale o neplatnou enum hodnotu.

**Repro:** skutečný wallet mapper s JSON `{"version":"V2","balance":"100","lockedMiningReward":"60","spendableBalance":"40"}` vrací `ValueInstantiationException`, root `Unexpected value 'V2'`. Reference node: [AccountBalanceDtoV1.java:49](/home/andrej/Projects/goldenera/goldenera-node/src/main/java/global/goldenera/node/explorer/api/v1/account/dtos/AccountBalanceDtoV1.java:49), [AccountBalanceStateImpl.java:116](/home/andrej/Projects/goldenera/goldenera-cryptoj/src/main/java/global/goldenera/cryptoj/common/state/impl/AccountBalanceStateImpl.java:116).

**Oprava:** regenerovat Java kontrakt proti zamýšlené verzi node a otestovat V2 odpověď. Součástí opravy musí být význam zůstatků: aktuální [WalletMapper.java:60](/home/andrej/Projects/goldenera/goldenera-wallet/src/main/java/global/goldenera/wallet/api/core/v1/wallet/mappers/WalletMapper.java:60) mapuje celkový `balance`, nikoliv `spendableBalance`. Pouhé přidání enumu tedy zpřístupní uživateli částku zahrnující zamčené těžební odměny; je nutné oddělit total/locked/spendable a od pending odečítat až disponibilní částku. Tento druhý dopad je nyní maskován uvedeným selháním deserializace, neuvádím jej jako nezávisle běžící chybu.

### B2 [P1] Odmítnout prázdnou množinu adres před neomezeným načítáním balance

**Místo:** [WalletApiV1.java:69](/home/andrej/Projects/goldenera/goldenera-wallet/src/main/java/global/goldenera/wallet/api/core/v1/wallet/WalletApiV1.java:69)–75. Navazující neomezená smyčka: [WalletBusinessService.java:87](/home/andrej/Projects/goldenera/goldenera-wallet/src/main/java/global/goldenera/wallet/service/business/WalletBusinessService.java:87)–104.

`@RequestParam Set<Address> addresses` neověřuje neprázdnost. Anonymní `GET /api/core/v1/wallet/balances?addresses=` Spring přijme jako prázdný set. Oba node bulk dotazy interpretují prázdné adresy jako **žádný filtr**. Wallet potom postupně ukládá všechny balance celé sítě do paměti, obdobně stáhne celý mempool a pro každou balance znovu prochází všechny pending převody. Jeden levný veřejný request tak může znamenat tisíce vzdálených dotazů a značnou spotřebu heapu/CPU; IP limiter účtuje stále jediný token.

**Repro:** MockMvc se skutečným `WebConfig` v harnessu: `Empty addresses HTTP=200; passed addresses=[]`. Semantika node ověřena v [ExAccountBalanceCoreService.java:166](/home/andrej/Projects/goldenera/goldenera-node/src/main/java/global/goldenera/node/explorer/services/core/ExAccountBalanceCoreService.java:166)–171 a [ExMemTransferCoreService.java:168](/home/andrej/Projects/goldenera/goldenera-node/src/main/java/global/goldenera/node/explorer/services/core/ExMemTransferCoreService.java:168)–172; predicate vzniká jen při neprázdném setu. `BulkPageRequestValidator` maximální velikost filtru kontroluje, neprázdnost nikoliv.

**Oprava:** na veřejné wallet hranici vyžadovat 1–N validních nenulových adres; nikdy nedovolit prázdnému wallet dotazu přejít na globální scan. Zároveň přidat celkový limit práce/paginaci výsledku a použít agregaci pending podle adresy/tokenů místo opakovaného plného průchodu. Reprodukce neprováděla zatěžovací útok na běžící systém; velikost dopadu roste s daty sítě.

### B3 [P2] Zachovat offset při přechodu z pending na confirmed stránku

**Místo:** [WalletBusinessService.java:292](/home/andrej/Projects/goldenera/goldenera-wallet/src/main/java/global/goldenera/wallet/service/business/WalletBusinessService.java:292)–297.

`confirmedOffset / pageSize` zahodí zbytek. Pokud počet pending není násobek velikosti stránky, první plně confirmed stránka začíná příliš brzy. Výsledkem jsou duplikované položky a některé starší transakce nejsou dostupné ani na poslední deklarované stránce.

**Repro skutečného business kódu:** 3 pending, 30 confirmed, pageSize 20. Stránka 0 vrací pending + confirmed C0–C16. Stránka 1 vrací C0–C19 a `last=true`, ačkoli má vrátit C17–C29. C0–C16 jsou zdvojené a C20–C29 přes běžnou paginaci zmizí.

**Oprava:** načítat confirmed od přesného offsetu; pokud node poskytuje jen pageNumber/pageSize, načíst jednu nebo dvě sousední stránky a oříznout zbytek offsetu. Přidat test počtů pending 0, 1, pageSize−1, pageSize, pageSize+1.

### B4 [P2] Započítat nativní poplatky i za pending převody jiných tokenů

**Místo:** [WalletBusinessService.java:103](/home/andrej/Projects/goldenera/goldenera-wallet/src/main/java/global/goldenera/wallet/service/business/WalletBusinessService.java:103)–104; token filtr se předává node také na řádcích 122–127.

Balance dotaz i pending dotaz používají stejný token filtr. Když klient žádá jen GE (`tokenAddresses={Address.ZERO}`), pending transakce custom tokenů se vůbec nenačtou. Pozdější `adjustBalanceForPendingOutgoing` sice chce odečíst GE fee ze všech odchozích transakcí (178–179), ale tyto transakce už ve vstupu nemá. Nativní disponibilní balance je proto nadhodnocená a další Send/MAX může skončit odmítnutím kvůli již rezervovaným prostředkům.

**Repro:** confirmed GE balance 100, jediný odchozí custom-token převod s fee 7. Skutečná metoda vrací při native-only filtru 100 a při prázdném token filtru 93; oba dotazy na GE mají vrátit 93. Node opravdu filtruje `tokenAddress IN (...)`, viz `ExMemTransferCoreService.java:162`–163.

**Oprava:** pro nativní fee získávat všechny odchozí pending transakce daných adres nezávisle na požadovaných tokenech, případně používat autoritativní node rezervace. Token filtr se má týkat vracených balances a částek, ne nativních poplatků.

### B5 [P2] Nevěřit `X-Forwarded-For` od libovolného klienta

**Místo:** [application.properties:7](/home/andrej/Projects/goldenera/goldenera-wallet/src/main/resources/application.properties:7)–14, zejména `server.tomcat.remoteip.internal-proxies=.*` na řádku 10.

Native RemoteIpValve považuje s tímto regexem za proxy každou příchozí adresu. Při přímém přístupu na wallet port si tedy klient může zvolit výsledné `request.getRemoteAddr()` pomocí `X-Forwarded-For`. Obě rate-limit vrstvy na této hodnotě závisejí (`ThrottlingService.java:119`–120, `ThrottlingFilter.java:64`). Rotování podvržených adres vytváří stále nové buckety a obchází ochranu. Podmínka je praktická: README publikuje port na všech host adresách, nikoli pouze na loopback či privátní ingress.

**Repro podmínka:** dvě série requestů na přímo dosažitelný port s rozdílnými podvrženými `X-Forwarded-For` jsou počítány pod odlišnými klienty. Nezkoušeno proti produkci.

**Oprava:** důvěřovat jen konkrétní proxy síti/IP, nepřipustit externí bypass proxy a zajistit přepsání příchozích forwarding hlaviček na ingressu. Pouhý přechod na vlastní čtení XFF by chybu neopravil.

### B6 [P2] Nastavit deadline také pro odpověď node

**Místo:** [NodeClientConfig.java:73](/home/andrej/Projects/goldenera/goldenera-wallet/src/main/java/global/goldenera/wallet/config/NodeClientConfig.java:73)–79, zejména řádek 76.

HTTP klient má pouze `connectTimeout(30s)`; `JdkClientHttpRequestFactory` nemá `setReadTimeout`. Když node spojení přijme, ale nevrací hlavičky/tělo, wallet request může čekat neomezeně. `@Retryable` neřeší požadavek, který nikdy nevyhodí timeout. Stejný klient používá synchronní `@EventListener(ApplicationReadyEvent.class)` v `SubscriptionSyncService`, takže visící subscribe může zablokovat i dokončení startup/readiness.

**Ověření:** bytecode skutečné Spring závislosti pomocí `mise exec -- javap -private -c` potvrzuje, že factory ponechá `readTimeout=null`, dokud se explicitně nenastaví; konfigurace setter nikde nevolá. Celou outage simulaci jsem nespouštěl.

**Oprava:** nakonfigurovat konečný read/request deadline pro node volání, promyslet celkový retry budget a přesunout neesenciální subscribe do omezené asynchronní inicializace. Ověřit serverem, který akceptuje TCP/HTTP spojení, ale nepošle odpověď.

### B7 [P2, podmíněný daty] Doplnit DB cascade před batch mazáním zařízení

**Místo:** [001-initial-schema.yaml:495](/home/andrej/Projects/goldenera/goldenera-wallet/src/main/resources/db/changelog/changesets/001-initial-schema.yaml:495)–503; spotřebitel [SubscriptionCleanupService.java:69](/home/andrej/Projects/goldenera/goldenera-wallet/src/main/java/global/goldenera/wallet/service/scheduler/SubscriptionCleanupService.java:69)–73.

Cleanup předpokládá, že `deleteAllByIdInBatch(zombieDeviceIds)` smaže také `user_account`. JPA entita sice deklaruje `@OnDelete(CASCADE)`, ale skutečný Liquibase FK `fk_user_account_device` neobsahuje `onDelete: CASCADE`. Aplikace používá `ddl-auto=validate`, takže Hibernate FK nepřepíše. Jakmile staré zařízení má alespoň jeden user_account, databáze odmítne delete a transakce celé dávky se vrátí zpět; cleanup znovu selže další den.

**Repro podmínka:** migrací vytvořená DB, Device s `last_seen_at` starším 180 dní a navázaný UserAccount. Spustit `cleanupZombies`; PostgreSQL FK violation. Aktuální API registruje pouze Device a nemá endpoint vytvářející UserAccount, proto jde dnes především o existující/importovaná data nebo rozpracovaný subscription workflow; na prázdné instalaci se chyba nemusí projevit.

**Oprava:** novou dopřednou migrací změnit FK na `ON DELETE CASCADE`, nebo explicitně smazat child řádky před batch delete. Není vhodné pouze přepsat již aplikovaný initial changeset.

### B8 [P3] Doplnit ID webhooku do quickstart konfigurace

**Místo:** [README.md:128](/home/andrej/Projects/goldenera/goldenera-wallet/README.md:128)–131.

Quickstart uvádí pouze base URL, API key a webhook secret, ale aplikace vyžaduje také `NODE_WEBHOOK_UID` (`application.properties:65`, `NodeProperties.java:45`–46). Uživatel postupující přesně podle návodu nemá platný cíl subscription. `SubscriptionSyncService` pak při startu a každou hodinu zkouší subscribe neplatného ID; chybu zachytí a pouze zaloguje.

**Upřesnění ověřené v harnessu:** Spring Boot Binder při chybějící env proměnné nechá ve string property doslovný `${...}` placeholder. Ten projde `@NotBlank`, takže není správné automaticky tvrdit, že celý server nenastartuje. Node následně validuje UUID a takové ID odmítne. Repro výstup: `Missing webhook env binding=${REVIEW_MISSING_WEBHOOK_UID}`.

**Oprava:** přidat `NODE_WEBHOOK_UID` do `.env` ukázky i tabulky, popsat vytvoření webhooku a získání ID a ID validovat jako UUID už při startu. Tato chyba dnes postihuje subscription inicializaci; samotné balance/send endpointy na přijatých webhoocích nezávisí.

## Doplňující pozorování, nezapočítáno jako samostatné jisté chyby hlavního workflow

- [WebhookSignatureVerifier.java:88](/home/andrej/Projects/goldenera/goldenera-wallet/src/main/java/global/goldenera/wallet/components/WebhookSignatureVerifier.java:88) loguje také **správně vypočtený** HMAC pro útočníkem dodané tělo. Čtenář logů tím získá platný podpis právě tohoto těla a může jej v pětiminutovém okně zopakovat. Doporučuji nelogovat vypočtené ani přijaté podpisy. Samotný webhook handler v aktuálním wallet nedělá žádné vedlejší efekty, proto z toho neodvozuji krádež či fungující kompromitaci notifikací.
- `TrackedAddressCoreService` a `UserAccountCoreService` jsou prázdné; `SubscriptionSyncService` pouze registruje NEW_BLOCK a `NodeWebhookApiV1.handleEvent` nepředává nic dál. Push/trackování adres tedy není hotový workflow. README tento feature výslovně neslibuje, proto nejde o samostatnou regresi.
- Nenašel jsem tvrzení pro dvojité účtování stejného requestu: ThrottlingFilter je registrován jako component i ve security chainu, ale `OncePerRequestFilter` druhé vnořené zpracování přeskočí. Nenahlášeno jako bug.
- HMAC formát wallet odpovídá současnému node: timestamp + `.` + raw bytes, HmacSHA256, Base64; aktuální node vytváří webhook secret jako UTF-8 text, takže převod secretu `getBytes(UTF_8)` ve wallet není automaticky chyba hex/Base64 dekódování.
