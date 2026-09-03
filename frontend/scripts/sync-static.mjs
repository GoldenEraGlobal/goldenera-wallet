import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(frontend, 'apps/web/dist')
const target = resolve(frontend, '../src/main/resources/static')
const checkOnly = process.argv.includes('--check')

async function files(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    assert(!entry.isSymbolicLink(), `Refusing symlink in generated assets: ${path}`)
    if (entry.isDirectory()) result.push(...await files(path, root))
    else result.push(relative(root, path).replaceAll('\\', '/'))
  }
  return result.sort()
}

const generated = await files(source)
for (const entry of ['index.html', 'manifest.webmanifest', 'sw.js']) assert(generated.includes(entry), `Build the production PWA first: missing ${entry}`)
const targetExists = await lstat(target).then(stat => { assert(!stat.isSymbolicLink(), 'Static target cannot be a symlink'); return true }, error => { if (error.code === 'ENOENT') return false; throw error })
let backup
if (!checkOnly) {
  if (targetExists) {
    // This directory was historically committed Vite output. Refuse to delete
    // unknown hand-written backend resources; those belong in frontend/public.
    const legacyGenerated = /^(?:assets\/[^/]+|icons\/(?:icon-192x192|icon-512x512|favicon-64x64|apple-touch-icon)\.png|index\.html|manifest\.webmanifest|sw\.js|registerSW\.js|vite\.svg|workbox-[\w-]+\.js)$/
    const unknown = (await files(target)).filter(file => !generated.includes(file) && !legacyGenerated.test(file))
    assert.equal(unknown.length, 0, `Refusing to remove unknown static resources: ${unknown.join(', ')}`)
    backup = await mkdtemp('/tmp/goldenera-wallet-static-backup-')
    await cp(target, join(backup, 'static'), { recursive: true })
    await rm(target, { recursive: true })
  }
  await mkdir(target, { recursive: true })
  await cp(source, target, { recursive: true })
}
assert.deepEqual(await files(target), generated, 'Static directory must have exactly the current PWA file set')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const hashes = {}
for (const file of generated) {
  const [input, output] = await Promise.all([readFile(join(source, file)), readFile(join(target, file))])
  assert.equal(sha256(output), sha256(input), `Static byte mismatch: ${file}`)
  hashes[file] = sha256(output)
}
const result = { mode: checkOnly ? 'check' : 'sync', source, target, backup, count: generated.length, files: hashes }
const outputArg = process.argv.indexOf('--report')
if (outputArg !== -1) await writeFile(resolve(process.argv[outputArg + 1]), JSON.stringify(result, null, 2) + '\n')
console.log(`PWA static ${result.mode}: ${generated.length} files match byte-for-byte${backup ? `; previous output backed up at ${backup}` : ''}`)
