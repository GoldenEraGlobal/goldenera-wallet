import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

// Resolve the compiler deliberately: `typescript` is Microsoft's API-6 bridge
// for ESLint/tsup, while @typescript/native is the stable TypeScript-7 package.
const require = createRequire(new URL('../package.json', import.meta.url))
const metadataPath = require.resolve('@typescript/native/package.json')
const metadata = require(metadataPath)
if (!metadata.version.startsWith('7.')) throw new Error(`Expected TypeScript 7 compiler, found ${metadata.version}`)
const entry = resolve(dirname(metadataPath), metadata.bin.tsc)
console.log(`Production typecheck: TypeScript ${metadata.version} (native compiler)`)
const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
