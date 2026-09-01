# Etapa 1 – migrace Java backendu

Dokončená migrace běhových knihoven a build nástrojů k 31. 8. 2026. Bez deploye,
bez commitu, bez změn sousedních repozitářů a bez přepisování node OpenAPI smlouvy
nebo přibaleného frontend buildu. Původní nálezy B1–B8 zůstávají pro etapu 2.

## Změny a ověřená sestava

| Oblast | Výsledná verze / rozhodnutí |
|---|---|
| Spring Boot | **4.1.1**, poslední stabilní řada; 4.2.0-M1 nepoužito |
| Spring Framework / Security | BOM Boot 4.1.1; Framework **7.0.9** |
| Jackson | **3.1.5**, skutečný MVC/RestClient JsonMapper a vlastní scalar adaptéry |
| Hibernate ORM / Validator | **7.4.5.Final / 9.1.3.Final**, spravované BOM |
| Hypersistence | **hibernate-73:3.15.5**, odpovídá ORM 7.4 |
| Springdoc | **3.1.0** pro Boot 4 |
| Liquibase core/plugin/Hibernate extension | **5.0.4**, všechny tři sladěné; extension nově **liquibase-hibernate7** |
| PostgreSQL JDBC / Caffeine / Lombok | BOM: **42.7.13 / 3.2.4 / 1.18.46** |
| Tuweni / Web3j / Bouncy Castle | **2.8.0 / 6.0.0 / 1.85.2**; transitivní Tuweni z CryptoJ sjednoceno |
| Spring Retry | **2.0.13**, explicitní stabilní kompatibilní verze; zachovány retry anotace a chování |
| Bucket4j / Micrometer extras | **8.19.0 / 0.3.0** |
| Micrometer | Boot BOM **1.17.1** |
| MapStruct / binding / guava-base | **1.6.3 / 0.2.0 / 33.4.0**, již poslední stabilní verze v inventáři |
| Maven / Wrapper / compiler plugin | **3.9.16 / 3.3.4 / 3.15.0** |
| OpenAPI generator / license plugin | **7.25.0 / 5.1.2** |
| Java | zachován bytecode/runtime baseline **21**; ověřeno i skutečným JDK 21, ne pouze `--release 21` na JDK 25 |
| Testcontainers / test PostgreSQL | **2.0.5** z BOM / **18.6-alpine** |
| Interní CryptoJ | **0.0.1**, dostupný lokální publikovaný artifact; nejnovější privátní GitHub Packages release nebyl prokázán |

Spring Boot 4 vyžadoval modulární starters `webmvc`, `restclient`, `validation`,
`liquibase` a `aspectj`, nový balíček `EntityScan` a kompatibilní test starters.
Předchozí nesladěné override Hibernate Validator, Jackson XML, Caffeine a PostgreSQL
byly nahrazeny BOM správou. Liquibase má vědomý jednotný patch override 5.0.4,
který byl samostatně ověřen i pro Hibernate extension.

Jackson konfigurace používá `tools.jackson` serializer/deserializer API a builder
nového JsonMapperu. Anotace z `com.fasterxml.jackson.annotation` zůstávají správně
ve svém původním balíčku. Zachováno: Wei/BigInteger jako desetinné stringy,
Address checksum/hex formát, Instant ISO stringy, raw-body HMAC, starý veřejný
identifikátor chyby `JsonMappingException`. Generátor vyžaduje jak
`useSpringBoot4=true`, tak **`useJackson3=true`**; bez druhého přepínače by ponechal
staré databind anotace.

Jackson 2.21.5 stále existuje jako BOM spravovaná transitivní závislost Swaggeru
a dalších knihoven. Není to HTTP mapper aplikace; nebyl odstraněn naslepo, protože
tyto knihovny jej stále používají. Samotná přítomnost Jackson 2 v dependency tree
proto neznamená nedokončenou migraci aplikačního JsonMapperu.

Liquibase Hibernate tooling byl vyjmut z produkční runtime dependency sestavy a
ponechán v odděleném Maven plugin realm. Zde byl také nahrazen starý naming strategy
název za `PhysicalNamingStrategySnakeCaseImpl`. Skutečný diff smoke test odhalil
chybějící Jakarta EL v plugin realm; opraveno použitím `spring-boot-starter-validation`
také pro tooling. Výsledek diffu zůstal pouze v `/tmp`, nikdy nebyl aplikován.

CryptoJ veřejnou verzi nebylo možné spolehlivě aktualizovat. Stávající 0.0.1 artifact
nebyl přebuilděn a přepsán pod stejnými souřadnicemi, ani nebyly měněny jeho zdroje.
Kompatibilitu nové externí kryptografické sestavy ověřují tři nezávislé veřejné JS
fixtures: Java dekódování vrací shodné hash, sender, amount a nonce.

## Testy, které skutečně proběhly

1. `mise exec -- ./mvnw -o -DskipTests -Dlicense.skipCheckLicense=true compile`
   po migraci: **PASS**, 188 produkčních/vygenerovaných Java tříd.
2. `mise exec -- ./mvnw -nsu -Dlicense.skipCheckLicense=true test`:
   **12 testů, 0 failures, 0 errors, 0 skipped**. Testy běžely proti skutečnému
   PostgreSQL 18.6 v Testcontainers, nikoliv proti H2.
3. `mise exec java@openjdk-21.0.2 -- ./mvnw -nsu -Dlicense.skipCheckLicense=true package`:
   **PASS**, stejných 12 testů zelených na skutečném Java 21; vznikl Boot 4 executable JAR.
   Lokální OpenJDK 21.0.2 je pouze již nainstalovaný nástroj pro kontrolu kompatibility,
   nikoliv doporučení tohoto starého security patche pro produkční deployment.
4. Maven `dependency:tree` a `dependency:build-classpath`: **PASS**, ověřena vyřešená
   sestava a skutečné hlavní verze Tuweni/Web3j/Jackson/Hibernate.
5. Maven Wrapper regenerován oficiálním `maven-wrapper-plugin:3.3.4:wrapper`
   pro Maven 3.9.16, `only-script`: **PASS**.
6. `liquibase:diff` s kopií POM, která mění pouze výstup na
   `/tmp/wallet-phase1-hibernate7-diff.yaml` a používá izolovanou H2: **PASS**.
   Ověřuje Hibernate7 extension/metadatové skenování, nenahrazuje PostgreSQL runtime test.
7. Test-only `E2eBackend` byl spuštěn na **127.0.0.1:18084** přes skutečný Java21,
   Boot4 a nový dočasný PostgreSQL18.6; lokální node stub poskytuje výhradně
   syntetická data a nikdy nic nebroadcastuje. Předán testleadovi pro PWA fullstack E2E;
   výsledky browser testů jsou vykazovány jeho samostatným reportem.

`BackendCompatibilityTest` zahrnuje: aplikaci všech 30 původních Liquibase changesets,
opakovaný migration běh beze změn, Hibernate schema validation, Hypersistence
repository/entity a Address converter round-trip, PostgreSQL device upsert,
skutečný MockMvc → RestClient → HTTP node průchod, přesné decimal/Instant JSON,
nezměněné předání signed tx bytes, sanitizovanou odpověď na node HTTP503,
HMAC nad původními raw bytes, odmítnutí změněného/expirujícího webhooku, podepsané
nevalidní JSON, public CORS a chráněnou admin hranici.

## OpenAPI a wire kontrakt

Před změnami byl původní Boot3 server spuštěn v izolované H2 konfiguraci a jeho Core
OpenAPI zachyceno jako `src/test/resources/contracts/wallet-openapi-boot3.json`.
Nová skutečná odpověď je po testu v `target/wallet-openapi-boot4.json`.

Všech **9 paths a operationIds zůstává stejných**. Strukturní diff našel pouze:

- `MempoolResult.status` a `message` mají ve Springdoc 3 správně explicitní nullable
  typ podle existujících Java anotací; skutečné wire hodnoty zůstávají stejné.
- Textový popis HTTP413 je podle nové Spring verze `Content Too Large`.
- URL `servers` odráží pouze rozdílný testovací origin.

Frontend reviewer dostal obě specifikace a seznam rozdílů; nedošlo k neohlášené
změně node v1.json ani API cest.

## Omezení a návazná práce

- Původní B1–B8 a deploy F11 nejsou řešeny tímto migračním krokem. Zejména V2/spendable,
  stránkování, poplatky, IP trust, timeouty a cleanup FK vyžadují etapu 2 a její
  cílené regression testy. Timeout integration regression proto není vydáván za
  hotový: původní klient stále nemá nakonfigurovaný read timeout.
- Nebyla testována kopie produkční DB ani její konkrétní již uložené checksums/data.
  Ověřeny byly fresh PostgreSQL instalace a opakovaný běh stejného changelogu.
- Nebyl proveden deploy, push/commit, publikace CryptoJ nebo kontakt produkčního node.
- Licenční goal je podle dohody odložen na jediné spuštění na konci všech etap.
  Migrační příkazy použily `-Dlicense.skipCheckLicense=true`; existující hlavičky zůstaly.
- Dockerfile/CI/PWA runtime piny spravuje frontend agent po vzájemné koordinaci;
  tento report nepotvrzuje image build/publish.

## Primární podklady

- [Spring Boot 4 migration](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- [Boot 4.1.1 BOM](https://repo.maven.apache.org/maven2/org/springframework/boot/spring-boot-dependencies/4.1.1/spring-boot-dependencies-4.1.1.pom)
- [Jackson 3 migration](https://github.com/FasterXML/jackson/blob/main/jackson3/MIGRATING_TO_JACKSON_3.md)
- [Hypersistence Hibernate73 3.15.5 POM](https://repo.maven.apache.org/maven2/io/hypersistence/hypersistence-utils-hibernate-73/3.15.5/hypersistence-utils-hibernate-73-3.15.5.pom)
- [Liquibase Hibernate7 5.0.4 POM](https://repo.maven.apache.org/maven2/org/liquibase/ext/liquibase-hibernate7/5.0.4/liquibase-hibernate7-5.0.4.pom)
