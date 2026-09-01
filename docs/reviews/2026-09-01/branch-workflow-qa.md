# Nezávislé QA branche a GitHub workflow

Datum: 2026-09-01

**Výsledek: QA_SIGNOFF — PASS.** Workflow/branch změny jsou připravené k pozdějšímu explicitnímu stagingu a commitu. Toto QA nic nestageovalo, necommitovalo ani neposílalo na GitHub. Nebyl spuštěn GitHub-hosted workflow, registry login, image push, release, cache purge, deploy, bezpečnostní scan ani CVE analýza. Obsah `.env` nebyl čten.

## Git stav

- Aktivní lokální branch je přesně `feature/updates`; název neobsahuje `codex`.
- `HEAD`, `main`, `origin/main` a merge-base s `main` jsou `d2dc2830dd2618c138eff209df1abd1be190537a` (`feat: cosmetics`). `main..HEAD` i `HEAD..main` jsou prázdné, takže vytvoření branche nepřidalo commit.
- Index je prázdný: `git diff --cached --quiet` vrátil 0. QA nevytvořilo commit ani staging.
- Před přidáním tohoto QA reportu měl working tree 401 položek: 162 modified, 54 deleted a 185 untracked. Jde o autorizovaný společný update zdrojů, testů, reportů, generated API/static souborů, lockfile a workflow.
- `.env` a `.github_creds` jsou ignorované, nejsou tracked ani v porcelain statusu. `target`, `node_modules`, aplikace `dist`, Turbo logy a browser test output jsou také ignorované/nejsou v pracovním statusu. Kontrola proběhla pouze podle názvů a ignore pravidel; `.env` nebyl otevřen.

## Workflow graph a oprávnění

`.github/workflows/build-and-release.yml` reaguje na push libovolné branche (`"**"`) a na tagy `v*`. Nemá nový pull-request trigger.

Job graph z aktuálního YAML:

| Job | `needs` | Job permissions | Chování na `feature/updates` |
|---|---|---|---|
| `build` | žádné | `contents: read`, `packages: read` | běží |
| `release` | `build` | `contents: write` | přes job-level `if` přeskočen |
| `build-images` | `build` | `contents: read`, `packages: write` | běží nezávisle na skipped `release` |
| `merge-images` | `build-images` | `contents: read`, `packages: write` | po úspěšné image matrix vytvoří branch manifest |

Všechny tři `gh release` příkazy jsou pouze uvnitř podmíněného `release` jobu. Feature branch proto nemůže kontrolovat, mazat ani vytvořit GitHub Release. `contents: write` není přiděleno buildu ani image jobům. Cache purge zůstává samostatný ručně spouštěný workflow s `actions: write` a povinným vstupem `DELETE`; toto QA jej nespustilo.

## Skutečná ref/tag politika

První QA běh našel konkrétní rozdíl mezi simulátorem a `docker/metadata-action`: `type=semver` při výchozím `flavor latest=auto` přidává tag `latest`. Simulátor původně pouze reimplementoval očekávaný výsledek a tento behavior nekontroloval. Workflow owner opravil konfiguraci před signoffem:

- merge metadata má explicitní `flavor: latest=false`;
- raw `latest` je explicitně povolen pouze pro `main`, `master` a `v*` tag;
- semver je povolen pouze pro `v*` tag;
- branch-ref tag je povolen pouze pro non-main/master branch;
- short-SHA je povolen pouze pro main/master/version tag;
- výsledné názvy jsou před `imagetools create` převedeny na lowercase.

Nezávislý QA parser četl přímo aktuální YAML, vyhodnotil jeho skutečné `enable` výrazy a prioritu metadata pravidel. Nepoužil výsledek z projektového simulátoru. Výsledek:

| Ref | Release | GHCR manifest tags v pořadí priority |
|---|---:|---|
| `refs/heads/feature/updates` | ne | `feature-updates` |
| `refs/heads/main` | ano | `latest`, short-SHA |
| `refs/heads/master` | ano | `latest`, short-SHA |
| `refs/tags/v1.2.3` | ano | `1.2.3`, `latest`, short-SHA |

`docker/metadata-action` sanitizuje slash v branch refu na `-`; následná normalizace zajistí lowercase. Feature branch tedy nedostane `latest`, Maven verzi, semver ani SHA tag. Původní version-tag auto-latest chování je zachované explicitně a není závislé na implicitním defaultu action.

## Lokální kontroly

- Actionlint 1.7.12: **PASS, 0 errors** pro oba workflow soubory. Binární `shellcheck` a `pyflakes` na hostu nejsou, takže příslušná volitelná actionlint pravidla byla vypnutá; YAML, GitHub expressions, action inputs a workflow struktura byly zkontrolované.
- YAML parse: **PASS**; job set je přesně `build`, `release`, `build-images`, `merge-images`.
- Všech 19 `uses:` referencí v build/release workflow používá plný 40znakový commit SHA.
- `tools/verify-workflow-ref-policy.py`: **PASS** po doplnění kontroly explicitního `latest=false` a version-tag latest pravidla.
- Samostatný QA evaluator skutečných YAML výrazů: **PASS** pro čtyři refs v tabulce výše; současně potvrdil, že release příkazy existují jen v `release` jobu.
- `git diff --check` pro workflow, simulátor a handoff report: **PASS**.
- Skutečný GitHub run nebyl proveden. Runtime organizace permissions, artifact transport, GHCR push, nativní ARM runner a GitHub Release API proto zůstávají ověřitelné až po uživatelem povoleném pushi.

## Plán stagingu a commitu

Staging může začít až po explicitním `COMMIT_GO`. Doporučený bezpečný postup je:

1. Znovu ověřit `feature/updates`, nezměněný base/HEAD a prázdný index.
2. Stagovat explicitně pouze autorizované skupiny: project source/config, lockfile, Maven wrapper, oba workflow, `tools`, frontend/backend testy, review dokumenty, generated API a odpovídající generated PWA/static soubory. Tracked `frontend/apps/web/dev-dist` změny musí být stagované spolu se svým odpovídajícím workbox souborem, ne samostatně.
3. Nestagovat `.env`, `.github_creds`, `target`, `node_modules`, aplikace `dist`, `.turbo`, logy, `/tmp`, Playwright reporty/artifacts ani test-results.
4. Před commitem spustit `git diff --cached --name-status`, `git diff --cached --check` a name-only kontrolu zakázaných cest. Ověřit, že generated deletions/additions tvoří úplné páry a že index zahrnuje oba workflow soubory i QA reporty.
5. Vytvořit až poté jeden lokální commit na `feature/updates` s běžným názvem bez `codex`. Push zůstává samostatná neprovedená akce.

QA tímto dává **QA_SIGNOFF** pouze pro lokální branch/workflow konfiguraci a uvedený commit plán. Nejde o souhlas s pushem, releasem, registry publikací ani deployem.
