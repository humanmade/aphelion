import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const docsDirectory = path.join(root, 'docs')
const publicDocs = [
  'README.md',
  'CHANGELOG.md',
  'RELEASING.md',
  'SECURITY.md',
  ...fs.readdirSync(docsDirectory)
    .filter(name => name.endsWith('.md'))
    .sort()
    .map(name => `docs/${name}`),
]
const internalReferences = /(?:^|[/(])(?:PRODUCT\.md|BUILD-PLAN\.md|DESIGN\.md|HYPERFRAMES\.md|QA_REPORT\.md|PRD\.md|knowledge\/|graphify-out\/)/
const failures = []
let checkedLinks = 0

for (const relativeFile of publicDocs) {
  const absoluteFile = path.join(root, relativeFile)
  const markdown = fs.readFileSync(absoluteFile, 'utf8')

  if (internalReferences.test(markdown)) {
    failures.push(`${relativeFile}: references a private planning or generated-analysis file`)
  }

  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '')
    if (!target || /^(?:https?:|mailto:|#)/.test(target)) continue
    const withoutAnchor = decodeURIComponent(target.split('#')[0])
    if (!withoutAnchor) continue
    checkedLinks++
    const resolved = path.resolve(path.dirname(absoluteFile), withoutAnchor)
    if (!fs.existsSync(resolved)) failures.push(`${relativeFile}: broken link ${target}`)
  }
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
const readmeContracts = [
  ['install command', 'npm install --global aphelion'],
  ['product screenshot', 'assets/aphelion-board.png'],
  ['quickstart', '## Quickstart'],
  ['automatic-run guidance', '## Run automatically'],
  ['background guide', 'docs/background-service.md'],
  ['CLI reference', '## CLI'],
  ['library example', '## Library'],
  ['security guidance', 'SECURITY.md'],
  ['license', '## License'],
]
for (const [label, text] of readmeContracts) {
  if (!readme.includes(text)) failures.push(`README.md: missing ${label}`)
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`docs check: ${publicDocs.length} public Markdown files, ${checkedLinks} local links, README contracts present`)
