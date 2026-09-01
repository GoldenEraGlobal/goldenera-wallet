# Etapa 2 — bezpečnost PWA a lifecycle peněženky

Implementovány jsou aktivní nálezy S1–S7. Transakční/UI opravy a Java backend mají vlastní reporty. Nebyl proveden deploy ani commit a nebyly použity skutečné uživatelské vaulty, klíče nebo prostředky. Všechny čtyři původně gated bezpečnostní regrese jsou nyní standardně aktivní, bez skip/todo/expected-failure.

## Opravy a regresní pokrytí

| ID | Oprava | Ověření |
|---|---|---|
| S1 | Běžné webové odemčení přijímá pouze verzovaný PRF/HKDF/AES-GCM wrapper. Credential ID už není tajným vstupem odvození klíče. Envelope je přes AAD svázán s RP, identitou a revizí vaultu. Nepodporované PRF ponechá password-only režim. Starý formát má samostatný migrační postup. | 10 integračních testů se skutečným WebCrypto a výslovně mockovaným autentikátorem: enrollment, dodatečná assertion, fallback, UV/credential, tamper/abort, odmítnutí veřejného ID jako klíče, legacy recovery a chyby persistence. Browser testuje PRF, fallback i úplnou migraci stejného seedu. |
| S2 | Storage chyba není „žádná wallet“. Samostatný error stav nabízí retry a nepovoluje Create/Import. WebLocks serializují read/check/write mezi taby; existující vault nelze přepsat běžným Create/Import. | Unit i browser fault injection při enumeraci úložiště, kontrola přepsání, selhání zápisu a záměny identity. |
| S3 | Autoritativní encrypted seed, identita a backup metadata jsou jeden atomicky nahrazovaný záznam s následným čtením zpět. Delete odstraňuje seed poslední a ověřuje jeho absenci; výjimka i silent noop jsou chyby. | Selhání před commitem, commit následovaný chybou readback, chyba cleanupu po commitu, ignorované remove a chyba backup metadat. Browser nesmí po neúspěšném mazání hlásit odstraněnou wallet. |
| S4 | Vault ID/revision, BroadcastChannel/storage invalidace a monotónní session revision. Session je navíc svázána se synchronně kontrolovaným storage tokenem. Obnovený seed musí odpovídat očekávané identitě. | Dva skutečné browser taby: lock, delete a import jiné wallet invalidují starou session. Store odmítne vrátit cizí seed pod původní identitou. |
| S5 | Auth single-flight, synchronní UI guard a abort/generation kontroly po await. Transakce používají `getSessionSnapshot`, `isSessionCurrent` a aktuální `getPrivateKey`. | Pozdní unlock po locku neobnoví klíč; zachycený transakční snapshot okamžitě propadne. Navazující frontend testy ověřují preflight, cancel a pozdní POST. |
| S6 | Absolutní deadline ve store se kontroluje také při přístupu ke klíči a snapshotu. Resume/pageshow ji neprodlužují. Stejně je chráněn backup, který drží seed v paměti. | Store fake clock a skutečný browser: posun času bez spuštění timeru, potom visibilitychange. Nezávislý QA navíc odhalil a ověřil opravu expirace nového legacy recovery ticketu. |
| S7 | Create/import/unlock nečekají na registraci zařízení. DeviceService má jeden současný request, 8s timeout a 5min cache úspěchu; neúspěch se zopakuje při další session. | Nikdy nedokončená registrace neblokuje lokální unlock. Produkční offline E2E používá skutečné selhání API požadavků. |

## Vault a selhání persistence

Historický v1 ciphertext se dál dešifruje původním algoritmem; derivace klíče a adresy se nezměnila. `WalletVaultService` vytváří stabilní legacy identitu z hashe ciphertextu, nikoli seedu. Nový záznam pod dosavadním storage key obsahuje encryptedMnemonic a veřejná metadata identity, revize a backupu. Plaintext seed ani heslo se nepersistují.

Webová mutace vyžaduje WebLocks. Pokud browser tuto bezpečnou serializaci nepodporuje, aplikace nezavede zranitelný localStorage lease nebo tiché přepsání: čtení/odemčení zůstává možné, změna dostane srozumitelnou chybu. Native/extension runtime není součástí ověření tohoto PWA release.

Vícekrokové odstranění biometrie a preferences není vydáváno za databázovou transakci. Seed se odstraňuje poslední. Částečná chyba může ponechat password-only peněženku nebo částečně vyčištěné preferences; nesmí však oznámit potvrzenou deletion, pokud seed stále existuje. Nejistý výsledek write/readback vede na retry, nikoli na onboarding.

Poslední regresní kontrola navíc prokázala úzkou S4 race: jiný tab může zahájit novou session během probíhající mutace a navázat ji na počáteční invalidaci. Proto create/import, delete a změna hesla publikují další token až po ověřeném commitu. Publisher vrací přesný vlastní token; nová session se neváže na libovolný později načtený cizí token. Jedenáct permanentních scénářů záměrně nedoručuje storage events a ověřuje revokaci session vzniklé uvnitř každé operace: úspěch i selhání před/po commitu, readback a credential cleanup. Také mutační error exit publikuje novou invalidaci; read-only chyby a initialize ji nepublikují, aby nevznikala smyčka mezi taby. Původní deletion reprodukce i nezávislý cleanup-after-commit probe byly RED a po opravě jsou GREEN. Nezávislý QA znovu potvrdil 54/54 security+crypto testů bez přeskočení.

## Migrace staré biometrie

Běžné tlačítko „Use Biometrics“ starý wrapper nepoužívá. Uživatel se známým heslem se přihlásí heslem a po jeho ověření se stará biometrická metadata odstraní. Při zapomenutém hesle samostatné „Recover legacy biometric access“ vyžádá čerstvé ověření starým credential; kontroluje challenge, origin, RP hash a UP/UV flags. Potom ověří původní ciphertext a dovolí zvolit nové heslo pro tentýž seed. Nový persist se ověří dešifrováním před odstraněním starého přístupu a otevřením wallet. PRF lze následně zapnout v Settings.

Migrační oprávnění má soukromý jednorázový ticket a deadline dvě minuty. Lock, reset, nová session, cancel a zavření UI jej revokují. Platnost se kontroluje před/po await, před commitem a před otevřením wallet. Formulář na timeout i resume odstraní citlivý recovery stav a rozepsaná hesla. Původní nezávislý QA probe prokázal, že před touto opravou šel ticket použít po hodině; nyní operace odmítne bez změny ciphertextu. Probe nahradily tři permanentní regrese a samostatný browser test expirace s novým požadavkem na UV.

Když zápis proběhne, ale readback nebo cleanup selže, nové heslo stále zpřístupní stejný seed. UI výslovně žádá nové heslo zachovat a bezpečně zkusit načtení znovu. Jestliže zápis neproběhne, zůstane původní ciphertext i legacy recovery. Ověřeny jsou obě hranice.

Migrace neumí retroaktivně zabezpečit dříve odcizenou kopii seedu/wrapperu. UI toto omezení uvádí; žádný automatický převod prostředků neprovádí.

## Výsledky a omezení

- **43 bezpečnostních integračních testů PASS**, bez přeskočení; navíc **11 crypto compatibility testů PASS** ověřuje čtyři adresy, tři přesné podpisové/wire vektory a dva historické vaulty.
- Nezávislý QA zopakoval původní expiry probe a zkontroloval revokaci, kontroly kolem await i vyčištění UI. Dočasný probe byl odstraněn až po potvrzení; permanentní regrese zůstávají.
- **9 produkčních security browser testů PASS** v definitivním společném běhu 24 scénářů: cross-tab lock, resume, read/delete fault, PRF, fallback, legacy migrace, expiry/fresh UV a delete/import jiné wallet.
- **Skutečný service-worker upgrade PASS:** test na stejném izolovaném originu přepnul předchozí frozen release na aktuální produkční build. Ověřil změnu controlleru, nový index JS asset, byteidentický historický encrypted vault a stejnou adresu po odemčení. Nešlo pouze o reload nebo mock SW API.
- Společná Vitest suite po všech funkčních změnách: **99/99 PASS, 0 skip, 0 unhandled errors**. Definitivní nový produkční build má **24/24 browser testů PASS** a nad stejnými bytes následně **13/13 full-stack testů PASS** s čerstvým Boot4, PostgreSQL a syntetickým node; všude bez přeskočení.

Předchozí release je v `/tmp/goldenera-wallet-review/frontend/apps/web/dist`; výsledky jednotlivých běhů jsou pod `/tmp/goldenera-wallet-validation/`. Testovací skripty jsou v `frontend/tests` a `frontend/e2e`. Produkční browser testy používají nový `apps/web/dist`, nikoli staré commitované Java static assets.

PRF/UV odpovědi jsou v browser testech výslovně mockované; WebCrypto, validace odpovědí, persistence, migrace a UI jsou skutečné. Není tím ověřeno fyzické FaceID/fingerprint, zabezpečení autentikátoru ani jeho zálohování. Camera E2E používá syntetické video zařízení a skutečné MediaStreamTracks s ověřením ukončení. Přijetí transakce lokálním syntetickým node není tvrzením o jejím přijetí produkční sítí.


Definitivní syntetický checkpoint používá nezměněný dist s 30 soubory. Tree SHA-256: `ac67115c8ee074694da1896130c7a0c9445c449ac5aecc92017fdab131494abf`; index SHA-256: `b82dfb28a5334c4121e4d8e083affe280727749958b14325ebe56c855ed41a16`; SW SHA-256: `abfcf47ba83db2749222a1837167a8aaf26edd14ba00d51cb3a3254ab618bb46`. Manifest a JSON výsledky jsou v `/tmp/goldenera-wallet-validation/final-dist-manifest.json`, `final-production-browser-results.json` a `final-fullstack-browser-results.json`.

Následně uživatel samostatně povolil čtecí ověření skutečného MAINNET. Tento nový smoke test je oddělen od syntetických send scénářů: PWA používá pouze veřejnou testovací wallet, browser blokuje submit i další mutace a backend používá přesný allowlist čtecích endpointů. Případné whitelistované bulk POST jsou čtecí dotazy, nikoli transakce. Výsledek živého čtení bude popsán samostatně; žádná nová watch-only funkce ani debug global nebyly přidány do produkční aplikace.


## Dodatečný MAINNET read-only smoke

Po samostatném souhlasu uživatele prošel **1/1 browser smoke test, 0 skip** nad stejným produkčním artefaktem a lokálním backendem s přesným allowlistem čtecích MAINNET operací. PWA zobrazila skutečný token a detail/historii pro veřejnou testovací wallet. Oddělené čtecí dotazy veřejné explorer adresy ověřily jeden balance záznam a stránky historie s počty1/0; prošlo také čtení doporučených fee a očekávané HTTP400 pro prázdné adresy. Dostupný reálný token měl8decimals. Živá data nepotvrzují případ decimals0 ani V2 balance; ty pokrývají samostatné syntetické/integration regrese.

Browser naměřil **0 pokusů o wallet submit, 0 předaných mutačních požadavků a 0 reálných transakcí**. Jediná automatická lokální registrace zařízení byla potlačena přímo v testu a neposlána backendu. Pět browser API čtení i doplňující GET dotazy prošly. Backend může použít ověřené bulk POST jako čistě čtecí dotazy; netvrdíme proto nesprávně, že při MAINNET čtení nebyl žádný HTTP POST. Veškeré transakční/webhook/admin mutace zůstaly zakázané.

Nebyla načtena ani vypsána `.env`/credentials tímto browser testem, nebyl použit privátní klíč veřejné watch adresy a do aplikace nepřibyla watch-only funkce ani debug global. JSON výsledky a necitlivé počty jsou v `/tmp/goldenera-wallet-validation/mainnet-readonly-browser-results.json` a `mainnet-readonly-summary.json`. Read-only launcher a jeho databázi uklízí backend agent. Po testu byl znovu porovnán kompletní30souborový dist proti manifestu: beze změny.


Backend vlastník potvrdil konečné MAINNET guard počty: **14 GET + 20 explicitně čtecích bulk POST na třech ověřených query endpointech; 0 mutací, 0 transakcí, 0 blokovaných pokusů**. Read-only i syntetický launcher a jejich vlastní dočasné kontejnery byly uklizeny; `cleanupComplete=true` je zaznamenáno v `implementation-mainnet-readonly.json` a `implementation-mainnet-readonly-cleanup.json`. Žádná fyzická biometrie nebyla tímto ověřením použita ani prohlášena za otestovanou.
