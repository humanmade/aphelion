// Product-owned path contract; adapted from agenttrail's local-state discipline.
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

export function slugifyTarget(target) {
  const raw = String(target || 'unknown').trim().toLowerCase()
  const readable = raw
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'target'
  const digest = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8)
  return `${readable}-${digest}`
}

export function createSessionId(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `${stamp}-${crypto.randomBytes(4).toString('hex')}`
}

export function resolveTrailDirectory(target, options = {}) {
  if (options.trailDirectory) return path.resolve(options.trailDirectory)
  if ((options.targetType || 'project') === 'site') {
    return path.join(options.homeDirectory || os.homedir(), '.aphelion', 'trails', slugifyTarget(target))
  }
  return path.join(path.resolve(target || process.cwd()), '.aphelion', 'trail')
}

export function resolveTrailPath(target, sessionId, options = {}) {
  return path.join(resolveTrailDirectory(target, options), `${sessionId}.jsonl`)
}
