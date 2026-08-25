// Recursive watcher and fallback strategy substantially derived from agenttrail.
import fs from 'node:fs'
import path from 'node:path'

const IGNORE = /(^|\/)(\.git|\.aphelion|\.agenttrail|node_modules|vendor|dist|build|\.next|coverage|qa-artifacts)(\/|$)/
const TEMPORARY = /(\.tmp(?:\.|$)|~$|\.sw[px]$|(^|\/)\.#|(^|\/)#.+#$|\.DS_Store$)/

export function watchRepository(root, onChange) {
  const target = path.resolve(root)
  const watchers = new Set()
  const recent = new Map()
  const handle = (_, filename) => {
    if (!filename) return
    const file = String(filename).split(path.sep).join('/')
    if (IGNORE.test(file) || TEMPORARY.test(file)) return
    const now = Date.now()
    if (now - (recent.get(file) || 0) < 60) return
    recent.set(file, now)
    onChange(file, now)
  }
  try {
    const watcher = fs.watch(target, { recursive: true }, handle)
    watchers.add(watcher)
  } catch {
    const queue = [target]
    while (queue.length) {
      const directory = queue.shift()
      try {
        const watcher = fs.watch(directory, (event, name) => handle(event, path.relative(target, path.join(directory, String(name || '')))))
        watchers.add(watcher)
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const relative = path.relative(target, path.join(directory, entry.name)).split(path.sep).join('/')
          if (entry.isDirectory() && !IGNORE.test(relative)) queue.push(path.join(directory, entry.name))
        }
      } catch {}
    }
  }
  const prune = setInterval(() => {
    const cutoff = Date.now() - 10_000
    for (const [file, at] of recent) if (at < cutoff) recent.delete(file)
  }, 10_000)
  prune.unref()
  return () => {
    clearInterval(prune)
    for (const watcher of watchers) watcher.close()
    watchers.clear()
  }
}
