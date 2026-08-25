import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { resolveTrailDirectory } from './paths.mjs'

function isEnvelope(value) {
  return value && Number.isInteger(value.v) && Number.isFinite(value.ts) && Number.isInteger(value.seq) && typeof value.source === 'string' && typeof value.kind === 'string' && value.data && typeof value.data === 'object'
}

export async function* iterateTrail(filePath, options = {}) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let lineNumber = 0
  for await (const text of lines) {
    lineNumber++
    if (!text.trim()) continue
    try {
      const event = JSON.parse(text)
      if (!isEnvelope(event)) throw new Error('Invalid trail envelope')
      yield event
    } catch (error) {
      options.onMalformed?.({ line: lineNumber, text, error })
    }
  }
}

export async function readTrail(filePath, options = {}) {
  const events = []
  for await (const event of iterateTrail(filePath, options)) events.push(event)
  return events
}

export async function discoverSessions(target, options = {}) {
  const directory = options.trailDirectory
    ? path.resolve(options.trailDirectory)
    : resolveTrailDirectory(target, options)
  let names = []
  try {
    names = (await fs.promises.readdir(directory)).filter(name => name.endsWith('.jsonl')).sort().reverse()
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const sessions = []
  for (const name of names) {
    const filePath = path.join(directory, name)
    const stat = await fs.promises.stat(filePath)
    let start = null
    for await (const event of iterateTrail(filePath)) {
      start = event
      break
    }
    sessions.push({ id: name.slice(0, -6), path: filePath, size: stat.size, mtimeMs: stat.mtimeMs, start })
  }
  return sessions
}
