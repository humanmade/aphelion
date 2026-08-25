// Durable append-only writer derived from agenttrail's local-first persistence posture.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSessionId, resolveTrailPath } from './paths.mjs'
import { redactPayload } from './redact.mjs'

function hashLine(line) {
  return crypto.createHash('sha256').update(line).digest('hex')
}

export class TrailWriter {
  #fd
  #seq = 0
  #lastHash = null
  #clock
  #integrity

  constructor(options = {}) {
    const target = options.target || process.cwd()
    const targetType = options.targetType || 'project'
    this.sessionId = options.sessionId || createSessionId()
    this.path = options.path || resolveTrailPath(target, this.sessionId, {
      targetType,
      trailDirectory: options.trailDirectory,
      homeDirectory: options.homeDirectory,
    })
    this.closed = false
    this.#clock = options.clock || Date.now
    this.#integrity = Boolean(options.integrity)
    fs.mkdirSync(path.dirname(this.path), { recursive: true })
    this.#fd = fs.openSync(this.path, 'ax', 0o600)
    this.append('session', 'session.start', {
      sessionId: this.sessionId,
      target,
      targetType,
      agent: options.agent || null,
      aphelionVersion: options.version || '0.1.0',
      hostname: options.hostname || os.hostname(),
      integrity: this.#integrity ? 'sha256-chain' : 'none',
    })
  }

  append(source, kind, data = {}, options = {}) {
    if (this.closed) throw new Error('Cannot append to a closed trail')
    if (!source || !kind) throw new TypeError('Trail events require source and kind')
    const receivedAt = this.#clock()
    const event = {
      v: 1,
      ts: Number.isFinite(options.ts) ? options.ts : receivedAt,
      seq: ++this.#seq,
      source: String(source),
      kind: String(kind),
      data: redactPayload(data),
    }
    if (Number.isFinite(options.ts)) event.receivedAt = receivedAt
    if (this.#integrity && this.#lastHash) event.prev = this.#lastHash
    const line = `${JSON.stringify(event)}\n`
    fs.writeSync(this.#fd, line, null, 'utf8')
    fs.fsyncSync(this.#fd)
    if (this.#integrity) this.#lastHash = hashLine(line)
    return event
  }

  close(data = {}) {
    if (this.closed) return
    const event = this.append('session', 'session.end', data)
    fs.closeSync(this.#fd)
    this.#fd = null
    this.closed = true
    return event
  }
}

export function createTrailWriter(options = {}) {
  return new TrailWriter(options)
}
