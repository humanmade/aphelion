import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const failures = []
const requiredFiles = ['assets/aphelion-board.jpg', 'bin/aphelion.mjs', 'public/index.html', 'types/index.d.ts', 'docs/README.md', 'docs/background-service.md', 'CHANGELOG.md', 'README.md', 'RELEASING.md', 'SECURITY.md', 'LICENSE']

if (pkg.name !== 'aphelion') failures.push('package name must be aphelion')
if ('private' in pkg) failures.push('publish-ready package must not set private')
if (pkg.publishConfig?.access !== 'public') failures.push('unscoped package must publish with public access')
if (pkg.publishConfig?.registry !== 'https://registry.npmjs.org/') failures.push('publish registry must be the public npm registry')
if (pkg.engines?.node !== '>=20') failures.push('Node support floor must remain >=20')
if (Object.keys(pkg.dependencies || {}).length) failures.push('runtime dependencies must remain empty')
if (pkg.bin?.aphelion !== 'bin/aphelion.mjs') failures.push('npm must install the aphelion executable')
if (pkg.exports?.['.']?.types !== './types/index.d.ts') failures.push('root export must expose types first')
if (pkg.exports?.['.']?.default !== './src/index.mjs') failures.push('root export must expose the ESM implementation')
for (const file of requiredFiles) if (!fs.existsSync(path.join(root, file))) failures.push(`missing package file: ${file}`)
if (!(fs.statSync(path.join(root, 'bin/aphelion.mjs')).mode & 0o111)) failures.push('bin/aphelion.mjs must be executable')

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('package contract: unscoped public package, ESM, typed export, executable bin, zero runtime dependencies')
