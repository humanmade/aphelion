// Transparent MCP stdio tap: forwards bytes unchanged and observes a separate JSON-RPC copy.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { relayIngest } from '../daemon/server.mjs'

export const MCP_HEARTBEAT_MS = 30_000

const primitiveIdentifier = value => (typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isFinite(value))
const jsonRpcKey = value => (typeof value === 'string' || typeof value === 'number') ? `${typeof value}:${value}` : null

function identity(value) {
  if (!value || typeof value !== 'object') return null
  const name = typeof value.name === 'string' ? value.name : null
  const version = typeof value.version === 'string' ? value.version : null
  return name || version ? { name, version } : null
}

function collectArgumentKeys(value, prefix = '', output = new Set()) {
  if (!value || typeof value !== 'object') return output
  if (Array.isArray(value)) {
    for (const item of value) collectArgumentKeys(item, prefix ? `${prefix}[]` : '[]', output)
    return output
  }
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    output.add(path)
    collectArgumentKeys(item, path, output)
  }
  return output
}

function objectHints(value, prefix = '', hints = {}, used = []) {
  if (!value || typeof value !== 'object') return { hints, used }
  if (Array.isArray(value)) {
    for (const item of value) objectHints(item, prefix ? `${prefix}[]` : '[]', hints, used)
    return { hints, used }
  }
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    const normalized = key.toLowerCase()
    if (primitiveIdentifier(item)) {
      if (!hints.objectId && ['postid', 'post_id', 'id'].includes(normalized)) {
        hints.objectId = item
        if (['postid', 'post_id'].includes(normalized)) hints.objectType ||= 'post'
        used.push(path)
      }
      if (!hints.name && ['option', 'name', 'key'].includes(normalized)) {
        hints.name = item
        if (normalized === 'option') hints.objectType ||= 'option'
        used.push(path)
      }
      if (['objecttype', 'object_type', 'type', 'posttype', 'post_type'].includes(normalized)) {
        hints.objectType = String(item)
        used.push(path)
      }
    }
    objectHints(item, path, hints, used)
  }
  return { hints, used }
}

export function extractToolDeclaration(message, correlationId = randomUUID()) {
  if (!message || message.method !== 'tools/call') return null
  const params = message.params && typeof message.params === 'object' ? message.params : {}
  const tool = typeof params.name === 'string' && params.name ? params.name : 'unknown tool'
  const argumentsValue = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
  const { hints, used } = objectHints(argumentsValue)
  return {
    source: 'mcp',
    kind: 'agent.action.declared',
    data: {
      summary: `Called ${tool}`,
      tool,
      argumentKeys: [...collectArgumentKeys(argumentsValue)],
      objectHintKeys: used,
      requestId: message.id ?? null,
      jsonRpcId: message.id ?? null,
      correlationId,
      channel: 'mcp',
      transport: 'stdio',
      ...hints,
    },
  }
}

export function createJsonRpcFrameParser(onMessage = () => {}) {
  const decoder = new StringDecoder('utf8')
  let fragments = []
  const parse = frame => {
    const source = frame.endsWith('\r') ? frame.slice(0, -1) : frame
    if (!source) return
    try {
      const value = JSON.parse(source)
      if (value && typeof value === 'object') onMessage(value)
    } catch {
      // The parsed copy must never affect the byte stream it observes.
    }
  }
  const consume = value => {
    let start = 0
    let boundary
    while ((boundary = value.indexOf('\n', start)) !== -1) {
      if (boundary > start) fragments.push(value.slice(start, boundary))
      parse(fragments.join(''))
      fragments = []
      start = boundary + 1
    }
    if (start < value.length) fragments.push(value.slice(start))
  }
  return {
    write(chunk) {
      try { consume(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) } catch {}
    },
    end() {
      try {
        consume(decoder.end())
        if (fragments.length) parse(fragments.join(''))
      } catch {}
      fragments = []
    },
  }
}

export function createMcpObservationTap(options = {}) {
  const deliver = options.deliver || (() => undefined)
  const connectionId = options.connectionId || `mcp-${randomUUID()}`
  const heartbeatMs = options.heartbeatMs || MCP_HEARTBEAT_MS
  const pendingInitialize = new Map()
  const pendingCalls = new Map()
  let actor = null
  let server = null
  let opened = false
  let closed = false
  let heartbeat = null

  const emit = (kind, data) => {
    try { deliver({ source: 'mcp', kind, data }) } catch {}
  }
  const lifecycleData = extra => ({ connectionId, channel: 'mcp', transport: 'stdio', actor, server, ...extra })
  const emitHeartbeat = () => {
    if (opened && !closed) emit('presence.heartbeat', lifecycleData())
  }
  const open = () => {
    if (opened || closed) return
    opened = true
    emit('presence.open', lifecycleData())
    heartbeat = setInterval(emitHeartbeat, heartbeatMs)
    heartbeat.unref?.()
  }

  return {
    clientMessage(message) {
      if (!message || typeof message !== 'object') return
      const key = jsonRpcKey(message.id)
      if (message.method === 'initialize' && key) pendingInitialize.set(key, identity(message.params?.clientInfo))
      const declaration = extractToolDeclaration(message)
      if (!declaration) return
      if (actor) declaration.data.actor = actor
      emit(declaration.kind, declaration.data)
      if (key) pendingCalls.set(key, declaration.data)
    },
    serverMessage(message) {
      if (!message || typeof message !== 'object') return
      const key = jsonRpcKey(message.id)
      const initializeActor = key ? pendingInitialize.get(key) : null
      if (initializeActor && message.result && typeof message.result === 'object') {
        actor = initializeActor
        server = identity(message.result.serverInfo)
        pendingInitialize.delete(key)
        open()
      }
      const declaration = key ? pendingCalls.get(key) : null
      if (!declaration || (!Object.hasOwn(message, 'result') && !Object.hasOwn(message, 'error'))) return
      const error = message.error && typeof message.error === 'object' ? message.error : null
      emit('agent.action.completed', {
        requestId: declaration.requestId,
        jsonRpcId: declaration.jsonRpcId,
        correlationId: declaration.correlationId,
        channel: 'mcp',
        transport: 'stdio',
        outcome: error ? 'error' : 'ok',
        ...(error && Number.isFinite(error.code) ? { errorCode: error.code } : {}),
      })
      pendingCalls.delete(key)
    },
    heartbeat: emitHeartbeat,
    close(reason, details = {}) {
      if (closed) return
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      if (opened) emit('presence.close', lifecycleData({ reason, ...details }))
    },
  }
}

export function createObservationSink(options = {}) {
  const deliver = options.deliver || (event => relayIngest(event, { port: options.port || process.env.APHELION_PORT }))
  const warn = options.warn || (message => process.stderr.write(`${message}\n`))
  let disabled = false
  let warned = false
  let queue = Promise.resolve()
  const unavailable = () => {
    if (warned) return
    warned = true
    warn('aphelion mcp: local daemon unavailable; observations dropped')
  }
  return {
    emit(event) {
      if (disabled) return
      queue = queue.then(async () => {
        if (disabled) return
        try {
          if (await deliver(event) === false) {
            disabled = true
            unavailable()
          }
        } catch {
          disabled = true
          unavailable()
        }
      })
    },
    flush() { return queue },
  }
}

export function bridgeMcpStreams({ input, output, child, tap }) {
  const clientFrames = createJsonRpcFrameParser(message => tap?.clientMessage(message))
  const serverFrames = createJsonRpcFrameParser(message => tap?.serverMessage(message))
  const forward = (destination, chunk) => {
    try { destination.write(chunk) } catch {}
  }
  input.on('data', chunk => {
    forward(child.stdin, chunk)
    clientFrames.write(chunk)
  })
  child.stdout.on('data', chunk => {
    forward(output, chunk)
    serverFrames.write(chunk)
  })
  input.once('end', () => {
    clientFrames.end()
    try { child.stdin.end() } catch {}
    tap?.close('client-stdin-closed')
  })
  child.stdout.once('end', () => {
    serverFrames.end()
    tap?.close('server-stdout-closed')
  })
  child.stdin.on('error', () => tap?.close('server-stdin-error'))
  child.stdout.on('error', () => tap?.close('server-stdout-error'))
}

export async function runMcpProxy(command, options = {}) {
  if (!Array.isArray(command) || !command.length) throw new Error('mcp requires a server command after --')
  const input = options.input || process.stdin
  const output = options.output || process.stdout
  const errorOutput = options.errorOutput || process.stderr
  const child = (options.spawn || spawn)(command[0], command.slice(1), {
    env: options.env || process.env,
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const sink = createObservationSink({
    deliver: options.deliver,
    warn: options.warn || (message => errorOutput.write(`${message}\n`)),
    port: options.port,
  })
  const tap = createMcpObservationTap({ deliver: event => sink.emit(event), heartbeatMs: options.heartbeatMs })
  bridgeMcpStreams({ input, output, child, tap })

  return new Promise(resolve => {
    let settled = false
    const finish = async code => {
      if (settled) return
      settled = true
      tap.close('child-exit', { exitCode: code })
      await sink.flush()
      resolve(Number.isInteger(code) ? code : 1)
    }
    child.once('error', () => finish(1))
    child.once('close', code => finish(code))
  })
}
