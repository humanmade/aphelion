import { spawnSync } from 'node:child_process'

const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' })
if (result.status !== 0) {
  console.error(result.stderr || result.stdout)
  process.exit(result.status || 1)
}
const report = JSON.parse(result.stdout)[0]
const names = report.files.map(file => file.path)
const required = ['assets/aphelion-board.png', 'bin/aphelion.mjs', 'public/index.html', 'src/index.mjs', 'src/mu-plugin/aphelion-audit.php', 'types/index.d.ts', 'docs/README.md', 'docs/background-service.md', 'docs/trail-format.md', 'docs/observation-surfaces.md', 'CHANGELOG.md', 'README.md', 'RELEASING.md', 'SECURITY.md', 'LICENSE']
const forbiddenRoots = ['.aphelion/', 'test/', 'upstream/', 'knowledge/', 'graphify-out/', 'qa-artifacts/', 'prd/']
const forbiddenFiles = new Set(['PRODUCT.md', 'BUILD-PLAN.md', 'DESIGN.md', 'HYPERFRAMES.md', 'QA_REPORT.md', 'PRD.md'])
const forbidden = names.filter(name => forbiddenRoots.some(root => name.startsWith(root)) || forbiddenFiles.has(name) || name.endsWith('-PRD.md'))
const missing = required.filter(name => !names.includes(name))
const executable = report.files.find(file => file.path === 'bin/aphelion.mjs')
if (missing.length || forbidden.length || !(executable?.mode & 0o111)) {
  if (missing.length) console.error(`missing from tarball: ${missing.join(', ')}`)
  if (forbidden.length) console.error(`forbidden in tarball: ${forbidden.join(', ')}`)
  if (!(executable?.mode & 0o111)) console.error('installed CLI is not executable')
  process.exit(1)
}
console.log(`tarball check: ${report.files.length} files, ${report.size} bytes packed, ${report.unpackedSize} bytes unpacked`)
