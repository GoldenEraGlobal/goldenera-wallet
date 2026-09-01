// Run with Node 24 from any working directory. All generated files stay in /tmp.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const webRequire = createRequire(join(frontend, 'apps/web/package.json'))
const generatorPackage = webRequire.resolve('@vite-pwa/assets-generator/package.json')
const generatorRequire = createRequire(generatorPackage)
const sharp = generatorRequire('sharp')
const ico = generatorRequire('sharp-ico')
const output = await mkdtemp('/tmp/goldenera-wallet-pwa-assets-')
await mkdir(join(output, 'public'))
await copyFile(join(frontend, 'apps/web/public/logo_full.png'), join(output, 'public/logo_full.png'))

// Invoke the real CLI with the same preset and input as generate-pwa-assets.
execFileSync(process.execPath, [join(dirname(generatorPackage), 'bin/pwa-assets-generator.mjs'),
  '--preset', 'minimal-2023', '--root', output, 'public/logo_full.png'], { stdio: 'pipe' })

const expected = {
  'pwa-64x64.png': 64,
  'pwa-192x192.png': 192,
  'pwa-512x512.png': 512,
  'maskable-icon-512x512.png': 512,
  'apple-touch-icon-180x180.png': 180,
  'favicon.ico': 48,
}
const files = (await readdir(join(output, 'public'))).filter(name => name !== 'logo_full.png').sort()
assert.deepEqual(files, Object.keys(expected).sort())
const results = []
for (const name of files) {
  const path = join(output, 'public', name)
  const buffer = await readFile(path)
  const size = expected[name]
  let image
  if (name.endsWith('.ico')) {
    const frames = ico.decode(buffer)
    assert.equal(frames.length, 1)
    assert.equal(frames[0].width, size)
    assert.equal(frames[0].height, size)
    image = ico.sharpsFromIco(buffer)[0]
  } else {
    image = sharp(buffer)
    const metadata = await image.metadata()
    assert.equal(metadata.format, 'png')
    assert.equal(metadata.width, size)
    assert.equal(metadata.height, size)
  }
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(data.length, size * size * 4)
  assert.equal(info.channels, 4)
  // A blank/transparent image can have valid metadata: decode actual pixels too.
  let opaque = 0
  let nonWhite = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) opaque++
    if (data[i + 3] > 0 && (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240)) nonWhite++
  }
  assert.ok(opaque > size * size * 0.1, `${name}: missing visible content`)
  assert.ok(nonWhite > size * size * 0.01, `${name}: image looks blank`)
  if (name.startsWith('maskable') || name.startsWith('apple')) assert.equal(data[3], 255)
  else assert.equal(data[3], 0)
  results.push({ name, width: size, height: size, bytes: (await stat(path)).size, decoded: true })
}
console.log(JSON.stringify({ sharp: sharp.versions.sharp, libvips: sharp.versions.vips, output, results }, null, 2))
