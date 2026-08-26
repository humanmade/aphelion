import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { startDaemon } from '../src/index.mjs'
import { bridgeMcpStreams, createMcpObservationTap, createObservationSink, extractToolDeclaration } from '../src/mcp/proxy.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function chunks(buffer, seed) {
  const output = []
  let offset = 0
  let state = seed
  while (offset < buffer.length) {
    state = (state * 1_103_515_245 + 12_345) >>> 0
    const length = Math.min(buffer.length - offset, 1 + state % 97)
    output.push(buffer.subarray(offset, offset + length))
    offset += length
  }
  return output
}

function capture(stream) {
  const output = []
  stream.on('data', chunk => output.push(Buffer.from(chunk)))
  return output
}

const settle = () => new Promise(resolve => setImmediate(resolve))

function bridgeFixture({ deliver, warn }) {
  const input = new PassThrough()
  const output = new PassThrough()
  const serverInput = new PassThrough()
  const serverOutput = new PassThrough()
  const sink = createObservationSink({ deliver, warn })
  const tap = createMcpObservationTap({ deliver: event => sink.emit(event), connectionId: 'mcp-fuzz' })
  bridgeMcpStreams({ input, output, child: { stdin: serverInput, stdout: serverOutput }, tap })
  return { input, output, serverInput, serverOutput, sink }
}

function exitOf(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

async function waitFor(check, message) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const value = check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${message}`)
}

test('MCP declarations retain structural keys and primitive object hints without argument values', () => {
  const declaration = extractToolDeclaration({
    jsonrpc: '2.0',
    id: 42,
    method: 'tools/call',
    params: {
      name: 'wordpress.update_post',
      arguments: {
        postId: 464,
        type: 'page',
        nested: { title: 'private headline', flags: [{ enabled: true, secret: 'never-recorded' }] },
      },
    },
  }, 'correlation-42')

  assert.equal(declaration.data.summary, 'Called wordpress.update_post')
  assert.deepEqual(declaration.data.argumentKeys, ['postId', 'type', 'nested', 'nested.title', 'nested.flags', 'nested.flags[].enabled', 'nested.flags[].secret'])
  assert.equal(declaration.data.objectId, 464)
  assert.equal(declaration.data.objectType, 'page')
  assert.deepEqual(declaration.data.objectHintKeys, ['postId', 'type'])
  assert.equal(JSON.stringify(declaration.data).includes('private headline'), false)
  assert.equal(JSON.stringify(declaration.data).includes('never-recorded'), false)
})

test('MCP stream bridge keeps randomized fragmented and oversized bytes exact with observations enabled or down', async () => {
  const clientBytes = Buffer.from([
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'Fuzz client', version: '1.0.0' } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'wp.update', arguments: { postId: 12, content: 'x'.repeat(1_100_000), nested: { title: 'not-recorded' } } } }),
    '{not-json',
  ].join('\n') + '\n')
  const serverBytes = Buffer.from([
    JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'Fuzz server', version: '2.0.0' } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'large private result' }] } }),
  ].join('\n') + '\n')

  for (const mode of ['enabled', 'down']) {
    const events = []
    const warnings = []
    const fixture = bridgeFixture({
      deliver: async event => {
        if (mode === 'down') return false
        events.push(event)
        return true
      },
      warn: message => warnings.push(message),
    })
    const forwardedToServer = capture(fixture.serverInput)
    const forwardedToClient = capture(fixture.output)
    const clientChunks = chunks(clientBytes, 7)
    const serverChunks = chunks(serverBytes, 11)
    for (let index = 0; index < Math.max(clientChunks.length, serverChunks.length); index++) {
      if (clientChunks[index]) fixture.input.write(clientChunks[index])
      if (serverChunks[index]) fixture.serverOutput.write(serverChunks[index])
    }
    fixture.input.end()
    fixture.serverOutput.end()
    await settle()
    await fixture.sink.flush()

    assert.deepEqual(Buffer.concat(forwardedToServer), clientBytes)
    assert.deepEqual(Buffer.concat(forwardedToClient), serverBytes)
    if (mode === 'enabled') {
      const declaration = events.find(event => event.kind === 'agent.action.declared')
      assert.ok(declaration)
      assert.equal(JSON.stringify(declaration.data).includes('not-recorded'), false)
      assert.equal(JSON.stringify(declaration.data).includes('x'.repeat(100)), false)
    } else {
      assert.deepEqual(warnings, ['aphelion mcp: local daemon unavailable; observations dropped'])
    }
  }
})

test('MCP tap records initialize presence, heartbeats, and safe completion outcomes', () => {
  const events = []
  const tap = createMcpObservationTap({ deliver: event => events.push(event), connectionId: 'mcp-lifecycle' })
  tap.clientMessage({ jsonrpc: '2.0', id: 'initialize-1', method: 'initialize', params: { clientInfo: { name: 'Fixture agent', version: '3.0' } } })
  tap.serverMessage({ jsonrpc: '2.0', id: 'initialize-1', result: { serverInfo: { name: 'Fixture server', version: '4.0' } } })
  tap.heartbeat()
  tap.clientMessage({ jsonrpc: '2.0', id: 'ok', method: 'tools/call', params: { name: 'wp.get', arguments: { id: 7, type: 'post' } } })
  tap.serverMessage({ jsonrpc: '2.0', id: 'ok', result: { private: 'not retained' } })
  tap.clientMessage({ jsonrpc: '2.0', id: 'error', method: 'tools/call', params: { name: 'wp.update', arguments: {} } })
  tap.serverMessage({ jsonrpc: '2.0', id: 'error', error: { code: -32602, message: 'private error text' } })
  tap.close('child-exit', { exitCode: 0 })

  assert.deepEqual(events.map(event => event.kind), ['presence.open', 'presence.heartbeat', 'agent.action.declared', 'agent.action.completed', 'agent.action.declared', 'agent.action.completed', 'presence.close'])
  assert.deepEqual(events[0].data.actor, { name: 'Fixture agent', version: '3.0' })
  assert.deepEqual(events[0].data.server, { name: 'Fixture server', version: '4.0' })
  assert.deepEqual(events[2].data.actor, { name: 'Fixture agent', version: '3.0' })
  assert.equal(events[3].data.outcome, 'ok')
  assert.equal(events[5].data.outcome, 'error')
  assert.equal(events[5].data.errorCode, -32602)
  assert.equal(JSON.stringify(events[5].data).includes('private error text'), false)
  assert.equal(events.at(-1).data.reason, 'child-exit')
})

test('the CLI proxy records a scripted MCP exchange through the real daemon', async t => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-mcp-proxy-'))
  const serverPath = path.join(fixtureRoot, 'fake-mcp-server.mjs')
  const clientPath = path.join(fixtureRoot, 'fake-mcp-client.mjs')
  const trailDirectory = path.join(fixtureRoot, 'trails')
  const daemon = await startDaemon({ target: fixtureRoot, trailDirectory, port: 6210, watch: false })
  t.after(async () => {
    await daemon.close('test-cleanup')
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  })
  fs.writeFileSync(serverPath, `
let pending = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  pending += chunk
  let boundary
  while ((boundary = pending.indexOf('\\n')) !== -1) {
    const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1)
    if (!line) continue
    const message = JSON.parse(line)
    if (message.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { serverInfo: { name: 'Fixture MCP', version: '1.2.3' } } }) + '\\n')
    if (message.method === 'tools/call') process.stdout.write(JSON.stringify(message.params.name === 'wp.error'
      ? { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'private tool failure' } }
      : { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'private tool result' }] } }) + '\\n')
  }
})
`)
  fs.writeFileSync(clientPath, `
let pending = ''
let sentCalls = false
let replies = 0
process.stdin.setEncoding('utf8')
const send = value => process.stdout.write(JSON.stringify(value) + '\\n')
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'Fixture client', version: '9.0.0' } } })
process.stdin.on('data', chunk => {
  pending += chunk
  let boundary
  while ((boundary = pending.indexOf('\\n')) !== -1) {
    const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1)
    if (!line) continue
    const response = JSON.parse(line)
    if (response.id === 1 && !sentCalls) {
      sentCalls = true
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'wp.update', arguments: { postId: 464, type: 'page', title: 'private title', nested: { body: 'private body' } } } })
      send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'wp.error', arguments: { option: 'blogdescription', value: 'private value' } } })
    } else if (response.id === 2 || response.id === 3) {
      replies++
      if (replies === 2) process.exit(0)
    }
  }
})
`)

  const proxy = spawn(process.execPath, [path.join(root, 'bin/aphelion.mjs'), 'mcp', '--', process.execPath, serverPath], {
    cwd: root,
    env: { ...process.env, APHELION_PORT: String(daemon.port) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const client = spawn(process.execPath, [clientPath], { cwd: fixtureRoot, stdio: ['pipe', 'pipe', 'pipe'] })
  client.stdout.pipe(proxy.stdin)
  proxy.stdout.pipe(client.stdin)
  const [clientResult, proxyResult] = await Promise.all([exitOf(client), exitOf(proxy)])
  assert.equal(clientResult.code, 0)
  assert.equal(proxyResult.code, 0)
  const events = await waitFor(() => {
    const path = daemon.trailPath
    if (!fs.existsSync(path)) return null
    const entries = fs.readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    return entries.some(event => event.kind === 'presence.close') ? entries : null
  }, 'the MCP tap close event')
  await daemon.close('integration-complete')
  const complete = fs.readFileSync(daemon.trailPath, 'utf8').trim().split('\n').map(line => JSON.parse(line))

  assert.deepEqual(complete.map(event => event.kind), [
    'session.start', 'plan.snapshot', 'repo.snapshot',
    'presence.open', 'agent.action.declared', 'agent.action.declared',
    'agent.action.completed', 'agent.action.completed', 'presence.close', 'session.end',
  ])
  const declarations = complete.filter(event => event.kind === 'agent.action.declared')
  assert.deepEqual(declarations[0].data.argumentKeys, ['postId', 'type', 'title', 'nested', 'nested.body'])
  assert.equal(JSON.stringify(declarations).includes('private title'), false)
  assert.equal(JSON.stringify(declarations).includes('private body'), false)
  assert.equal(JSON.stringify(declarations).includes('private value'), false)
  const error = complete.find(event => event.kind === 'agent.action.completed' && event.data.outcome === 'error')
  assert.equal(error.data.errorCode, -32602)
  assert.equal(JSON.stringify(error.data).includes('private tool failure'), false)
  assert.deepEqual(complete.find(event => event.kind === 'presence.open').data.actor, { name: 'Fixture client', version: '9.0.0' })
  assert.deepEqual(complete.find(event => event.kind === 'presence.open').data.server, { name: 'Fixture MCP', version: '1.2.3' })
  assert.deepEqual(declarations[0].data.actor, { name: 'Fixture client', version: '9.0.0' })
  assert.equal(events.at(-1).kind, 'presence.close')
})
