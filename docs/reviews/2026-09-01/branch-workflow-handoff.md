# Branch a GitHub workflow handoff

Datum:2026-09-01. Tato etapa pouze připravila lokálníGit branch aworkflow konfiguraci. Nebyl proveden commit,push,GitHubrun,release,cachepurge,registrylogin,imagebuild/imagepush ani deploy. Nebyl spuštěn bezpečnostníaudit/CVEscan a `.env` nebyl čten.

## Git audit a branch

- Výchozí branch:`main`.
- Výchozí a současnýHEAD:`d2dc2830dd2618c138eff209df1abd1be190537a` (`feat: cosmetics`). HEAD se během celého review/implementace nezměnil; před touto etapou tedy žádnýagent nic necommitnul.
- `feature/updates` před změnou neexistovala lokálně. Byla vytvořena přesně jako noválokálníbranch ztéhožHEAD a celýworkingtree zůstal zachovaný.
- Aktuální branch:`feature/updates`.
- Před branchem bylo399statusentries:54deleted,162modified,183untracked. Jde o společný výsledek celé autorizované implementace, testů, reportů,generatedAPI/static aworkflow změn; nebyl provedenreset,checkout souborů,stash ani clean.
- `.env` je ignorovaný pravidlem`*.env`; `frontend/node_modules` pravidlem`node_modules/` a`target` pravidlem`target/`. Porcelainstatus neobsahoval`.env`,node_modules,target,Playwrightreport/test-results ani log soubory. Obsah`.env` nebyl čten.
- Finálnícommitprecheck našel trackedgenerated`frontend/apps/web/dev-dist/sw.js` a novýgeneratedWorkbox chunk. `apps/web/dev-dist/` je nyní ignorovaný a původníSW je odstraněn pouze zGitindexu; oba fyzickédev soubory zůstaly lokálně. Release static tree pod`src/main/resources/static` naopak zůstává záměrněversionovaný a30/30 odpovídáQA manifestu.
- Nic není stageované a commit zůstává záměrněodložený do samostatného`COMMIT_GO` poQA.

## Nová workflow struktura

Aktivní `.github/workflows/build-and-release.yml` nyní reaguje na:

- push všechbranches přes`branches: ["**"]`;
- version tags`v*`;
- žádnýpull_request trigger nebyl přidán.

Concurrency je oddělená podleplnéhoGitref; novébranchpush zruší starší běh stejnéref,versiontag běhy se neruší.

Workflow má čtyři oddělenéjoby:

1. `build`: vždy na každémbranch/tag push. ZachováváNode/pnpm/type/lint/unit/assets/PWA browser/build/static sync,Java25cleanverify a30assetJAR verifier. Má pouze`contents:read,packages:read`, exportujeMavenversion a uploaduje ověřenýJAR jako krátkodobý`wallet-jar`artifact.
2. `release`: `needs:build`, ale job-level condition dovolí pouze`refs/heads/main`,`refs/heads/master` nebo`refs/tags/v*`. Teprve tento job má`contents:write`, stáhne ověřenýJAR a zachovává dosavadnícheck/delete/create `v${VERSION}` release chování.
3. `build-images`: závisí přímo na`build`, nikoli na podmíněném`release`. Proto featurebranch nedostane GitHubRelease, ale jehoamd64/arm64 digest image build/push může pokračovat. Registry,permissions,secrets,caches,Actions fullSHA aplatformmatrix zůstaly stejné.
4. `merge-images`: stáhne oba digest artifacts a vytvoří multiarch manifest se stejnou dynamic tag policy. Metadata tags se předpoužitím normalizují na lowercase; inspect užnepotlačuje chybu přes`|| true`.

## Ref → external behavior matrix

| Git ref | Common build | GitHub release | Primární GHCR tag | Další tag |
|---|---:|---:|---|---|
| `refs/heads/feature/updates` |ano |**ne** |`feature-updates` |žádný |
| `refs/heads/main` |ano |ano |`latest` |shortSHA,zachovává dosavadní trace tag |
| `refs/heads/master` |ano |ano |`latest` |shortSHA |
| `refs/tags/v1.2.3` |ano |ano |`1.2.3` |`latest`+shortSHA,zachovává původní metadata auto-latest chování explicitně |

Branch tag pochází z`docker/metadata-action type=ref,event=branch`;slash je sanitizován na`-`. Branchref je vmanifestjobu zapnut jen mimo main/master. Featurebranch proto nedostane`latest`,Mavenversion aniSHA tag. `type=semver` je aktivní jen proversiontag. Původníworkflow používal implicitnímetadata `latest=auto`, takže semver tag přidával také`latest`; novápolicy má`flavor:latest=false` a tento tag zachovává výslovnýmraw pravidlem proversiontags. Main/master dostávajíexplicitní`latest`. Výstup metadata je před`imagetools create` převeden na lowercase.

GitHub Release aGHCR image jsou dvě nezávislépublikačnívětve. Skipped`release` nafeaturebranch nezpůsobískip`build-images`, protože obě závisí přímo naúspěšném`build`.

## Lokální validace

- Actionlint1.7.12:PASS pro`build-and-release.yml` i`purge-cache.yml`.
- PyYAMLabsolutníparse:PASS; jobset přesně`build,release,build-images,merge-images`.
- Strukturníassertions:PASS pro`needs`,jobpermissions aoddělenýrelease/imagegraph.
- `tools/verify-workflow-ref-policy.py`:PASS. Deterministicky simuluje uvedené4refs,kontroluje workflow policy markers aprodukuje `/tmp/wallet-workflow-ref-policy.json`.
- Simulation ověřila přesně:feature/updates→releasefalse+jen`feature-updates`;main/master→releasetrue+`latest`+SHA;v1.2.3→releasetrue+`1.2.3`+historický`latest`+SHA.

Nebyl spuštěn skutečnýGitHub-hosted workflow. Lokálnívalidace proto netvrdí runtimeorganizace permissions,artifacttransport,GHCRlogin,multiarchpush aniGitHubRelease API výsledek.

## Soubory této etapy

- `.github/workflows/build-and-release.yml`
- `tools/verify-workflow-ref-policy.py`
- `docs/reviews/2026-09-01/branch-workflow-handoff.md`

`purge-cache.yml` byl pouze read-only zkontrolován a zůstal bezezměny. Commit nesmí vzniknout přednezávislýmQA aexplicitním`COMMIT_GO`; potom musí staging kontrola vyloučit secrets aephemeral artifacts a zahrnout autorizovanéprojectcode/tests/reports/generatedstatic/lock/workflows.
