# Follow-up: TypeScript 7, CryptoJ a zbývající package holds

Datum ověření: 2026-08-31. Žádný commit, deploy ani skutečná transakce. PWA/server live-smoke má samostatného vlastníka a pouze GET guard; tento frontend follow-up `.env` nečetl ani nevypisoval.

## Skutečná architektura TypeScriptu

Uživatel výslovně odstranil původní TypeScript7 hold. Implementována byla přímo oficiálně doporučená paralelní migrace:

| Role | Deklarace | Skutečná verze | Co používá |
|---|---|---|---|
| Produkční typecheck | `@typescript/native: npm:typescript@7.0.2` | **7.0.2 native compiler** | api/core/ui/web a extension app+config |
| Programatické compiler API | `typescript: npm:@typescript/typescript6@6.0.2` | bridge6.0.2 reexportuje **API6.0.3** | typescript-eslint, tsup declaration worker a nástroje vyžadující staré API |
| Kubb TypeScript plugin | vlastní dependency `typescript:^6.0.3` | **6.0.3 API** | deterministické generování modelů/klienta |

`frontend/scripts/typecheck.mjs` explicitně resolvuje `@typescript/native/package.json`, požaduje major7 a spouští právě jeho `bin/tsc`; nepoužívá nejednoznačný PATH shim. Každý workspace typecheck script jde přes tento wrapper. Log dokládá pět native compiler invokací pro4Turbo tasks a verzi7.0.2. `pnpm peers check` nehlásí problém, protože programatické nástroje dostávají kompatibilníAPI6, neunsupportedAPI7.

To není tvrzení, že celý toolchain interně používáAPI7 — TypeScript7.0 programatickéAPI neposkytuje. Produkčnízdroje však skutečně kontroluje7.0.2. Typové kontroly ani lint pravidla nebyly vypnuty. Dvě omezené tsup `ignoreDeprecations:'6.0'` zůstávají jen v jehoDTSworkeru, který sám injektuje legacybaseUrl; aplikačnínativeTS7 config tuto výjimku nemá.

Primárnízdroj: [Microsoft TypeScript7 – side-by-side migration](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-60).

## Zbývající aktualizace

- `@goldenera/cryptoj` JS registry latest je stále **0.4.1**; předchozí update už tuto verzi používal. Follow-up tedy neměnil jejíruntimeAPI ani protokol. JavaCryptoJ má samostatného vlastníka/report.
- Kubb meta/core/adapter byly aktualizovány na**5.0.5**; plugin-ts zůstává latest5.0.0, React Query5.0.1 a Axios5.1.1. Regenerace53API souborů po patchi měla **nulový hash diff**.
- Extension: CRXJS2.7.1, Vite8.2.2, Reactplugin6.1.1 a `@rolldown/plugin-babel`0.2.3 s `reactCompilerPreset`; starábabeloption odstraněna. NativeTS7 app/config typecheck prošel a novýZIP build prošel. Neprovádělo se produktovérozšíření ani runtimepublikace extension. Známý Rollup2.79.2 byl nahrazen podporovaným2.80.0, který obsahuje opravu původníhoadvisory; CRX stále tuto kompatibilní2.x větev používá, nebyl použit forceoverride na Rollup4.
- Capacitor android/ios/CLI byly srovnány na8.5.0 a pluginy nalatestkompatibilní8.x/3.x verze. `cap sync android` i`cap sync ios` prošly a odstranily staré `.pnpm/...8.0.1` cesty. iOS upozornil na nepřítomné CocoaPods/Xcode; Podfile je8.5, ale plnýiOS nativebuild/lock update není naLinuxutvrzen. Android offlineGradle dosáhl konfigurace novýchpluginů, ale build nemohl dokončit: globálníJDK25 jeproGradle8.14nepodporovaný; po správnémmiseJDK21 chybělvofflinecacheKotlinplugin2.2.20 a zde nakonfigurovanéSDK path není dostupné. SDK/Xcode instalace je většíplatformnípředpoklad, ne automatickyprovedenáproduktovámigrace.
- Pnpm11.24.0 zůstáváaktuálnílatesttag. `@types/node` zůstává latest24.x24.13.3, protože runtime/CI/Docker jsouNode24.20LTS; globální types26 nejsou vhodnýAPIcontract pro deployedNode24.
- Fresh offline OSV kontrola přesných lockverzí upozornila ještě na dvě transitivní větve. Byly opraveny úzce cílenými pnpm overrides, ne globálním force rozvolněním:
  - exact `esbuild@0.27.7` byl nahrazen `0.28.2` kvůli [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr). Opravenou verzi skutečně použily tsup buildy API/UI/core, Kubb generátor i Vite buildy; deklarace, 53 generovaných souborů a produkční PWA zůstaly deterministické.
  - pouze `xcode@3.0.1>uuid` byl posunut z `7.0.3` na `11.1.1` kvůli [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Aplikační přímé `uuid@14` se nemění. Xcode používá CommonJS `require('uuid').v4`; tento kontrakt, parse skutečného `project.pbxproj`, generování 24hex ID i `cap sync ios` prošly.

Po overrides už lockfile neobsahuje package snapshots `esbuild@0.27.7` ani `uuid@7.0.3`. Nezávislý rematch finálního1200-package lock graphu proti fresh úplnému npm OSV dumpu skončil **0 findings**. Je to offline kontrola veřejného OSV datasetu, nikoli online `npm audit` ani záruka pro privátní či v datasetu dosud nezveřejněné problémy; audit POST tento agent neopakoval.

Úplný registry GET snapshot95manifestových balíčků je `/tmp/wallet-followup-latest-packages.json`; selhání0. AuditPOST nebylopakován, jakvýslovněpožadovalkoordinátor. Offline porovnání předchozího autorizovaného180GHSA snapshotu proti novémulocku našlo **0remaining**, ale neníto novýonlineaudit ani tvrzeníauditclean.

## Backwards compatibility a browser hranice

TypeScript7 je zde pouze `noEmit` checker. PWAJavaScript/CSS stálegenerujeVite/Oxc/Tailwind. NovýTS7PWA dist byl porovnán byte-for-byte s předchozím opravenýmTS6dist: **30/30souborů,0diff**, včetněserviceworkeru. Po bezpečnostních overrides byl výsledek zopakován: `/tmp/wallet-ts7-security-overrides-dist-compatibility.json` opět uvádí30/30souborů a0diff; současné Springstatic resources také30/30 odpovídajíbajtově.

Tato identita znamená, že samotnýTS7/Kubbtooling follow-up neměníwalletstorage, passwordKDF, vaultformat, seedderivaci, adresu ani podpisovébytes. Hardacceptance se přestonemusí odvozovat jen zhashů: testlead opakujeold-v1/v2/PRFupgrade a CryptoJgoldenvectors z předchozího buildu do nového. **Forwardupgrade nastejnémoriginu nesmí vyžadovatrecreatewallet/importfráze.** Není slibován downgrade nového v2/PRFvaultu do staré aplikace.

JSbuild target zůstáváChrome107/Edge107/Firefox104/Safari16; TS7 jej nezvýšil. ReálnýCSS floor je ale přísnější: Tailwind4 užodv4.0 uvádíChrome111/Safari16.4/Firefox128 a původnírepo užpoužívaloTailwind4.1.18. Proto není tvrzenapodporaSafari16.0 jenpodleVite targetu ani neotestovanéstaréSafari podleChromiumtestu. Primárnízdroj: [Tailwind browser support](https://tailwindcss.com/docs/compatibility#browser-support).

## Ověření před nezávisloumatricí

- `pnpm install --frozen-lockfile`: PASS;1055instalovaných packages v aktuálním deduplikovaném graphu.
- TS7versionwrapper: `Production typecheck: TypeScript7.0.2`, `Version7.0.2`.
- Root typecheck:4/4PASS bezTurbo cache; extension app+node configPASS.
- Rootbuild:4/4PASS, PWA33precacheentries; extensionVite/ZIPbuild a extensionTS7 typecheckPASS i po esbuild/uuid overrides.
- Kubb5.0.5 generate:PASS, generatedhashdiff[]; lint0errors/9původníchwarnings.
- Vitest:9files,**101/101PASS**.
- PWA asset CLI: Sharp0.35.4/libvips8.18.6, všech6PNG/ICO výstupů decode/dimensionsPASS.
- PWA static check:30files exactmatch.
- HelperHTTPguard follow-up: cleanlocalhostoriginsaccepted; credentials/path/query/fragment i301/302/303/307/308 redirectpurehandler odmítnuty, beznetworkrequestu.

## Nezávislý compatibility sign-off

Testlead nad finálním kandidátem potvrdil:

- skutečný native `tsc`7.0.2 ve třech nezávisle kontrolovaných workspace cestách;
-101/101Vitest;
- původní CryptoJ goldeny:4adresy,3přesné wire podpisy/hash a2legacyvaulty včetně wrong-password/tamper rejection;
- forward-upgrade browser matici6/6: originalv1/password, původní skutečnýlegacyWebAuthn→výslovná migrace, předchozív2/password, v2+skutečnýPRF, nové realPRF a browserfallback;
- skutečný Chromium CDP/CTAP2 PRF2/2 a TS6→TS7 runtime byte-identitu30/30;
- fresh offline npmOSV rematch1200lockpackages:0findings.

Podrobná provenance a omezení jsou v `implementation-followup-validation.md`. Test virtuálního autentikátoru nenahrazuje fyzický fingerprint/FaceID/passkey device test a Chromium výsledek se nevydává za Safari/Firefox pokrytí. Backend vlastník musí znovu použít tento finaldist, ověřit statics exacthash a zabalit novýJAR sJavaCryptoJ0.0.5; předchozíJAR neníautomatickyfinální jenproto, že PWA bytes zůstaly shodné.
