import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { adaptAccelerateEvent, renderFrameSvg, renderTimelapse, startDaemon } from '../src/index.mjs'

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-wordpress-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('Accelerate adapter translates relevant raw effects without replacing them', () => {
  const raw = { source: 'wp', kind: 'wp.post_meta.updated', data: { objectType: 'post-meta', objectId: 8, metaKey: '_altis_ab_test_titles_variants', title: 'Pricing page' } }
  const adapted = adaptAccelerateEvent(raw)
  assert.equal(adapted.kind, 'adapter.accelerate.updated_variants_for')
  assert.match(adapted.data.summary, /Accelerate updated variants/)
  assert.equal(adapted.data.rawKind, raw.kind)
  assert.equal(adaptAccelerateEvent({ kind: 'wp.post.updated', data: { title: 'Ordinary post' } }), null)
})

test('sidecar collects audit lines and records raw plus semantic Accelerate events', async t => {
  const root = temporary(t)
  const auditLog = path.join(root, 'audit.jsonl')
  fs.writeFileSync(auditLog, '')
  const daemon = await startDaemon({ target: root, trailDirectory: path.join(root, 'trails'), auditLog, sidecarInterval: 500, port: 6170, watch: false })
  t.after(() => daemon.close('test-cleanup'))
  fs.appendFileSync(auditLog, JSON.stringify({
    v: 1,
    ts: 100,
    kind: 'wp.post_meta.updated',
    data: { objectType: 'post-meta', objectId: 9, metaKey: '_altis_ab_test_titles_variants', channel: 'wp-admin', transport: 'http' },
  }) + '\n')
  const heartbeat = {
    v: 1,
    ts: Date.now() - 60_000,
    kind: 'presence.heartbeat',
    data: { connectionId: 'wp-admin-heartbeat:6', actor: { id: 6, login: 'noel' }, channel: 'wp-admin-heartbeat', transport: 'http' },
  }
  fs.appendFileSync(auditLog, `${JSON.stringify(heartbeat)}\n${JSON.stringify({ ...heartbeat, ts: heartbeat.ts + 10_000 })}\n`)
  await new Promise(resolve => setTimeout(resolve, 620))
  const model = await fetch(`${daemon.url}/api/model`).then(response => response.json())
  assert.ok(model.recent.some(event => event.kind === 'wp.post_meta.updated'))
  assert.ok(model.recent.some(event => event.kind === 'adapter.accelerate.updated_variants_for'))
  assert.ok(Object.values(model.connections).some(connection => connection.channel === 'runtime'))
  assert.equal(model.recent.filter(event => event.kind === 'presence.heartbeat').length, 1)
  assert.equal(model.recent.filter(event => event.kind === 'presence.timeout').length, 1)
  fs.appendFileSync(auditLog, `${JSON.stringify({ ...heartbeat, ts: Date.now() })}\n`)
  await new Promise(resolve => setTimeout(resolve, 620))
  const reconnected = await fetch(`${daemon.url}/api/model`).then(response => response.json())
  assert.equal(reconnected.recent.filter(event => event.kind === 'presence.reconnect').length, 1)
  assert.equal(reconnected.connections['wp:wp-admin-heartbeat:6'].active, true)
  await daemon.close('test')
})

test('timelapse HTML and SVG are deterministic trail projections', async t => {
  const root = temporary(t)
  const events = [
    { v: 1, ts: 1, seq: 1, source: 'session', kind: 'session.start', data: { sessionId: 'render-test', target: '/demo' } },
    { v: 1, ts: 2, seq: 2, source: 'plan', kind: 'plan.snapshot', data: { title: 'Demo', nodes: [{ id: 'observe', title: 'Observe WordPress', level: 'component', status: 'active' }], decisions: [] } },
    { v: 1, ts: 3, seq: 3, source: 'mcp', kind: 'mcp.ability.call', data: { ability: 'core/update-post', channel: 'mcp' } },
    { v: 1, ts: 4, seq: 4, source: 'wp', kind: 'wp.post.updated', data: { objectType: 'post', objectId: 4, title: 'Pricing', channel: 'rest' } },
  ]
  const output = path.join(root, 'trail.html')
  const result = await renderTimelapse(events, output, { maxFrames: 10 })
  assert.equal(result.frames, 4)
  const html = fs.readFileSync(output, 'utf8')
  assert.match(html, /Play timelapse/)
  assert.match(html, /Evidence ledger/)
  const svg = renderFrameSvg({
    session: { target: '<unsafe>' }, plan: { nodes: [] }, recent: [], counts: { declared: 0, observed: 0 },
  }, events[0], { progress: .5 })
  assert.doesNotMatch(svg, /<unsafe>/)
  assert.match(svg, /&lt;unsafe&gt;/)
  assert.doesNotMatch(svg, /(?:^|[;{])font:/, 'native SVG renderers must not receive CSS font shorthand')
  assert.doesNotMatch(svg, /letter-spacing:-/, 'ImageMagick MSVG must not receive negative text kerning')
  assert.match(svg, /font-size:38px/, 'headline size must remain explicit for ImageMagick MSVG')
})
