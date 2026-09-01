# GoldenEra Wallet — review bezpečnosti klíčů a lifecycle

**Aktivní scope: PWA. Všech sedm nálezů se týká sdíleného kódu používaného PWA; multi-context scénář lze reprodukovat dvěma webovými taby. Nativní příklady v textu jsou pouze další možný výskyt, nikoli podmínka aktivního scope.**

Rozsah: `frontend/packages/core/src/store/WalletStore.ts`, Crypto/Wallet/Biometric/Privacy utility, storage/biometric/device služby, auth komponenty, create/import/backup/show/delete/lock flow, synchronizace více instancí a auto-lock routeru. Read-only review; v repozitáři nebylo nic měněno.

Reprodukce: `/tmp/goldenera-wallet-security-repro.mjs`. Spuštěno sedm kontrol, všech sedm PASS. Skript načítá přímo aktuální TS implementace a používá skutečný Zustand 5.0.10 ze frozen instalace v `/tmp/goldenera-wallet-review/frontend`, skutečný WebCrypto pro šifrování a in-memory náhrady úložiště/platformních pluginů/síťové registrace. WalletUtil je v lifecycle kontrolách nahrazen syntetickými identitami; žádné reálné klíče ani uživatelská data se nečtou. Auto-lock kontrola používá deterministický suspendovaný scheduler, nikoli měření na fyzickém zařízení. PWA může mít JS timery při suspendování prohlížeče pozastavené; při návratu je zásadní ověřit skutečný uplynulý čas.

Spuštění:

```sh
/home/andrej/.local/share/mise/installs/node/24.19.0/bin/node --disable-warning=ExperimentalWarning /tmp/goldenera-wallet-security-repro.mjs
```

## S1 — [P1] Webová biometrie umožňuje offline získání hesla z uložených dat

- Primární místo: [BiometricService.ts](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/services/BiometricService.ts), řádky 197–203; doplňující 211–213 a 258–277.
- Webové `enable()` šifruje heslo klíčem odvozeným pouze z `credential.rawId`. Tentýž identifikátor ukládá do BasicStorage vedle IV a ciphertextu hesla. Ani derivace klíče, ani dešifrování nepotřebují privátní klíč autentikátoru, odpověď WebAuthn nebo uživatelovu biometrii.
- Reprodukce: aktivovat webovou biometrii, zkopírovat tři uložené hodnoty (credential ID, IV, ciphertext) a stejným PBKDF2/AES-GCM postupem offline získat heslo. S tímto heslem lze dešifrovat i uložený mnemonic. Skript obnovil náhodné syntetické heslo bez jediného `navigator.credentials.get()`; žádné hádání hesla není třeba.
- Dopad: kopie browser storage profilu/backup či jiné read-only získání těchto dat obejde heslovou ochranu celé peněženky. Zvýšení počtu PBKDF2 iterací problém neřeší.
- Náprava: přestat používat veřejné credential ID jako tajný klíč; použít autentikátorem vydané tajemství WebAuthn PRF a bezpečný fallback pouze na heslo na nepodporovaných zařízeních. Stará biometrická data odstranit/migrovat po skutečném ověření hesla. PRF je určeno také pro klientské odvozování šifrovacích klíčů: [W3C WebAuthn Level 3, PRF](https://www.w3.org/TR/webauthn-3/#prf-extension).
- Jistota: potvrzeno skutečnými kryptografickými operacemi nad implementací.

## S2 — [P1] Chyba načtení úložiště otevře onboarding, který přepíše existující wallet

- Primární místo: [StorageService.ts](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/services/StorageService.ts), řádky 66–73.
- Doplňující místo: [WalletStore.ts](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/store/WalletStore.ts), řádky 85–90, 104–106 a 152–154.
- `exists()` nerozlišuje prázdné úložiště od selhání `SecureStoragePlugin.keys()`. V obou případech vrátí false. Navíc i obecný catch `initialize()` nastaví `no_wallet`. WelcomePage pak ukáže Create/Import, přestože seed může být dál uložen. Obě akce bez kontroly předchozího záznamu zapisují pevný klíč `ge_secure:mnemonic`.
- Reprodukce: existující seed, jednorázové odmítnutí `keys()` při inicializaci, poté opět funkční storage. Stav je `no_wallet`; kliknutí Create zapíše jiný seed přes původní. Skript potvrzuje přepsání existujícího záznamu.
- Dopad: ztráta původní lokální peněženky; bez správné externí zálohy ztráta přístupu k prostředkům. Zvlášť relevantní je přechodná nedostupnost keychainu/pluginu.
- Náprava: chyby storage propagovat do blokujícího error/retry stavu; povolit onboarding jen po úspěšném potvrzení neexistence wallet. Před create/import také zabránit neautorizovanému overwrite existujícího záznamu.
- Jistota: potvrzeno simulací jednorázového selhání platformního API; skutečné zařízení při výpadku pluginu nebylo testováno.

## S3 — [P2] Mazání úložiště potlačí chybu a hlásí odstraněnou peněženku se seedem stále na zařízení

- Primární místo: [StorageService.ts](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/services/StorageService.ts), řádky 89–93.
- Doplňující místo: [WalletStore.ts](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/store/WalletStore.ts), řádky 251–269; `DeleteWalletPage.tsx` řádky 49–60.
- `clear()` spolkne i selhání mazání mnemonicu. `resetWallet()` tak normálně pokračuje, smaže basic data/biometrii a přepne na `no_wallet`. UI přitom slibuje trvalé odstranění všech wallet dat ze zařízení.
- Reprodukce: při potvrzeném Delete Wallet nechat `SecureStoragePlugin.remove()` odmítnout. Výsledný stav je `no_wallet`, přesto `ge_secure:mnemonic` stále existuje; po restartu se wallet znovu nabídne k odemčení. Skript ověřuje obě podmínky.
- Náprava: propagovat chybu mazání, potvrdit odstranění kritického záznamu a nepřepínat do úspěšného `no_wallet`, dokud mazání nedoběhlo. `resetWallet()` musí chybu předat i volajícímu formuláři, ne pouze zapisovat neviditelné `error`.
- Jistota: potvrzeno fault-injection nad storage implementací.

## S4 — [P2] Druhá otevřená instance může vyměnit seed, zatímco první dál používá starý privátní klíč

- Primární místo: [WalletStore.ts](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/store/WalletStore.ts), řádky 187–193 (`checkPassword` čte aktuální sdílený vault), případně 251–269 pro chybějící invalidaci dalších instancí.
- Doplňující místa: `WalletStore.ts` řádky 164–168 a 278; [ShowPhrasePage.tsx](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/pages/ShowPhrasePage.tsx), řádek 98; oba extension entrypointy `frontend/apps/extension/src/popup/main.tsx` a `frontend/apps/extension/src/sidepanel/main.tsx` vytvářejí vlastní app/store.
- Všechny kontexty sdílejí stejný persistovaný mnemonic, ale každý má vlastní Zustand `_privateKey`/address. Kód neodebírá `storage` události, BroadcastChannel ani jinou wallet-revision invalidaci. `checkPassword()` současně neověřuje, zda načtený mnemonic patří k aktuálnímu address v dané instanci.
- Reprodukce: otevřít wallet A ve dvou tabech; v druhém ji smazat a importovat B. První tab zůstane unlocked s klíčem a address A. V jeho View Recovery Phrase projde heslo B a zobrazí seed B. Po lokálním odstranění wallet A je tedy stále možné podepisovat jejím klíčem v druhé instanci. Skript ověřuje mismatch klíče A a načteného seedu B.
- Dopad: uživatel může zálohovat recovery phrase jiné peněženky, než právě prohlíží, a očekávané smazání/uzamčení nemá účinek na ostatní otevřená okna.
- Náprava: společná identita/revize wallet a propagace create/import/reset/lock mezi kontexty. Při změně vaultu okamžitě zneplatnit ostatní `_privateKey`, session i citlivé UI; před vrácením seedu kontrolovat identitu aktivní wallet. Zvážit centralizovanou správu klíče pro extension.
- Jistota: potvrzeno dvěma skutečnými Zustand store instancemi a společným storage; browser/extension UI nebylo automatizováno.

## S5 — [P2] Rozpracované odemknutí po ručním zamčení znovu vloží privátní klíč do store

- Primární místo: [WalletStore.ts](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/store/WalletStore.ts), řádky 213–218.
- Doplňující místo: [UnlockCard.tsx](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/components/auth/UnlockCard.tsx), řádky 110–116 a 125–129.
- Formulář používá `formState.isLoading`, nikoli `isSubmitting`, takže během submitu lze opakovaně odemknout. Každé volání čeká na vlastní `DeviceService.register()`. `unlockWallet()` po await nijak nekontroluje platnost původní operace nebo pozdější lock/reset.
- Reprodukce: zadat správné heslo a rychle dvakrát stisknout Unlock; první síťová registrace doběhne, wallet se odemkne. Uživatel ji ručně zamkne, ale druhá registrace doběhne později a dokončení druhého `unlockWallet()` znovu nastaví `unlocked` a `_privateKey`. Ve skriptu dvě řízené Promise tento průběh potvrzují.
- Náprava: zakázat souběžné autentizační submit operace pomocí `isSubmitting`/sdíleného pending guardu a zejména zneplatnit in-flight auth přes session/operation generation při každém lock/reset. Dokončení async operace nesmí obnovit později zrušenou session.
- Jistota: potvrzeno řízeným interleavingem dvou unlock operací nad skutečným Zustand store.

## S6 — [P2] Návrat po suspendování vynuluje již vypršelý auto-lock

- Primární místo: [stackflow.tsx](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/router/stackflow.tsx), řádky 325–329.
- Auto-lock existuje pouze jako JS timeout; aplikace neuchovává absolutní čas poslední aktivity nebo zamčení. Při `visibilitychange` na visible bezpodmínečně volá `resetTimer()`, který zruší původní timer a přidělí nové dvě minuty.
- Reprodukce: odemknout wallet, suspendovat WebView/tab na deset minut a při návratu doručit visibility event před callbackem suspendovaného timeoutu. Vypršelý lock je zrušen a wallet zůstane unlocked další dvě minuty. Deterministický scheduler v reprodukci ověřuje, že lock nebyl zavolán a nový deadline je `resume + 120000`.
- Náprava: uchovávat deadline/lastActivity a při resume synchronně porovnat reálný čas; při překročení zamknout před vykreslením citlivého obsahu. Obsloužit i native App lifecycle. Resetovat deadline pouze po platné aktivitě v ještě neexpirované session.
- Jistota: potvrzena chyba ve zpracování suspend/resume pořadí; konkrétní pořadí nativních eventů na zařízení nebylo měřeno.

## S7 — [P2] Nepovinná síťová registrace blokuje lokální odemčení a první zálohu

- Primární místo: [WalletStore.ts](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/store/WalletStore.ts), řádky 208–211.
- Doplňující místa: stejný soubor řádky 113–118 a 161–166; [DeviceService.ts](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/core/src/services/DeviceService.ts), řádky 42–47; [client.ts](/home/andrej/Projects/goldenera/goldenera-wallet/frontend/packages/api/src/client.ts), řádky 3–8.
- Create/import/unlock awaitují registraci zařízení ještě před nastavením použitelného lokálního stavu. Axios instance ani register call nemají timeout. Catch v DeviceService zabrání výpadku jen při reject, ne když endpoint drží spojení bez odpovědi.
- Reprodukce: registration request nechat pending. Při Create už je encrypted seed uložen, ale stav je stále `no_wallet`, `_privateKey` je null a uživatel neuvidí recovery phrase. Stejný await blokuje již existující peněženku po správném hesle. Skript zachytí přetrvávající stav po vstupu do nikdy nedokončené registrace.
- Náprava: registraci odpojit od lokálního bezpečnostního flow a spouštět ji na pozadí s timeoutem/retry; chyba nebo pomalost metadata endpointu nesmí bránit přístupu k lokálně uloženému seedu.
- Jistota: potvrzeno řízeným pending requestem; dlouhé blokování nevzniká při okamžitém offline rejectu, ale při neodpovídajícím/velmi pomalém spojení.

## Další ověřené poznámky, nezařazené mezi aktivní chyby

- `unlockWithBiometric()` v `WalletStore.ts:229–237` předává uložené heslo funkci očekávající mnemonic a po false návratu může nechat status loading. Metoda však v projektu nemá call site; reálný UI flow `BiometricUnlock -> UnlockCard -> checkPassword -> unlockWallet(mnemonic)` postupuje správně. Jde o latentní chybu nepoužívaného API, nikoli současně rozbitý biometrický UI unlock.
- `status === 'backup'` je v `stackflow.tsx:391` vynechán z auto-lock a drží mnemonic/privátní klíč neomezeně dlouho. Pravděpodobně záměr pro opisování fráze, proto uvádím jako samostatné bezpečnostní rozhodnutí k potvrzení, nikoli jednoznačnou funkční chybu.
- Požadavek „multiwallet“ není implementován; aplikace má jeden persistovaný mnemonic a index 0. S4 se týká více instancí této jedné wallet, nikoli slibu podpory více účtů.
- Nebylo potvrzeno jiné pochybení v AES-GCM/PBKDF2 šifrování mnemonicu: náhodná 16B sůl, 12B IV, PBKDF2-SHA256 600000 a AES-256-GCM odpovídají implementovanému formátu.
