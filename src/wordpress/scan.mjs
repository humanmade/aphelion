import fs from 'node:fs'
import path from 'node:path'

const IGNORE = new Set(['.git', '.aphelion', '.agenttrail', 'node_modules', 'vendor', 'dist', 'build', '.next'])
const PHP_PATTERNS = [
  ['block', /register_block_type\s*\(\s*['"]([^'"]+)['"]/g],
  ['rest-route', /register_rest_route\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g],
  ['post-type', /register_post_type\s*\(\s*['"]([^'"]+)['"]/g],
  ['taxonomy', /register_taxonomy\s*\(\s*['"]([^'"]+)['"]/g],
  ['admin-page', /add_(?:menu|submenu)_page\s*\([^;]*?['"]([^'"]+)['"]\s*\)/gs],
  ['hook-action', /add_action\s*\(\s*['"]([^'"]+)['"]/g],
  ['hook-filter', /add_filter\s*\(\s*['"]([^'"]+)['"]/g],
]

function walk(root, options = {}) {
  const maxFiles = options.maxFiles || 4_000
  const files = []
  const queue = [root]
  let truncated = false
  while (queue.length && files.length < maxFiles) {
    const directory = queue.shift()
    let entries = []
    try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) queue.push(absolute)
      else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'))
      if (files.length >= maxFiles) { truncated = true; break }
    }
  }
  return { files: files.sort(), truncated }
}

function safeJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return null }
}

function declaration(type, name, file, details = {}) {
  return { id: `${type}:${name}`, type, name, file, ...details }
}

export function scanWordPress(root, options = {}) {
  const target = path.resolve(root)
  const { files, truncated } = walk(target, options)
  const declarations = []
  for (const file of files) {
    const absolute = path.join(target, file)
    if (path.basename(file) === 'block.json') {
      const block = safeJson(absolute)
      if (block?.name) declarations.push(declaration('block', block.name, file, { title: block.title || block.name, category: block.category || null, apiVersion: block.apiVersion || null }))
      continue
    }
    if (!file.endsWith('.php')) continue
    let source = ''
    try { source = fs.readFileSync(absolute, 'utf8') } catch { continue }
    if (source.length > 1_000_000) continue
    for (const [type, pattern] of PHP_PATTERNS) {
      pattern.lastIndex = 0
      for (const match of source.matchAll(pattern)) {
        const name = type === 'rest-route' ? `${match[1]}${match[2]}` : match[1]
        if (name) declarations.push(declaration(type, name, file))
      }
    }
  }
  const unique = [...new Map(declarations.map(item => [item.id, item])).values()]
  return { target, files, declarations: unique, truncated }
}
