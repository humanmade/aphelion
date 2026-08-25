import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const failures = []

function files(directory, extension) {
  const output = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) output.push(...files(absolute, extension))
    else if (absolute.endsWith(extension)) output.push(absolute)
  }
  return output
}

for (const file of [...files(path.join(root, 'src'), '.mjs'), ...files(path.join(root, 'scripts'), '.mjs'), ...files(path.join(root, 'test'), '.mjs'), path.join(root, 'bin/aphelion.mjs')]) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) failures.push(`${path.relative(root, file)}: ${result.stderr.trim()}`)
}

const php = spawnSync('php', ['-l', path.join(root, 'src/mu-plugin/aphelion-audit.php')], { encoding: 'utf8' })
if (php.error?.code !== 'ENOENT' && php.status !== 0) failures.push(`src/mu-plugin/aphelion-audit.php: ${php.stderr.trim()}`)

const server = fs.readFileSync(path.join(root, 'src/daemon/server.mjs'), 'utf8')
if (!/server\.listen\([^,]+,\s*['"]127\.0\.0\.1['"]/.test(server)) failures.push('daemon must bind explicitly to 127.0.0.1')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
if (Object.keys(packageJson.dependencies || {}).length) failures.push('shipped runtime dependencies require a recorded decision')

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`source check: ${files(path.join(root, 'src'), '.mjs').length} modules, mu-plugin, loopback, zero runtime dependencies`)
