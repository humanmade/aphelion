// Loopback daemon adapted from sodiumsun/agenttrail's watcher, SSE, and hook seams.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTrailWriter } from '../trail/writer.mjs'
import { discoverSessions, readTrail } from '../trail/reader.mjs'
import { createProjection, projectEvents, reduceEvent } from '../trail/reducer.mjs'
import { parsePlan, matchComponents } from './plan.mjs'
import { classifyHookEvent } from './hooks.mjs'
import { watchRepository } from './watcher.mjs'
import { scanWordPress } from '../wordpress/scan.mjs'
import { startSidecar } from '../sidecar/index.mjs'
import { SHIPPED_OBSERVER_VERSION } from '../observer/version.mjs'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PUBLIC_ROOT = path.join(PACKAGE_ROOT, 'public')
const MAX_BODY = 1_000_000
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60_000
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' }

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

async function body(request) {
  let raw = ''
  for await (const chunk of request) {
    raw += chunk
    if (raw.length > MAX_BODY) throw new Error('Request body exceeds 1 MB')
  }
  return raw ? JSON.parse(raw) : {}
}

function isLocalRequest(request) {
  const host = String(request.headers.host || '').split(':')[0]
  const origin = request.headers.origin
  const localHost = ['127.0.0.1', 'localhost', '[::1]'].includes(host)
  const localOrigin = !origin || /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(origin)
  return localHost && localOrigin
}

function safeAsset(urlPath) {
  if (urlPath === '/') return path.join(PUBLIC_ROOT, 'index.html')
  if (urlPath === '/assets/reducer.mjs') return path.join(PACKAGE_ROOT, 'src', 'trail', 'reducer.mjs')
  if (urlPath === '/assets/topology-version.mjs') return path.join(PACKAGE_ROOT, 'src', 'trail', 'topology-version.mjs')
  if (urlPath === '/assets/replay.mjs') return path.join(PACKAGE_ROOT, 'src', 'replay', 'index.mjs')
  if (urlPath === '/assets/topology.mjs') return path.join(PACKAGE_ROOT, 'src', 'board', 'topology.mjs')
  if (urlPath === '/trail/reducer.mjs') return path.join(PACKAGE_ROOT, 'src', 'trail', 'reducer.mjs')
  if (urlPath === '/trail/topology-version.mjs') return path.join(PACKAGE_ROOT, 'src', 'trail', 'topology-version.mjs')
  if (urlPath === '/wordpress/containment.mjs') return path.join(PACKAGE_ROOT, 'src', 'wordpress', 'containment.mjs')
  if (!urlPath.startsWith('/assets/')) return null
  const relative = urlPath.slice('/assets/'.length)
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(relative) || relative.includes('..')) return null
  return path.join(PUBLIC_ROOT, 'assets', relative)
}

function sessionIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/)
  return match ? decodeURIComponent(match[1]) : null
}

async function listenWithFallback(server, requested) {
  for (let candidate = requested; candidate <= requested + 14; candidate++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListen); reject(error) }
        const onListen = () => { server.off('error', onError); resolve() }
        server.once('error', onError)
        server.once('listening', onListen)
        server.listen(candidate, '127.0.0.1')
      })
      return candidate
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error
    }
  }
  throw new Error(`No free loopback port in ${requested}-${requested + 14}`)
}

export async function startDaemon(options = {}) {
  const targetType = options.targetType || 'project'
  const target = targetType === 'site' ? String(options.target) : path.resolve(options.target || process.cwd())
  const planPath = targetType === 'project' ? path.join(target, 'PLAN.md') : null
  const writerOptions = { target, targetType, integrity: options.integrity, agent: options.agent, version: options.version || '0.1.0', topologyVersion: options.topologyVersion, trailDirectory: options.trailDirectory }
  let writer = createTrailWriter(writerOptions)
  let projection = projectEvents(await readTrail(writer.path))
  let plan = parsePlan(planPath && fs.existsSync(planPath) ? fs.readFileSync(planPath, 'utf8') : '')
  let repository = { target, files: [], declarations: [], truncated: false }
  const clients = new Set()
  let stopped = false
  let rescanTimer = null
  let idleTimer = null
  let sessionClosed = false
  let lastActivityAt = Date.now()
  const idleTimeoutMs = options.idleTimeoutMs === undefined ? DEFAULT_IDLE_TIMEOUT_MS : Number(options.idleTimeoutMs)

  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) throw new TypeError('idleTimeoutMs must be a positive number')

  const broadcast = event => {
    const message = `event: trail\ndata: ${JSON.stringify(event)}\n\n`
    for (const client of clients) client.write(message)
    options.onEvent?.(event, projection)
  }

  const append = (source, kind, data, emitOptions) => {
    const event = writer.append(source, kind, data, emitOptions)
    projection = reduceEvent(projection, event)
    broadcast(event)
    return event
  }

  const isActivity = kind => !kind.startsWith('presence.') && !kind.startsWith('session.') && kind !== 'plan.snapshot' && kind !== 'repo.snapshot'

  const armIdleTimer = () => {
    clearTimeout(idleTimer)
    if (stopped || sessionClosed) return
    const remaining = Math.max(1, lastActivityAt + idleTimeoutMs - Date.now())
    idleTimer = setTimeout(() => {
      if (stopped || sessionClosed) return
      if (Date.now() - lastActivityAt < idleTimeoutMs) return armIdleTimer()
      const event = writer.close({ reason: 'idle-timeout', idleTimeoutMs })
      sessionClosed = true
      projection = reduceEvent(projection, event)
      broadcast(event)
    }, remaining)
    idleTimer.unref?.()
  }

  const beginSession = () => {
    writer = createTrailWriter(writerOptions)
    projection = projectEvents([])
    sessionClosed = false
    lastActivityAt = Date.now()
    const [start] = fs.readFileSync(writer.path, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    projection = reduceEvent(projection, start)
    broadcast(start)
    append('plan', 'plan.snapshot', plan)
    append('watcher', 'repo.snapshot', repository)
    stopSidecar.sessionStarted?.()
    armIdleTimer()
  }

  const emit = (source, kind, data, emitOptions) => {
    if (stopped) return null
    const activity = isActivity(kind)
    if (sessionClosed) {
      if (!activity) return null
      beginSession()
    }
    const event = append(source, kind, data, emitOptions)
    if (activity) {
      lastActivityAt = Date.now()
      armIdleTimer()
    }
    return event
  }

  const snapshotPlan = () => {
    plan = parsePlan(planPath && fs.existsSync(planPath) ? fs.readFileSync(planPath, 'utf8') : '')
    emit('plan', 'plan.snapshot', plan)
  }

  const snapshotRepository = () => {
    repository = targetType === 'project'
      ? scanWordPress(target, { maxFiles: options.maxFiles || 4_000 })
      : { target, files: [], declarations: [], truncated: false }
    emit('watcher', 'repo.snapshot', repository)
  }

  snapshotPlan()
  snapshotRepository()
  armIdleTimer()

  const stopWatching = options.watch === false || targetType !== 'project' ? () => {} : watchRepository(target, (file, at) => {
    emit('watcher', 'file.write', { file, components: matchComponents(plan, file) }, { ts: at })
    if (file === 'PLAN.md') snapshotPlan()
    if (file.endsWith('.php') || file.endsWith('block.json')) {
      clearTimeout(rescanTimer)
      rescanTimer = setTimeout(snapshotRepository, 250)
    }
  })
  const stopSidecar = options.auditLog || options.debugLog || options.wpCommand?.length
    ? startSidecar({ emit, auditLog: options.auditLog, debugLog: options.debugLog, wpCommand: options.wpCommand, transport: options.wpTransport, intervalMs: options.sidecarInterval, expectedObserverVersion: SHIPPED_OBSERVER_VERSION, warn: options.warn })
    : () => {}

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1')
      if (!isLocalRequest(request)) return json(response, 403, { error: 'Aphelion accepts loopback requests only.' })
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, 200, { ok: true, sessionId: writer.sessionId, target, targetType, idleTimeoutMs, port: server.address()?.port || null })
      }
      if (request.method === 'GET' && url.pathname === '/api/model') {
        return json(response, 200, { ...projection, daemon: { target, targetType, sessionId: writer.sessionId } })
      }
      if (request.method === 'GET' && url.pathname === '/api/sessions') {
        return json(response, 200, await discoverSessions(target, { targetType, trailDirectory: options.trailDirectory }))
      }
      const requestedSession = sessionIdFromPath(url.pathname)
      if (request.method === 'GET' && requestedSession) {
        const sessions = await discoverSessions(target, { targetType, trailDirectory: options.trailDirectory })
        const session = sessions.find(item => item.id === requestedSession)
        if (!session) return json(response, 404, { error: 'Session not found' })
        return json(response, 200, await readTrail(session.path))
      }
      if (request.method === 'GET' && url.pathname === '/events') {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
        response.write(`event: ready\ndata: ${JSON.stringify({ sessionId: writer.sessionId })}\n\n`)
        clients.add(response)
        request.on('close', () => clients.delete(response))
        return
      }
      if (request.method === 'POST' && url.pathname === '/hook') {
        const input = await body(request)
        const events = classifyHookEvent(input)
        for (const event of events) emit(event.source, event.kind, event.data)
        return json(response, 202, { accepted: events.length })
      }
      if (request.method === 'POST' && url.pathname === '/ingest') {
        const input = await body(request)
        if (!input.source || !input.kind || !input.data || typeof input.data !== 'object') return json(response, 400, { error: 'source, kind, and object data are required' })
        const event = emit(input.source, input.kind, input.data, { ts: input.ts })
        return json(response, 202, event ? { accepted: true, seq: event.seq, sessionId: writer.sessionId } : { accepted: false, reason: 'session-idle' })
      }
      if (request.method === 'GET') {
        const asset = safeAsset(url.pathname)
        if (asset && asset.startsWith(PACKAGE_ROOT) && fs.existsSync(asset) && fs.statSync(asset).isFile()) {
          response.writeHead(200, { 'content-type': MIME[path.extname(asset)] || 'application/octet-stream', 'cache-control': 'no-store' })
          return fs.createReadStream(asset).pipe(response)
        }
      }
      json(response, 404, { error: 'Not found' })
    } catch (error) {
      json(response, error.message.includes('1 MB') ? 413 : 400, { error: error.message })
    }
  })

  const keepAlive = setInterval(() => {
    for (const client of clients) client.write(': heartbeat\n\n')
  }, 15_000)
  keepAlive.unref()
  const port = await listenWithFallback(server, options.port || 5330)

  return {
    target,
    targetType,
    port,
    url: `http://127.0.0.1:${port}`,
    get sessionId() { return writer.sessionId },
    get trailPath() { return writer.path },
    idleTimeoutMs,
    get projection() { return projection },
    emit,
    async close(reason = 'shutdown') {
      if (stopped) return
      stopped = true
      clearTimeout(rescanTimer)
      clearTimeout(idleTimer)
      clearInterval(keepAlive)
      stopWatching()
      stopSidecar()
      for (const client of clients) client.end()
      clients.clear()
      await new Promise(resolve => server.close(resolve))
      if (!sessionClosed) writer.close({ reason })
      projection = projectEvents(await readTrail(writer.path))
    },
  }
}

async function relayDaemon(pathname, raw, options = {}) {
  const ports = options.port ? [Number(options.port)] : Array.from({ length: 15 }, (_, index) => 5330 + index)
  const responses = await Promise.allSettled(ports.map(port => fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
    signal: AbortSignal.timeout(400),
  })))
  return responses.some(response => response.status === 'fulfilled' && response.value.ok)
}

export async function relayHook(raw, options = {}) {
  return relayDaemon('/hook', raw, options)
}

export async function relayIngest(event, options = {}) {
  return relayDaemon('/ingest', JSON.stringify(event), options)
}
