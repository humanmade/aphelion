import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { adaptAccelerateEvent, projectEvents, readTrail, startDaemon } from '../src/index.mjs'
import { buildSiteTopology } from '../src/board/topology.mjs'
import { SHIPPED_OBSERVER_VERSION } from '../src/observer/version.mjs'
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
  assert.match(php, /APHELION_AUDIT_OBSERVER_VERSION/)
  assert.match(php, /'observerVersion'\s*=>\s*APHELION_AUDIT_OBSERVER_VERSION/)
  assert.equal(php.match(/define\( 'APHELION_AUDIT_OBSERVER_VERSION', '([^']+)' \)/)?.[1], SHIPPED_OBSERVER_VERSION)
  assert.match(php, /pre_post_update/)
  assert.match(php, /add_action\( 'pre_post_update', \[ \$this, 'post_before_update' \], 10, 2 \)/)
  assert.match(php, /function post_before_update\( int \$post_id, array \$data \)/)
  assert.match(php, /blockChanges/)
  assert.match(php, /_yoast_wpseo_/)
  assert.match(php, /wp_after_execute_ability/)
  assert.match(php, /wp_ability_invoked/)
  assert.match(php, /add_action\( 'user_register', \[ \$this, 'user_created' \], 10, 2 \)/)
  assert.match(php, /add_action\( 'deleted_user', \[ \$this, 'user_deleted' \], 10, 3 \)/)
  assert.match(php, /add_action\( 'set_user_role', \[ \$this, 'user_role_changed' \], 10, 3 \)/)
  assert.match(php, /add_action\( 'wp_insert_comment', \[ \$this, 'comment_created' \], 10, 2 \)/)
  assert.match(php, /add_action\( 'transition_comment_status', \[ \$this, 'comment_status_changed' \], 10, 3 \)/)
  assert.match(php, /add_action\( 'deleted_comment', \[ \$this, 'comment_deleted' \], 10, 2 \)/)
  assert.match(php, /get_post\( \(int\) \$comment->comment_post_ID \)/)
  assert.match(php, /'postType'\s*=>/)
  assert.match(php, /'postTitle'\s*=>/)
  assert.doesNotMatch(php, /user_email|user_pass|comment_content|comment_author_email|comment_author_IP/)
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
    "if (process.argv.includes('eval')) { process.stdout.write('0.1.0'); process.exit(0) }",
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
  assert.ok(events.some(event => event.kind === 'runtime.site.identity' && event.data.siteName === 'aphelion-test-v1'))
  assert.equal(changed.data.changed, true)
  assert.match(changed.data.beforeFingerprint, /^[a-f0-9]{16}$/)
  assert.match(changed.data.afterFingerprint, /^[a-f0-9]{16}$/)
  assert.equal('value' in changed.data, false)
})

test('WP-CLI sidecar re-observes site identity after idle session rotation', async t => {
  const root = temporary(t)
  const script = [
    "if (process.argv.includes('eval')) { process.stdout.write('0.1.0'); process.exit(0) }",
    "const name = process.argv[process.argv.indexOf('get') + 1]",
    "process.stdout.write(JSON.stringify(name === 'blogname' ? 'Accelerate Demo' : 'stable'))",
  ].join(';')
  const daemon = await startDaemon({
    target: 'http://localhost:8081',
    targetType: 'site',
    trailDirectory: path.join(root, 'trails'),
    wpCommand: [process.execPath, '-e', script, '--'],
    sidecarInterval: 500,
    idleTimeoutMs: 1_500,
    port: 6200,
    watch: false,
  })
  t.after(() => daemon.close('test-cleanup'))

  const firstPath = daemon.trailPath
  await waitForTrailEvent(firstPath, event => event.kind === 'runtime.site.identity', 'the first site identity')
  await waitForTrailEvent(firstPath, event => event.kind === 'session.end', 'the idle session end')

  const action = daemon.emit('wp', 'wp.option.updated', { requestId: 'after-rotation', objectType: 'option', name: 'blogdescription', channel: 'wp-cli' })
  assert.ok(action)
  assert.notEqual(daemon.trailPath, firstPath)
  const secondPath = daemon.trailPath
  await waitForTrailEvent(secondPath, event => event.kind === 'runtime.site.identity', 'the rotated session site identity')
  const secondEvents = await readTrail(secondPath)

  assert.equal(buildSiteTopology(secondEvents).root.title, 'Accelerate Demo')
  assert.ok(secondEvents.some(event => event.kind === 'runtime.site.identity' && event.source === 'sidecar'))
  await daemon.close('test')
})

test('WP-CLI sidecar records and warns when the shipped observer is out of date', async t => {
  const root = temporary(t)
  const warnings = []
  const script = [
    "if (process.argv.includes('eval')) { process.stdout.write('0.0.9'); process.exit(0) }",
    "const name = process.argv[process.argv.indexOf('get') + 1]",
    "process.stdout.write(JSON.stringify(name === 'blogname' ? 'Accelerate Demo' : 'stable'))",
  ].join(';')
  const daemon = await startDaemon({
    target: 'http://localhost:8081',
    targetType: 'site',
    trailDirectory: path.join(root, 'trails'),
    wpCommand: [process.execPath, '-e', script, '--'],
    sidecarInterval: 250,
    warn: message => warnings.push(message),
    port: 6201,
    watch: false,
  })
  t.after(() => daemon.close('test-cleanup'))

  const observed = await waitForTrailEvent(
    daemon.trailPath,
    event => event.kind === 'runtime.observer.version',
    'the observer version handshake',
  )

  assert.equal(observed.data.reportedVersion, '0.0.9')
  assert.equal(observed.data.expectedVersion, '0.1.0')
  assert.equal(observed.data.status, 'outdated')
  assert.ok(warnings.some(message => message.includes('observer out of date') && message.includes('some activity may not be recorded')))
  await daemon.close('test')
})

test('fixture catalogue covers the requested WordPress journeys', () => {
  assert.deepEqual(Object.keys(wordpressJourneys), [
    'blockPageEdit', 'settingsRestore', 'yoastMetadata', 'connectorLifecycle', 'abilities', 'wpCliEdit',
  ])
  assert.ok(journeyEvents().length >= 30)
})
