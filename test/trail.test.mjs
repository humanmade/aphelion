import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildReplayIndex, createTrailWriter, discoverSessions, projectEvents, projectReplay, readTrail, reduceEvent, createProjection } from '../src/index.mjs'

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-trail-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('writer flushes a readable append-only session with optional integrity links', async t => {
  const directory = temporaryDirectory(t)
  const clockValues = [1000, 1010, 1020]
  const writer = createTrailWriter({
    target: directory,
    trailDirectory: directory,
    sessionId: 'session-a',
    hostname: 'test-host',
    integrity: true,
    clock: () => clockValues.shift(),
  })

  const event = writer.append('watcher', 'file.write', { file: 'plugin.php', password: 'do-not-store' })
  assert.equal(event.seq, 2)
  assert.equal(event.data.password, '[redacted]')
  assert.match(event.prev, /^[a-f0-9]{64}$/)
  writer.close({ reason: 'test' })

  const events = await readTrail(writer.path)
  assert.deepEqual(events.map(item => item.kind), ['session.start', 'file.write', 'session.end'])
  assert.equal(events[0].data.topologyVersion, 2)
  assert.deepEqual(events.map(item => item.seq), [1, 2, 3])
  assert.equal(events[0].prev, undefined)
  assert.match(events[1].prev, /^[a-f0-9]{64}$/)
  assert.match(events[2].prev, /^[a-f0-9]{64}$/)
  assert.equal(fs.statSync(writer.path).mode & 0o777, 0o600)
})

test('crash-ended sessions remain discoverable and readable without session.end', async t => {
  const directory = temporaryDirectory(t)
  const filePath = path.join(directory, 'crash-session.jsonl')
  fs.writeFileSync(filePath, [
    { v: 1, ts: 1, seq: 1, source: 'session', kind: 'session.start', data: { sessionId: 'crash-session', target: directory } },
    { v: 1, ts: 2, seq: 2, source: 'hook', kind: 'tool.pre', data: { tool: 'Edit' } },
  ].map(event => JSON.stringify(event)).join('\n') + '\n')

  const sessions = await discoverSessions(directory, { trailDirectory: directory })
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].id, 'crash-session')
  const events = await readTrail(filePath)
  assert.deepEqual(events.map(item => item.kind), ['session.start', 'tool.pre'])
})

test('a malformed line cannot block later valid events', async t => {
  const directory = temporaryDirectory(t)
  const filePath = path.join(directory, 'broken.jsonl')
  const lines = [
    { v: 1, ts: 1, seq: 1, source: 'session', kind: 'session.start', data: {} },
    '{not-json',
    { v: 1, ts: 3, seq: 3, source: 'watcher', kind: 'file.write', data: { file: 'later.php', futureField: true } },
  ]
  fs.writeFileSync(filePath, `${JSON.stringify(lines[0])}\n${lines[1]}\n${JSON.stringify(lines[2])}\n`)
  const malformed = []
  const events = await readTrail(filePath, { onMalformed: item => malformed.push(item.line) })
  assert.deepEqual(malformed, [2])
  assert.deepEqual(events.map(item => item.seq), [1, 3])
  assert.equal(events[1].data.futureField, true)
})

test('one reducer produces identical live and replay projections', () => {
  const events = [
    { v: 1, ts: 1, seq: 1, source: 'session', kind: 'session.start', data: { target: '/repo' } },
    { v: 1, ts: 2, seq: 2, source: 'plan', kind: 'plan.snapshot', data: { title: 'Demo', nodes: [{ id: 'trail', level: 'component' }], decisions: [] } },
    { v: 1, ts: 3, seq: 3, source: 'mcp', kind: 'mcp.ability.call', data: { ability: 'core/get-post', channel: 'mcp' } },
    { v: 1, ts: 4, seq: 4, source: 'wp', kind: 'wp.post.updated', data: { objectType: 'post', objectId: 42, title: 'Hello', channel: 'rest' } },
    { v: 1, ts: 5, seq: 5, source: 'mcp', kind: 'presence.open', data: { connectionId: 'mcp-1', channel: 'mcp' } },
    { v: 1, ts: 6, seq: 6, source: 'mcp', kind: 'presence.disconnect', data: { connectionId: 'mcp-1', channel: 'mcp' } },
  ]
  const replay = projectEvents(events)
  const live = events.reduce((state, event) => reduceEvent(state, event), createProjection())
  assert.deepEqual(live, replay)
  assert.equal(replay.counts.declared, 2)
  assert.equal(replay.counts.observed, 1)
  assert.equal(replay.connections['mcp:mcp-1'].active, false)
  assert.equal(replay.wordpress.objects['post:42'].title, 'Hello')
  assert.equal(replay.topologyVersion, 1)
})

test('sparse replay index is rebuildable and preserves every seek result', () => {
  const events = Array.from({ length: 237 }, (_, index) => ({
    v: 1,
    ts: index + 1,
    seq: index + 1,
    source: index ? 'watcher' : 'session',
    kind: index ? 'file.write' : 'session.start',
    data: index ? { file: `src/file-${index}.php` } : { target: '/repo' },
  }))
  const index = buildReplayIndex(events, { stride: 40 })
  assert.deepEqual(index.snapshots.map(snapshot => snapshot.cursor), [-1, 39, 79, 119, 159, 199, 236])
  for (const cursor of [0, 38, 39, 40, 118, 199, 236]) {
    const expected = projectEvents(events.slice(0, cursor + 1))
    assert.deepEqual(projectReplay(events, cursor, index), expected)
    assert.deepEqual(projectReplay(events, cursor), expected)
  }
})

test('correlated journeys preserve source time, capture lag, and effect latency', async t => {
  const directory = temporaryDirectory(t)
  const writer = createTrailWriter({
    target: directory,
    trailDirectory: directory,
    sessionId: 'timed-journey',
    clock: (() => {
      const values = [1_000, 1_250, 2_500, 2_510]
      return () => values.shift()
    })(),
  })
  const declared = writer.append('mcp', 'mcp.ability.call', {
    ability: 'core/get-site-info', requestId: 'request-1', channel: 'mcp', transport: 'stdio',
  }, { ts: 1_100 })
  const observed = writer.append('wp', 'wp.ability.invoked', {
    ability: 'core/get-site-info', requestId: 'request-1', channel: 'wp-cli', transport: 'docker-exec',
  }, { ts: 2_300 })
  writer.close({ reason: 'test' })

  assert.equal(declared.receivedAt, 1_250)
  assert.equal(observed.receivedAt, 2_500)
  const projection = projectEvents(await readTrail(writer.path))
  assert.equal(projection.journeys['request-1'].effectLatencyMs, 1_200)
  assert.equal(projection.journeys['request-1'].captureLagMs, 200)
  assert.deepEqual(projection.journeys['request-1'].phases.map(phase => phase.kind), ['mcp.ability.call', 'wp.ability.invoked'])
})

test('declared agent actions and object actors stay owner-readable', () => {
  const declared = reduceEvent(createProjection(), {
    v: 1, seq: 1, ts: 1, source: 'qa-driver', kind: 'agent.action.declared',
    data: { summary: 'Change a setting', channel: 'wp-cli' },
  })
  const connected = reduceEvent(declared, {
    v: 1, seq: 2, ts: 2, source: 'wp', kind: 'presence.open',
    data: { actor: { login: 'noel' }, channel: 'wp-admin', connectionId: 'admin-1' },
  })
  assert.equal(connected.counts.declared, 1)
  assert.equal(connected.activity[0].summary, 'Change a setting')
  assert.equal(connected.recent[0].summary, 'noel open')
})

test('correlation joins journeys without merging distinct connector presence', () => {
  const projection = projectEvents([
    { v: 1, seq: 1, ts: 1, source: 'mcp', kind: 'presence.ready', data: { connectionId: 'request-7', requestId: 'request-7', channel: 'mcp', transport: 'stdio' } },
    { v: 1, seq: 2, ts: 2, source: 'wp', kind: 'presence.open', data: { connectionId: 'request-7', requestId: 'request-7', channel: 'wp-cli', transport: 'process' } },
    { v: 1, seq: 3, ts: 3, source: 'wp', kind: 'presence.close', data: { connectionId: 'request-7', requestId: 'request-7', channel: 'wp-cli', transport: 'process' } },
  ])
  assert.equal(projection.connections['mcp:request-7'].active, true)
  assert.equal(projection.connections['wp:request-7'].active, false)
  assert.equal(projection.journeys['request-7'].phases.length, 3)
})

test('redaction removes credentials from nested and string payloads', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-redact-'))
  const writer = createTrailWriter({ target: directory, trailDirectory: directory, sessionId: 'redaction' })
  const event = writer.append('hook', 'tool.pre', {
    headers: { Authorization: 'Bearer abc.def.ghi' },
    command: 'curl -H "Authorization: Bearer abc123" https://example.test',
    appPassword: 'abcd efgh ijkl mnop qrst uvwx',
  })
  writer.close()
  fs.rmSync(directory, { recursive: true, force: true })
  assert.equal(event.data.headers.Authorization, '[redacted]')
  assert.match(event.data.command, /\[redacted authorization\]/)
  assert.equal(event.data.appPassword, '[redacted]')
})
