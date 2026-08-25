import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { adaptAccelerateEvent, projectEvents, readTrail, startDaemon } from '../src/index.mjs'
import { journeyEvents, wordpressJourneys } from './fixtures/wordpress-journeys.mjs'

function sequenced(events) {
  return events.map((event, index) => ({ ...event, seq: index + 1 }))
}

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-wp-journeys-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

async function waitForTrailEvent(trailPath, predicate, description, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const events = await readTrail(trailPath)
    const event = events.find(predicate)
    if (event) return event
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

test('block/page journeys retain block property subchanges without content values', () => {
  const projection = projectEvents(sequenced(wordpressJourneys.blockPageEdit.events))
  const action = projection.wordpress.actions.find(item => item.kind === 'wp.post.updated')
  assert.equal(action.postType, 'page')
  assert.deepEqual(action.changedProperties, ['content'])
  assert.deepEqual(action.blockChanges, [
    { path: '0.0', name: 'core/paragraph', change: 'updated', properties: ['content'] },
    { path: '0.1', name: 'core/image', change: 'added', properties: ['url', 'alt'] },
  ])
  assert.equal('postContent' in action, false)
  assert.equal('attributes' in action, false)
  assert.equal(projection.journeys['block-edit-1'].effectLatencyMs, 100)
  assert.equal(projection.journeys['block-edit-1'].captureLagMs, 7)
})

test('settings journeys show a reversible option edit without storing values', () => {
  const projection = projectEvents(sequenced(wordpressJourneys.settingsRestore.events))
  const actions = projection.wordpress.actions.filter(item => item.kind === 'wp.option.updated')
  assert.equal(actions.length, 2)
  assert.equal(actions[0].name, 'aphelion_test_show_on_front')
  assert.equal(actions[0].restored, true)
  assert.equal(actions[1].changed, true)
  for (const action of actions) {
    assert.equal('value' in action, false)
    assert.equal('beforeValue' in action, false)
    assert.equal('afterValue' in action, false)
  }
  const connection = projection.connections['cli:cli-settings-1']
  assert.equal(connection.channel, 'wp-cli')
  assert.equal(connection.transport, 'docker-exec')
  assert.equal(connection.active, false)
})

test('Yoast-style metadata is attributed to its plugin namespace, not its value', () => {
  const projection = projectEvents(sequenced(wordpressJourneys.yoastMetadata.events))
  const actions = projection.wordpress.actions.filter(item => item.kind === 'wp.post_meta.updated')
  assert.equal(actions.length, 2)
  assert.deepEqual(actions.map(item => item.plugin), ['yoast-seo', 'yoast-seo'])
  assert.deepEqual(actions.map(item => item.metaFamily), ['seo', 'seo'])
  assert.deepEqual(actions.map(item => item.metaKey), ['_yoast_wpseo_metadesc', '_yoast_wpseo_title'])
  assert.ok(actions.every(item => !('value' in item) && !('content' in item)))
})

test('connector lifecycle preserves channel, transport, and recovery timing independently', () => {
  const projection = projectEvents(sequenced(wordpressJourneys.connectorLifecycle.events))
  const rest = projection.connections['wp:rest-lifecycle-1']
  const cli = projection.connections['wp:cli-lifecycle-1']
  assert.equal(rest.channel, 'rest')
  assert.equal(rest.transport, 'http')
  assert.equal(rest.phase, 'close')
  assert.equal(rest.active, false)
  assert.equal(rest.lastSeenAt - rest.openedAt, 1_540)
  assert.equal(cli.channel, 'wp-cli')
  assert.equal(cli.transport, 'ssh')
  assert.equal(cli.lastSeenAt - cli.openedAt, 600)
  const restPhases = projection.recent.filter(item => item.data?.connectionId === 'rest-lifecycle-1').map(item => item.kind)
  assert.deepEqual(restPhases.reverse(), [
    'presence.open', 'presence.ready', 'presence.heartbeat', 'presence.error',
    'presence.reconnect', 'presence.ready', 'presence.disconnect', 'presence.close',
  ])
})

test('generic MCP/Abilities journey keeps declared call and official execution separate', () => {
  const projection = projectEvents(sequenced(wordpressJourneys.abilities.events))
  const journey = projection.journeys['ability-1']
  assert.deepEqual(journey.phases.map(phase => phase.kind), [
    'presence.ready', 'mcp.ability.call', 'wp.ability.invoked', 'wp.ability.executed', 'presence.close',
  ])
  assert.equal(journey.effectLatencyMs, 35)
  assert.equal(journey.channel, 'mcp')
  assert.equal(journey.transport, 'stdio')
  assert.equal(projection.wordpress.actions.some(item => item.kind.startsWith('adapter.accelerate.')), false)
})

test('WP-CLI Docker execution stays distinct from SSH and keeps command family context', () => {
  const projection = projectEvents(sequenced(wordpressJourneys.wpCliEdit.events))
  const declaration = projection.activity.find(item => item.kind === 'cli.command.declared')
  const effect = projection.wordpress.actions.find(item => item.kind === 'wp.post.updated')
  assert.equal(declaration.channel, 'wp-cli')
  assert.equal(declaration.transport, 'docker-exec')
  assert.equal(declaration.commandFamily, 'post update')
  assert.equal(effect.transport, 'docker-exec')
  assert.equal(effect.channel, 'wp-cli')
  assert.equal(effect.title, 'aphelion-test-cli-post')
})

test('Accelerate adapter adds semantic meaning while retaining the raw WordPress effect', () => {
  const raw = sequenced(wordpressJourneys.yoastMetadata.events).at(-1)
  const accelerate = {
    ...raw,
    data: {
      ...raw.data,
      metaKey: '_altis_ab_test_titles_variants',
      title: 'aphelion-test landing page',
    },
  }
  const adapted = adaptAccelerateEvent(accelerate)
  assert.equal(adapted.kind, 'adapter.accelerate.updated_variants_for')
  assert.equal(adapted.data.rawKind, 'wp.post_meta.updated')
  assert.equal(adapted.data.adapter, 'altis-accelerate')
  assert.equal(adapted.data.objectId, 301)
})

test('audit mu-plugin remains an observer and exposes the WordPress context needed by fixtures', () => {
  const php = fs.readFileSync(new URL('../src/mu-plugin/aphelion-audit.php', import.meta.url), 'utf8')
  assert.match(php, /pre_post_update/)
  assert.match(php, /add_action\( 'pre_post_update', \[ \$this, 'post_before_update' \], 10, 2 \)/)
  assert.match(php, /function post_before_update\( int \$post_id, array \$data \)/)
  assert.match(php, /blockChanges/)
  assert.match(php, /_yoast_wpseo_/)
  assert.match(php, /wp_after_execute_ability/)
  assert.match(php, /wp_ability_invoked/)
  assert.doesNotMatch(php, /\b(?:wp_insert_post|wp_update_post|update_option|delete_option)\s*\(/)
})

test('WP-CLI sidecar retries after disconnect and fingerprints settings instead of recording values', async t => {
  const root = temporary(t)
  const auditLog = path.join(root, 'audit.jsonl')
  const marker = path.join(root, 'wp-cli-ready')
  const script = [
    "const fs = require('node:fs')",
    "const marker = process.env.APHELION_FAKE_WP_MARKER",
    "if (!process.argv.some(arg => arg.includes('APHELION_OBSERVER_PROBE'))) { console.error('observer probe marker missing'); process.exit(2) }",
    "if (!marker || !fs.existsSync(marker)) { console.error('fixture disconnected'); process.exit(1) }",
    "const value = fs.readFileSync(marker, 'utf8').trim()",
    "const name = process.argv[process.argv.indexOf('get') + 1]",
    "process.stdout.write(JSON.stringify(name === 'blogname' ? value : 'stable'))",
  ].join(';')
  fs.writeFileSync(auditLog, '')
  const previousMarker = process.env.APHELION_FAKE_WP_MARKER
  process.env.APHELION_FAKE_WP_MARKER = marker
  t.after(() => {
    if (previousMarker === undefined) delete process.env.APHELION_FAKE_WP_MARKER
    else process.env.APHELION_FAKE_WP_MARKER = previousMarker
  })
  const daemon = await startDaemon({
    target: root,
    trailDirectory: path.join(root, 'trails'),
    auditLog,
    wpCommand: [process.execPath, '-e', script, '--'],
    wpTransport: 'docker-exec',
    sidecarInterval: 500,
    port: 6190,
    watch: false,
  })
  t.after(() => daemon.close('test-cleanup'))

  await waitForTrailEvent(
    daemon.trailPath,
    event => event.kind === 'presence.error' && event.data.channel === 'wp-cli',
    'the initial WP-CLI disconnect',
  )
  fs.writeFileSync(marker, 'aphelion-test-v1')
  await waitForTrailEvent(
    daemon.trailPath,
    event => event.kind === 'runtime.baseline' && event.data.optionNames.includes('blogname'),
    'the first WordPress runtime baseline',
  )
  fs.writeFileSync(marker, 'aphelion-test-v2')
  const changed = await waitForTrailEvent(
    daemon.trailPath,
    event => event.kind === 'runtime.option.changed' && event.data.name === 'blogname',
    'the blogname fingerprint change',
  )
  await daemon.close('test')

  const events = await readTrail(daemon.trailPath)
  assert.ok(events.some(event => event.kind === 'presence.error' && event.data.channel === 'wp-cli'))
  assert.ok(events.some(event => event.kind === 'presence.reconnect' && event.data.transport === 'docker-exec'))
  assert.ok(events.some(event => event.kind === 'presence.ready' && event.data.channel === 'wp-cli'))
  assert.equal(events.filter(event => event.source === 'sidecar' && event.kind === 'presence.heartbeat').length, 0)
  assert.ok(events.some(event => event.kind === 'runtime.baseline' && event.data.optionNames.includes('blogname')))
  assert.equal(changed.data.changed, true)
  assert.match(changed.data.beforeFingerprint, /^[a-f0-9]{16}$/)
  assert.match(changed.data.afterFingerprint, /^[a-f0-9]{16}$/)
  assert.equal('value' in changed.data, false)
})

test('fixture catalogue covers the requested WordPress journeys', () => {
  assert.deepEqual(Object.keys(wordpressJourneys), [
    'blockPageEdit', 'settingsRestore', 'yoastMetadata', 'connectorLifecycle', 'abilities', 'wpCliEdit',
  ])
  assert.ok(journeyEvents().length >= 30)
})
