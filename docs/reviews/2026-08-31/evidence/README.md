# Reprodukční podklady review

Obsahuje pouze syntetická data a záznamy lokálního ověřování, žádné uživatelské klíče nebo credentials. Závislosti a build proběhly v `/tmp/goldenera-wallet-review/frontend` a `/tmp/goldenera-wallet-backend-review`. Skripty kopírují nebo extrahují aktuální implementaci pro řízené scénáře; nenahrazují trvalé unit/integration testy.

- `security-repro.mjs`: sedm fault-injection scénářů vault/auth, čte TS ze skutečného repozitáře a skutečný Zustand z frozen instalace; WebCrypto je skutečné, platformní storage/síť jsou mockované. Původní spuštění: Node 24 nad `/tmp/goldenera-wallet-security-repro.mjs`.
- `payment-tanstack-repro.mjs`: extrahuje `onConfirm` ze skutečného zdrojáku, skutečné QueryClient/QueryObserver a cryptoj; mockuje pouze odpovědi API, dokládá dvě různé nonce. Pro spuštění zkopírovat do `frontend/packages/core` **izolované** frozen instalace a spustit Node.
- `payment-qr-repro.mjs`: základní řízená transakční reprodukce a QR callback. Čte `src` relativně k izolovanému `packages/core`; spouštět z tohoto adresáře s uvedenými frozen závislostmi.
- `amounts-fee-repro.mjs`: přesnost částek a reprezentativní encoded velikosti TRANSFER, skutečný cryptoj. Stejné umístění/spouštění jako předchozí.
- `ReviewHarness.java`: skutečné wallet třídy a Spring/Jackson/MapStruct, deterministické node doubles. Původní sestavení a běh proběhly s izolovanými zkompilovanými třídami a classpathem z Maven cache; potřebuje i dostupné Spring test závislosti. Není zahrnut do produkčního source tree.
- `backend-harness-output.txt`, `backend-compile.txt`, `web-build.txt`, `extension-build.txt`, `typecheck.txt`, `web-typecheck.txt`, `extension-typecheck.txt`: výstupy ověření. Absolutní `/tmp` cesty zachycují původní testovací prostředí.

Žádný skript neodesílá skutečnou transakci. Pomocné závislosti v `/tmp` nejsou součástí reportu a po vyčištění temp adresáře je třeba znovu připravit izolovanou frozen instalaci.
