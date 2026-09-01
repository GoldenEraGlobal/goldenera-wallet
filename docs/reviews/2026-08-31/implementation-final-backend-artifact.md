# Finální backend, JAR a PWA assets

Závěrečné checkpointy jsou dokončené. Lokální spustitelný JAR obsahuje přesně
definitivní PWA build ověřený frontend/security agenty; nebyl proveden commit,
deploy, GitHub release ani push image.

**Artifact:** [goldenera-wallet-0.0.1.jar](/home/andrej/Projects/goldenera/goldenera-wallet/target/goldenera-wallet-0.0.1.jar)

**SHA-256:** `497d946d955fc4591da89fa49cab00e31e6f56e941083a25a052077f072ac118`

## Dokončené kontroly

| Kontrola | Výsledek |
|---|---|
| Frontend unit/integration | 99/99 PASS, 0 skip |
| Produkční Chromium/PWA | 24/24 PASS, včetně skutečného service-worker upgrade |
| Syntetický fullstack PWA→Boot4→PostgreSQL/stub node | 13/13 PASS, 0 skip |
| Skutečný MAINNET read-only browser | 1/1 PASS; backend14GET+20čtecíchPOST, 0 mutací/tx |
| Finální Java21 clean verify | 26/26 PostgreSQL/Tomcat testů PASS, 0 failures/errors/skips |
| License format | 74 Java souborů zpracováno, 1 nová hlavička, 73 již OK |
| License check v clean verify | 74/74 OK, 0 missing/unknown |
| CI Actions | 11 aktuálních stabilních verzí s fullSHA; actionlint1.7.12 a statická nezávislá kontrola PASS |
| Dist / Spring static / JAR | Přesná množina i SHA-256 všech30souborů shodná |
| Skutečné HTTP servírování z java-jar | Všech30souborů HTTP200 a byte-for-byte shoda |
| Úklid vlastních testovacích prostředí | PID, stuby a vlastní kontejnery ukončeny/odstraněny |

Číselné řádky nejsou nezávislé sady k prostému sčítání; například43security testů
a11crypto vectors jsou podmnožinou společných99frontend testů. Původních23backend
testů bylo rozšířeno nezávislým QA o dvě truncation regrese a encoded-route throttling,
takže finální sestava má26.

## Build a licenční krok

Po všech Java úpravách byl jednou úspěšně proveden nakonfigurovaný
`license:format`5.1.2. První offline pokus skončil ještě před formátováním na třech
chybějících veřejných plugin dependencies; po jejich stažení proběhlo vlastní
formátování jednou. Nešlo o npm audit ani upload dependency graphu.

Následoval příkaz bez skip parametrů:

```bash
mise exec java@openjdk-21.0.2 -- ./mvnw -o clean verify
```

Výsledek: **BUILD SUCCESS**,26testů a74licenčních kontrol prošlo. `clean` odstranil
staré target/resources, takže se předchozí hashed PWA chunks nemohly dostat do JARu.
Lokální JDK21.0.2 sloužil pro ověření kompatibility; není doporučením tohoto starého
security patche pro produkci. Běhové knihovny/migrační rozhodnutí jsou v reportu etapy1.

## Přesný PWA artifact

Po definitivním99/24/13 checkpointu byly pomocí `frontend/scripts/sync-static.mjs`
bezpečně synchronizovány generated resources. Skript zálohoval předchozí výstup do
`/tmp`, odstranil jen rozpoznané staré generated assets a ověřil souborovou množinu
i jednotlivé hashe. Strojový manifest: `implementation-final-static-manifest.json`.

PWA tree hash z nezávislého frontend checkpointu:
`ac67115c8ee074694da1896130c7a0c9445c449ac5aecc92017fdab131494abf`.

- index: `b82dfb28a5334c4121e4d8e083affe280727749958b14325ebe56c855ed41a16`
- service worker: `abfcf47ba83db2749222a1837167a8aaf26edd14ba00d51cb3a3254ab618bb46`

`src/test/verify_packaged_pwa.py` porovnává dist/static/BOOT-INF/classes/static,
odmítá stale extras, duplicity a symlinky. Volitelný HTTP režim má pouze localhost
origin, zakazuje redirects a environment proxies a kontroluje origin každé asset URL.
Negativní redirect/origin probe proběhl bez skutečného externího requestu.

Finální JAR byl skutečně spuštěn na127.0.0.1:18085 s novým PostgreSQL18.6 a lokálním
syntetickým node. **Všechny connection údaje byly explicitně přepsané; nový mainnet
`.env` nebyl použit.** Startup subscription tedy směřovala jen do lokálního stubu.
Nad tímto JARem prošel verifier pro všech30HTTP souborů, ne pouze index a ne pouze
Vite preview. Evidence: `implementation-final-artifact.json`.

## Úklid a omezení

`implementation-final-e2e-cleanup.json`, `implementation-mainnet-readonly-cleanup.json`
a `implementation-final-artifact-cleanup.json` potvrzují úklid přesně vlastních
testovacích PID/kontejnerů. Docker automatické `--rm` doběhlo asynchronně; jeho
dokončení bylo následně ověřeno a `cleanupVerified=true`. Starší evidované testovací
PID již neexistovaly; jiné procesy ani kontejnery nebyly zastavovány.

- Nový online npm audit zůstává blokován approval reviewerem. Offline comparison
  starého snapshotu má1high v odložené extension a0critical; nejde o fresh audit clean.
- TypeScript6 a interní Java CryptoJ0.0.1 jsou vědomě držené kompatibilní verze;
  poslední privátní CryptoJ release nebyl prokázán ani přepsán pod stejnou verzí.
- Fyzická biometrie, nejstarší podporované browsery, GitHub-hosted workflow execution,
  reálný multiarch image push a upgrade kopie produkční DB nebyly ověřeny.
- Native/extension jsou mimo aktivní rozsah. Reálná čtecí data měla V1/8decimals;
  V2/0decimals pokrývají syntetické regrese.

Další podklady: [finální CI](implementation-final-ci.md),
[mainnet čtení](implementation-mainnet-readonly.md),
[nezávislé QA](implementation-final-qa.md),
[security implementace](implementation-phase2-security.md).
