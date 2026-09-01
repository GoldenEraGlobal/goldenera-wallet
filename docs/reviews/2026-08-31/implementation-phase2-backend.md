# Etapa 2 – opravy backendu B1–B8 a deployment F11

Backendové změny jsou implementované a jejich **23 integračních/regresních testů
prošlo: 0 failures, 0 errors, 0 skipped** na skutečném Java 21, PostgreSQL 18.6 a
Tomcatu. Následné nezávislé QA rozšířilo sadu na26testů. Finální package, license,
statics/JAR/HTTP shoda i skutečný read-only node smoke jsou nyní dokončené; viz
[finální artifact report](implementation-final-backend-artifact.md). Níže zůstává
evidence původního23-testového checkpointu etapy2.

## Opravené chování

**B1 – zůstatky V2 a význam částek.** Uložený node kontrakt podporuje account balance
verze V1 i V2 a nová vesting pole. `WalletMapper` ověřuje `locked <= total` a
`spendable <= total - locked`; pochybná upstream data neprezentuje jako disponibilní
částku. V1 bez nových polí dostává `locked=0`, `spendable=total`.

Wallet API zachovává původní pole `balance` jako částku dostupnou **po odečtení
pending rezervací**; právě tu dál používá Send/MAX. Přibyla tři desetinná string pole:

| Pole | Význam |
|---|---|
| `totalBalance` | Celkový potvrzený zůstatek včetně zamčených odměn |
| `lockedMiningReward` | Potvrzené těžební odměny, které zatím nejdou utratit |
| `spendableBalance` | Potvrzený odemčený zůstatek před pending rezervacemi |
| `balance` | Disponibilní zůstatek po pending částkách a GE poplatcích |

Příklad testu: total 100, locked 60, spendable 40, pending amount 5 + fee 2 ⇒
`balance=33`, nikoliv 93. Kontrakt byl předem odsouhlasen frontend agentem;
skutečný Springdoc snapshot předán jako `/tmp/wallet-phase2-openapi.json`.
Backend agent neupravoval frontend generované soubory.

**B2 – validace a cena dotazů.** Balance/history požadují 1–100 nenulových adres,
nejvýše 100 platných token filtrů. History má pageSize 1–100 a maximální offset
100000 řádků; násobení používá `long`. Prázdný set nikdy neprojde na node jako globální
scan. Balance query přijme nejvýše 2000 řádků a naplánuje nejvýše 20 node stránek
v rámci 10s plánovacího budgetu. Běžící node call má vlastní konečný timeout; nejde
o tvrzení, že libovolně přenastavený timeout bude násilně přerušen v desáté sekundě.
Překročení vrací chybu a požaduje užší dotaz, nikdy částečný zůstatek.
Pending rezervace se agregují jedním průchodem podle `(address, token)` pomocí
BigInteger; zmizel opakovaný průchod každým pending převodem pro každou balance.
Duplicity pending hashů se započtou jednou. Balance endpoint stojí v IP limiteru
10 tokenů, history 3; cena nepřekročí nakonfigurovanou kapacitu bucketu.

**B3 – přesné stránkování.** Confirmed offset používá i zbytek po dělení velikostí
stránky. Podle potřeby se načtou nejvýše dvě sousední confirmed stránky a výsledek
se ořízne. Test projde celou historii pro 0, 1, 3, 19, 20, 23 a 40 pending při
pageSize 20 a 47 confirmed položkách; každý očekávaný nonce se objeví právě jednou
a sedí `last` i `totalElements`.

**B4 – GE poplatky ze všech tokenů.** Pro balance se načítají outgoing pending podle
`fromAddresses`, bez token filtru. I při dotazu pouze na GE se tedy odečtou poplatky
custom token převodů. Test kontroluje výsledek 93 pro total 100 a custom-token fee 7
i skutečné tělo odchozího node HTTP dotazu.

**B5 – proxy důvěra.** `server.tomcat.remoteip.internal-proxies` je ve výchozím stavu
prázdný; klientské forwarded headers se ignorují. Důvěru může provozovatel zapnout
jen přes `TRUSTED_PROXY_REGEX` pro konkrétní proxy a síťové omezení přímého přístupu.
Test se skutečným Tomcatem posílá dvě různé podvržené XFF adresy přes HTTP a v obou
případech server vidí skutečné `127.0.0.1`. IP testovací endpoint je pouze v
`src/test/java`, není součástí produkčního API/JARu.

**B6 – transport a retry.** Node má nastavitelné, validované connect/read timeouty,
default 2s/3s. Read-only operace mají nejvýše tři pokusy, mezi nimi 250ms. Signed tx
submit se **automaticky neopakuje**, protože ztracená odpověď neznamená nepřijetí tx.
HTTP504 jasně upozorňuje na možnost již přijaté transakce.

Reálný stalled-body test objevil důležitý rozdíl: Spring sice zavřel stream včas,
ale chyba při JSON čtení se změnila na obecný `RestClientException`, takže by vzniklo
HTTP500 a retry by nerozpoznalo transportní příčinu. Nový
`NodeResponseBufferingInterceptor` proto dočte odpověď v request execution ještě
před deserializací. Timeout tak zůstane `ResourceAccessException`; buffer má pevný
limit 16 MiB, aby se neotevřelo neomezené načítání. Body limit se netýká servletového
incoming payloadu a nenahrazuje ingress request-body limity.

Test s opožděnými hlavičkami ověřuje deadline a přesně tři read pokusy. Druhý server
pošle hlavičky hned a tělo zdrží 1500ms; při read timeout 250ms test dostává HTTP504
před uplynutím 1s a ověřuje právě jeden submit request. Background subscription
už nesedí na synchronním `ApplicationReadyEvent`; scheduler začne samostatně po
1s a nemůže zadržet startup čekáním na node.

**B7 – FK forward migration.** Nový changeset
`002-device-account-cascade.yaml` mění FK `user_account.device_id` na
`ON DELETE CASCADE`. Původní initial changeset zůstal nezměněný. Samostatná schema
`legacy_upgrade` v testu nejdřív aplikuje jen původních 30 changesets, vytvoří device
a child account a prokáže původní FK violation. Následně aplikuje master changelog:
account zůstane zachovaný a delete zařízení jej již správně odstraní. Další test
spouští skutečný cleanup service a ověřuje odstranění zombie účtů/orphan adres při
zachování aktivního zařízení a sdílené adresy.

**B8 – webhook konfigurace.** `webhookUid` má typ UUID a `@NotNull`. Neplatné ID i
doslovný nevyřešený `${...}` placeholder padnou už při configuration binding.
README obsahuje povinné ID, postup vytvoření/enabling webhooku a správný původ jeho
signing secretu. Zároveň se již neloguje správně vypočtený HMAC při neplatném podpisu;
šlo o doplňující bezpečnostní pozorování původního review.

**F11 – PostgreSQL 18 deployment.** README používá `postgres:18.6-alpine` a parent
mount `/var/lib/postgresql`. Jasně rozlišuje novou prázdnou instalaci od existujících
dat a požaduje backup/ověření verze/layoutu a explicitní migrační postup. Žádná
existující host data nebyla přesouvána ani mazána. Testovací PostgreSQL skutečně
startuje s mountem tohoto parent adresáře a SQL ověřuje datový adresář uvnitř
`/var/lib/postgresql/18/`. Compose wallet port byl současně sjednocen s `LISTEN_PORT`
a navázán na loopback pro bezpečné použití s HTTPS proxy.

## Mapa nález → soubory → regression test → výsledek

Všechny uvedené testy jsou v
`src/test/java/global/goldenera/wallet/BackendCompatibilityTest.java`.

| ID | Hlavní změněné soubory | Test | Výsledek |
|---|---|---|---|
| B1 | node-openapi/v1.json; WalletBalanceDtoV1; WalletMapper; WalletBusinessService | `v2BalancesKeepLockedRewardsOutOfAvailableFundsAndV1StillWorks` | PASS |
| B2 | WalletBusinessService; PaginationUtil; ThrottlingService; WalletApiV1 | `invalidWalletFiltersAndPaginationNeverReachTheNode`; `excessiveNodeResultsAndPageWorkAreBoundedInsteadOfScanningTheChain` | PASS |
| B3 | WalletBusinessService | `allHistoryRowsAppearExactlyOnceAcrossPendingConfirmedBoundaries` | PASS |
| B4 | ExplorerNodeService; WalletBusinessService | `nativeBalanceReservesFeesFromOtherTokensEvenWithNativeOnlyFilter` | PASS |
| B5 | application.properties; README | `nativeTomcatIgnoresForgedForwardedAddressesWithoutAnExplicitTrustedProxy` | PASS, skutečné HTTP/Tomcat |
| B6 | NodeProperties; NodeClientConfig; NodeResponseBufferingInterceptor; node services; ExceptionHandlerConfig; SubscriptionSyncService | `stalledNodeHeadersHitTheDeadlineAndReadRetryBudget`; `stalledResponseBodyTimesOutAndSignedSubmissionIsNeverAutomaticallyRetried` | PASS, skutečné stalled HTTP |
| B7 | 002-device-account-cascade.yaml; db.changelog-master.yaml | `forwardMigrationUpgradesTheExistingRestrictiveForeignKeyWithoutLosingAccounts`; `cleanupDeletesZombieAccountsAndOnlyTheirOrphanAddresses` | PASS, PostgreSQL |
| B8 | NodeProperties; WebhookNodeService; README | `invalidOrUnresolvedWebhookUuidIsRejectedDuringConfigurationBinding` | PASS |
| F11 | README; test PostgreSQL mount | `migrationsRunOnPostgresqlAndCanRunAgain` včetně `show data_directory` | PASS, PostgreSQL18.6 parent mount |

Původních 12 kompatibilitních testů zůstalo v sadě: PostgreSQL repositories/upsert,
migrace/replay, přesné JSON stringy a ISO Instant, tři veřejné cross-language tx
vectors, skutečný HTTP forwarding, error sanitizace, raw HMAC/tampering/expiry,
CORS/admin hranice a stabilní API paths/operationIds.

## Přesně provedené kontroly a hranice tvrzení

Finální dosavadní regresní příkaz:

```bash
mise exec java@openjdk-21.0.2 -- ./mvnw -o -Dlicense.skipCheckLicense=true test
```

Výsledek: **BUILD SUCCESS; tests run 23, failures 0, errors 0, skipped 0**,
přibližně 34s včetně compile a disposable PostgreSQL/Tomcat startupu. JDK 21.0.2 je
lokální již nainstalovaný compatibility tool; není doporučovaným produkčním patchem.
Log posledního běhu: `/tmp/wallet-phase2-tests.log`. Předchozí červený stalled-body
test nebyl přeskočen ani oslaben; vedl k opravě transportní vrstvy.

V okamžiku tohoto původního checkpointu ještě nebylo ověřeno (následně uzavřeno ve finálním artifact reportu):

- finální `package` s posledním produkčním PWA static buildem ani ověření jeho JAR obsahu;
- finální fullstack browser checkpoint nad touto phase2 verzí;
- deploy či upgrade kopie produkčních dat;
- libovolný výkonový/security audit celé infrastruktury nebo atomic snapshot mezi
  blockchain balance a mempool paginací (upstream data se mohou mezi requesty měnit).

Finální license goal proběhne až po dokončení source editů a QA podle pokynu root
koordinátora. Žádný commit, deploy ani přepis vydaného CryptoJ artifactu nebyl proveden.

## Doplnění nezávislého QA: neúplné upstream stránky

Final QA nezávisle potvrdilo další B2 variantu od frontend review: neprázdná stránka
50 řádků při deklarovaném total100/pageSize100 se vracela jako úspěšný výsledek.
Nové testy nejprve oba reprodukovaly HTTP200 místo očekávaného fail-closed500.
WalletBusinessService nyní ověřuje přesný počet řádků podle offset/total před
mapováním balance i agregací pending rezervací. Legitimní krátká poslední stránka
je nadále akceptovaná. Patch následně nezávisle přečetl frontend reviewer.

Finální dosavadní suite tak obsahuje **25 skutečných PostgreSQL/Tomcat testů PASS,
0 failures,0 errors,0 skipped**. Nové případy:
`nonEmptyTruncatedBalancePagesFailClosed`, `nonEmptyTruncatedPendingPagesFailClosed`.
Log `/tmp/wallet-final-qa-backend-tests.log`,34.5s, JDK21. Finální package/statics/license
checkpoint nadále čeká na jeho samostatné skutečné dokončení. Podrobnosti v
[nezávislém QA](implementation-final-qa.md).

## Poslední QA doplnění: encoded API aliasy

Skutečný Tomcat akceptoval /%61pi/core/v1/wallet/balances bez odečtu public bucketu
a /api/core/v1/wallet/%62alances s cenou1 místo10. Oba bezpečné syntetické red
scénáře následně přijaly druhý request200 místo429. ThrottlingFilter/Service nyní
shodně používají Spring RequestPath + dekódované PathSegment.valueToMatch pro
API prefix i endpoint cenu, bez form-plus dekódování. Malformed parse vrací400.
Trvalá regrese encodedBalanceAliasesCannotBypassThePublicBucketOrEndpointCost
ověřuje canonical/oba aliasy, přesné tokeny,429 a context/plus sémantiku.

Dosavadní finální běh po všech těchto opravách: **26 testů PASS,0 failures/errors/skipped,
BUILD SUCCESS**,34.4s, skutečné Java21/PostgreSQL18.6/Tomcat. Log:
/tmp/wallet-final-qa-backend-final-tests.log. Předchozích23/25 jsou historické mezikroky.
Package/statics/license a finální fullstack jsou stále oddělené následující checkpointy.
