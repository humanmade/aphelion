import fs from 'node:fs'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { redactPayload } from '../trail/redact.mjs'
import { adaptAccelerateEvent } from '../adapters/accelerate.mjs'

const WP_PROBE_ARG = "--exec=define('APHELION_OBSERVER_PROBE', true);"

function createTail(filePath, onLine) {
  let offset = 0
  try { if (filePath) offset = fs.statSync(filePath).size } catch {}
  let remainder = ''
  return () => {
    if (!filePath) return
    let stat
    try { stat = fs.statSync(filePath) } catch { return }
    if (stat.size < offset) { offset = 0; remainder = '' }
    if (stat.size === offset) return
    const length = stat.size - offset
    const buffer = Buffer.alloc(length)
    const handle = fs.openSync(filePath, 'r')
    try { fs.readSync(handle, buffer, 0, length, offset) } finally { fs.closeSync(handle) }
    offset = stat.size
    const lines = (remainder + buffer.toString('utf8')).split('\n')
    remainder = lines.pop() || ''
    for (const line of lines) if (line.trim()) onLine(line)
  }
}

function runWp(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], [...command.slice(1), ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('WP-CLI runtime snapshot timed out')) }, 12_000)
    child.stdout.on('data', chunk => { if (stdout.length < 256_000) stdout += chunk })
    child.stderr.on('data', chunk => { if (stderr.length < 16_000) stderr += chunk })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', status => {
      clearTimeout(timer)
      if (status !== 0) return reject(new Error((stderr || `WP-CLI exited ${status}`).trim().slice(0, 240)))
      resolve(stdout.trim())
    })
  })
}

async function wpSnapshot(command) {
  const snapshot = {}
  for (const name of ['siteurl', 'home', 'blogname', 'blogdescription', 'permalink_structure', 'show_on_front', 'page_on_front']) {
    const output = await runWp(command, [WP_PROBE_ARG, 'option', 'get', name, '--format=json'])
    try { snapshot[name] = JSON.parse(output) } catch { snapshot[name] = output }
  }
  return snapshot
}

// Mirror the audit mu-plugin's noise predicate: transient/cron/cache
// bookkeeping churn never becomes runtime drift or a place on the map.
function isBookkeepingOption(name) {
  return name.startsWith('_transient_') || name.startsWith('_site_transient_')
    || ['cron', 'category_children', 'rewrite_rules', 'recently_edited'].includes(name)
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

function snapshotSummary(snapshot) {
  return {
    optionNames: Object.keys(snapshot).filter(name => !isBookkeepingOption(name)),
    options: Object.fromEntries(Object.entries(snapshot).filter(([name]) => !isBookkeepingOption(name)).map(([name, value]) => [name, {
      type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
      fingerprint: fingerprint(value),
    }])),
  }
}

export function startSidecar(options) {
  const emit = options.emit
  const intervalMs = Math.max(500, options.intervalMs || 2_000)
  const connectionId = `sidecar:${process.pid}`
  const previousOptions = new Map()
  let baselineWritten = false
  let stopped = false
  let wpFailed = false
  let wpReady = false
  let polling = false
  let lastWpHeartbeat = 0
  let identityPending = false
  const heartbeats = new Map()

  const emitWithAdapter = (source, kind, data, eventOptions) => {
    const raw = emit(source, kind, data, eventOptions)
    const adapted = adaptAccelerateEvent(raw)
    if (adapted) emit(adapted.source, adapted.kind, adapted.data, eventOptions)
  }

  const audit = createTail(options.auditLog, line => {
    try {
      const record = JSON.parse(line)
      if (!record.kind || !record.data) throw new Error('missing kind/data')
      if (record.kind === 'presence.heartbeat') {
        const key = String(record.data.connectionId || record.data.channel || 'wordpress-heartbeat')
        const previous = heartbeats.get(key)
        const next = { lastSeen: record.ts, lastEmitted: previous?.lastEmitted || 0, active: true, data: record.data }
        if (previous && !previous.active) {
          emit('wp', 'presence.reconnect', record.data, { ts: record.ts })
          next.lastEmitted = record.ts
        } else if (!previous || record.ts - next.lastEmitted >= 30_000) {
          emit('wp', 'presence.heartbeat', record.data, { ts: record.ts })
          next.lastEmitted = record.ts
        }
        heartbeats.set(key, next)
        return
      }
      emitWithAdapter('wp', record.kind, record.data, { ts: record.ts })
    } catch (error) {
      emit('sidecar', 'wp.audit.error', { error: error.message, bytes: Buffer.byteLength(line) })
    }
  })
  const debug = createTail(options.debugLog, line => {
    emit('wp', 'wp.log.line', { summary: 'WordPress wrote a debug log entry', line: redactPayload(line), channel: 'runtime-log', transport: 'filesystem' })
  })

  async function pollRuntime() {
    if (stopped || !options.wpCommand?.length || polling) return
    polling = true
    try {
      const snapshot = await wpSnapshot(options.wpCommand)
      if (stopped) return
      const recovering = wpFailed
      if (recovering) {
        emit('sidecar', 'presence.reconnect', {
          connectionId,
          actor: 'WordPress sidecar',
          channel: 'wp-cli',
          transport: options.transport || 'process',
        })
      }
      if (!wpReady) {
        emit('sidecar', 'presence.ready', {
          connectionId,
          actor: 'WordPress sidecar',
          channel: 'wp-cli',
          transport: options.transport || 'process',
        })
        wpReady = true
        lastWpHeartbeat = Date.now()
      } else if (Date.now() - lastWpHeartbeat >= 30_000) {
        emit('sidecar', 'presence.heartbeat', {
          connectionId,
          actor: 'WordPress sidecar',
          channel: 'wp-cli',
          transport: options.transport || 'process',
        })
        lastWpHeartbeat = Date.now()
      }
      const firstBaseline = !baselineWritten
      if (firstBaseline) {
        for (const [name, value] of Object.entries(snapshot)) previousOptions.set(name, { fingerprint: fingerprint(value) })
        emit('sidecar', 'runtime.baseline', { ...snapshotSummary(snapshot), channel: 'wp-cli', transport: options.transport || 'process' })
        baselineWritten = true
      } else {
        for (const [name, value] of Object.entries(snapshot)) {
          if (isBookkeepingOption(name)) continue
          const nextFingerprint = fingerprint(value)
          const previous = previousOptions.get(name)
          if (!previous || previous.fingerprint !== nextFingerprint) {
            emitWithAdapter('sidecar', 'runtime.option.changed', {
              name,
              changed: true,
              beforeFingerprint: previous?.fingerprint || null,
              afterFingerprint: nextFingerprint,
              valueType: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
              channel: 'wp-cli',
              transport: options.transport || 'process',
              summary: `WordPress setting ${name} changed`,
            })
            previousOptions.set(name, { value, fingerprint: nextFingerprint })
          }
        }
      }
      if ((firstBaseline || identityPending) && typeof snapshot.blogname === 'string' && snapshot.blogname.trim()) {
        emit('sidecar', 'runtime.site.identity', { siteName: snapshot.blogname.trim(), channel: 'wp-cli', transport: options.transport || 'process' })
      }
      identityPending = false
      wpFailed = false
    } catch (error) {
      if (stopped) return
      if (!wpFailed) {
        emit('sidecar', 'presence.error', { connectionId, actor: 'WordPress sidecar', channel: 'wp-cli', transport: options.transport || 'process', error: error.message })
      }
      wpFailed = true
      wpReady = false
    } finally {
      polling = false
    }
  }

  function expireHeartbeats(now = Date.now()) {
    for (const [key, heartbeat] of heartbeats) {
      if (heartbeat.active && now - heartbeat.lastSeen > 45_000) {
        heartbeat.active = false
        emit('wp', 'presence.timeout', heartbeat.data, { ts: now })
        heartbeats.set(key, heartbeat)
      }
    }
  }

  emit('sidecar', 'presence.open', { connectionId, actor: 'WordPress sidecar', channel: 'runtime', transport: 'filesystem', auditLog: options.auditLog || null, debugLog: options.debugLog || null })
  audit(); debug(); pollRuntime()
  const timer = setInterval(() => { audit(); debug(); pollRuntime(); expireHeartbeats() }, intervalMs)
  timer.unref()
  const stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    audit(); debug()
    emit('sidecar', 'presence.close', { connectionId, actor: 'WordPress sidecar', channel: 'runtime', transport: 'filesystem' })
  }
  stop.sessionStarted = () => {
    if (stopped) return
    identityPending = true
    pollRuntime()
  }
  return stop
}
