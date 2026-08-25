import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { classifyHookEvent, matchComponents, parsePlan, scanWordPress, startDaemon } from '../src/index.mjs'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-daemon-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('PLAN parser retains owner-readable components and derives honest status', () => {
  const plan = parsePlan(`# Demo

## Watch WordPress {#watch}
tech: fs watcher
files: [src/**, plugin.php]
- [x] Record files {#watch-files}
  by: codex
- [~] Parse declarations {#watch-wp}
  from: agent

## decisions
- one trail
`)
  assert.equal(plan.title, 'Demo')
  assert.equal(plan.nodes[0].status, 'active')
  assert.deepEqual(plan.nodes[0].files, ['src/**', 'plugin.php'])
  assert.deepEqual(matchComponents(plan, 'src/daemon/server.mjs'), ['watch'])
  assert.deepEqual(matchComponents(plan, 'plugin.php'), ['watch'])
  assert.deepEqual(plan.decisions, ['one trail'])
})

test('WordPress scanner finds block metadata and PHP declarations', t => {
  const root = fixture(t)
  fs.mkdirSync(path.join(root, 'blocks', 'hero'), { recursive: true })
  fs.writeFileSync(path.join(root, 'blocks', 'hero', 'block.json'), JSON.stringify({ name: 'demo/hero', title: 'Hero', apiVersion: 3 }))
  fs.writeFileSync(path.join(root, 'plugin.php'), `<?php
register_post_type( 'book' );
register_rest_route( 'demo/v1', '/books' );
add_action( 'init', 'demo_init' );
`)
  const result = scanWordPress(root)
  assert.equal(result.truncated, false)
  assert.ok(result.declarations.some(item => item.id === 'block:demo/hero' && item.title === 'Hero'))
  assert.ok(result.declarations.some(item => item.id === 'post-type:book'))
  assert.ok(result.declarations.some(item => item.id === 'rest-route:demo/v1/books'))
  assert.ok(result.declarations.some(item => item.id === 'hook-action:init'))
})

test('hook classifier keeps MCP declaration separate from presence', () => {
  const events = classifyHookEvent({
    hook_event_name: 'PreToolUse',
    session_id: 'run-1',
    tool_name: 'mcp__wordpress__wp_get_post',
    tool_input: { id: 42, ability: 'core/get-post', token: 'secret', correlationId: 'ability-42', transport: 'stdio' },
    cwd: '/repo',
  })
  assert.deepEqual(events.map(event => event.kind), ['presence.ready', 'mcp.ability.call'])
  assert.equal(events[1].data.ability, 'core/get-post')
  assert.equal(events[1].data.requestId, 'ability-42')
  assert.equal(events[1].data.transport, 'stdio')
})

test('agent session end closes hook and MCP presence without merging their sources', () => {
  const events = classifyHookEvent({ hook_event_name: 'SessionEnd', session_id: 'run-1', transport: 'stdio' })
  assert.deepEqual(events.map(event => `${event.source}:${event.kind}`), ['hook:presence.close', 'mcp:presence.close'])
  assert.equal(events[1].data.transport, 'stdio')
})

test('daemon serves model, ingests events, and closes a complete trail', async t => {
  const root = fixture(t)
  const trailDirectory = path.join(root, 'trails')
  fs.writeFileSync(path.join(root, 'PLAN.md'), '# Demo\n\n## Observe {#observe}\nfiles: [plugin.php]\n- [ ] Watch files {#observe-files}\n')
  fs.writeFileSync(path.join(root, 'plugin.php'), '<?php register_post_type("book");')
  const daemon = await startDaemon({ target: root, trailDirectory, port: 6130, watch: false })
  t.after(() => daemon.close('test-cleanup'))

  const health = await fetch(`${daemon.url}/health`).then(response => response.json())
  assert.equal(health.ok, true)
  const before = await fetch(`${daemon.url}/api/model`).then(response => response.json())
  assert.equal(before.plan.title, 'Demo')
  assert.ok(before.repository.declarations.some(item => item.id === 'post-type:book'))

  const accepted = await fetch(`${daemon.url}/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'wp', kind: 'wp.post.updated', data: { objectType: 'post', objectId: 7, title: 'Test post', channel: 'rest' } }),
  }).then(response => response.json())
  assert.equal(accepted.accepted, true)
  const after = await fetch(`${daemon.url}/api/model`).then(response => response.json())
  assert.equal(after.wordpress.objects['post:7'].title, 'Test post')

  await daemon.close('test')
  const events = fs.readFileSync(daemon.trailPath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(events.at(-1).kind, 'session.end')
})

test('daemon rejects browser-origin requests from non-loopback sites', async t => {
  const root = fixture(t)
  const daemon = await startDaemon({ target: root, trailDirectory: path.join(root, 'trails'), port: 6150, watch: false })
  t.after(() => daemon.close('test'))
  const response = await fetch(`${daemon.url}/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
    body: JSON.stringify({ source: 'wp', kind: 'wp.option.updated', data: {} }),
  })
  assert.equal(response.status, 403)
  await daemon.close('test')
})
