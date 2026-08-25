import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSiteTopology, displayChannel, layoutSiteTopology, resolveTopologyEntity } from '../src/board/topology.mjs'

const event = (seq, kind, data = {}, source = kind.startsWith('wp.') || kind.startsWith('presence.') ? 'wp' : 'agent') => ({
  v: 1,
  seq,
  ts: 1_000 + seq * 100,
  source,
  kind,
  data,
})

test('post metadata and content edits resolve onto the same durable content noun', () => {
  const meta = event(1, 'agent.action.declared', { requestId: 'seo', objectType: 'post-meta', objectId: 464, metaOwner: 'yoast', summary: 'Update SEO title' })
  const observedMeta = event(2, 'wp.post_meta.updated', { requestId: 'seo', objectType: 'post-meta', objectId: 464, metaKey: '_yoast_wpseo_title', plugin: 'yoast-seo' })
  const edit = event(3, 'agent.action.declared', { requestId: 'blocks', objectType: 'page', objectId: 464, summary: 'Edit page blocks' })
  const observedEdit = event(4, 'wp.post.updated', { requestId: 'blocks', objectType: 'post', objectId: 464, postType: 'page', title: 'QA landing page', changedProperties: ['content'] })
  const topology = buildSiteTopology([meta, observedMeta, edit, observedEdit])

  assert.equal(resolveTopologyEntity(meta).key, 'wp:post:464')
  assert.equal(resolveTopologyEntity(observedMeta).key, 'wp:post:464')
  assert.equal(buildSiteTopology([meta, edit, observedMeta]).nodes[0].title, 'Page #464')
  assert.equal(topology.nodes.length, 1)
  assert.equal(topology.nodes[0].id, 'wp:post:464')
  assert.equal(topology.nodes[0].title, 'QA landing page')
  assert.equal(topology.nodes[0].runCount, 2)
  assert.equal(topology.nodes[0].declaredCount, 2)
  assert.equal(topology.nodes[0].observedCount, 2)
  assert.deepEqual(topology.nodes[0].plugins, ['yoast-seo'])
})

test('editing and restoring one setting relights one option node and one channel edge', () => {
  const events = [
    event(1, 'agent.action.declared', { requestId: 'edit', objectType: 'option', option: 'blogdescription', channel: 'wp-cli', transport: 'docker-exec', summary: 'Temporarily edit site tagline' }),
    event(2, 'presence.open', { requestId: 'edit', connectionId: 'edit', channel: 'wp-cli', transport: 'process' }),
    event(3, 'wp.option.updated', { requestId: 'edit', objectType: 'option', name: 'blogdescription', channel: 'wp-cli', transport: 'process' }),
    event(4, 'presence.close', { requestId: 'edit', connectionId: 'edit', channel: 'wp-cli', transport: 'process' }),
    event(5, 'agent.action.declared', { requestId: 'restore', objectType: 'option', option: 'blogdescription', channel: 'wp-cli', transport: 'docker-exec', summary: 'Restore site tagline' }),
    event(6, 'presence.open', { requestId: 'restore', connectionId: 'restore', channel: 'wp-cli', transport: 'process' }),
    event(7, 'wp.option.updated', { requestId: 'restore', objectType: 'option', name: 'blogdescription', channel: 'wp-cli', transport: 'process' }),
    event(8, 'presence.close', { requestId: 'restore', connectionId: 'restore', channel: 'wp-cli', transport: 'process' }),
  ]
  const topology = buildSiteTopology(events)

  assert.equal(topology.nodes.length, 1)
  assert.equal(topology.nodes[0].id, 'wp:option:blogdescription')
  assert.equal(topology.nodes[0].title, 'Site tagline')
  assert.equal(topology.nodes[0].runCount, 2)
  assert.equal(topology.nodes[0].history.length, 4)
  assert.equal(topology.nodes[0].changes.length, 2)
  assert.equal(topology.nodes[0].changes[0].claim.summary, 'Temporarily edit site tagline')
  assert.equal(topology.nodes[0].changes[0].confirmation.kind, 'wp.option.updated')
  assert.equal(topology.nodes[0].stateLine, 'Value · changed')
  assert.equal(topology.nodes[0].lastChange.verb, 'Updated')
  assert.equal(topology.edges.length, 1)
  assert.equal(topology.edges[0].channel, 'wp-cli')
  assert.deepEqual(topology.edges[0].transports, ['docker-exec', 'process'])
  assert.equal(topology.edges[0].active, false)
  assert.equal(topology.edges[0].connected, false)
})

test('bare connection lifecycle changes edge state without creating spatial nodes', () => {
  const topology = buildSiteTopology([
    event(1, 'presence.open', { connectionId: 'orphan', channel: 'wp-cli', transport: 'process' }),
    event(2, 'presence.heartbeat', { connectionId: 'orphan', channel: 'wp-cli', transport: 'process' }),
    event(3, 'presence.close', { connectionId: 'orphan', channel: 'wp-cli', transport: 'process' }),
  ])
  assert.equal(topology.nodes.length, 0)
  assert.equal(topology.edges.length, 0)
})

test('historic WordPress bookkeeping options never become durable places', () => {
  const topology = buildSiteTopology([
    event(1, 'wp.option.updated', { objectType: 'option', name: '_transient_doing_cron', channel: 'wp-cli' }),
    event(2, 'wp.option.created', { objectType: 'option', name: 'category_children', channel: 'wp-cli' }),
    event(3, 'wp.option.updated', { objectType: 'option', name: 'blogname', channel: 'wp-cli' }),
  ])

  assert.deepEqual(topology.nodes.map(node => node.id), ['wp:option:blogname'])
  assert.deepEqual(topology.edges.map(edge => edge.to), ['wp:option:blogname'])
})

test('declared work is in flight before presence makes its reusable edge live', () => {
  const declared = event(1, 'agent.action.declared', { requestId: 'inspect', objectType: 'option', option: 'permalink_structure', channel: 'mcp', transport: 'stdio' })
  const opened = event(2, 'presence.open', { requestId: 'inspect', connectionId: 'inspect', channel: 'mcp', transport: 'stdio' })
  const beforePresence = buildSiteTopology([declared])
  const withPresence = buildSiteTopology([declared, opened])

  assert.equal(beforePresence.edges[0].active, true)
  assert.equal(beforePresence.edges[0].connected, false)
  assert.equal(beforePresence.edges[0].flowState, 'claimed')
  assert.equal(beforePresence.nodes[0].visibility, 'declared')
  assert.equal(beforePresence.nodes[0].future, false)
  assert.equal(withPresence.edges[0].active, true)
  assert.equal(withPresence.edges[0].connected, true)
  assert.equal(withPresence.edges[0].flowState, 'live')
})

test('place cards derive noun, state, last change, and history without promoting claims', () => {
  const events = [
    event(1, 'session.start', { target: 'http://localhost:8081', siteName: 'Accelerate Demo' }, 'session'),
    event(2, 'agent.action.declared', { requestId: 'page', objectType: 'page', objectId: 464, channel: 'wp-cli', transport: 'docker-exec', summary: 'Trash the page' }),
    event(3, 'presence.open', { requestId: 'page', actor: 'QA agent', channel: 'wp-cli', transport: 'process' }),
    event(4, 'wp.post.updated', { requestId: 'page', objectType: 'post', objectId: 464, postType: 'page', title: 'QA journey', status: 'trash', blockCount: 4, channel: 'wp-cli', transport: 'process' }),
    event(5, 'wp.post.trashed', { requestId: 'page', objectType: 'post', objectId: 464, title: 'QA journey', channel: 'wp-cli', transport: 'process' }),
  ]
  const topology = buildSiteTopology(events)
  const page = topology.nodes[0]

  assert.equal(topology.root.identity, 'localhost:8081')
  assert.equal(topology.root.title, 'Accelerate Demo')
  assert.equal(page.id, 'wp:post:464')
  assert.equal(page.title, 'QA journey')
  assert.equal(page.stateLine, 'Trash · 4 blocks')
  assert.equal(page.lastChange.verb, 'Trashed')
  assert.equal(page.changes.length, 2)
  assert.equal(page.changes[0].claim.summary, 'Trash the page')
  assert.equal(page.changes[0].status, 'confirmed')
  assert.equal(page.changes[1].claim.summary, 'Trash the page')
  assert.equal(displayChannel(page.lastChange.channel), 'WP-CLI')
})

test('only the latest ordered flow owns motion focus', () => {
  const topology = buildSiteTopology([
    event(1, 'agent.action.declared', { requestId: 'page', objectType: 'page', objectId: 1, channel: 'rest', summary: 'Edit page' }),
    event(2, 'agent.action.declared', { requestId: 'setting', objectType: 'option', option: 'blogdescription', channel: 'mcp', summary: 'Edit setting' }),
  ])

  assert.equal(topology.edges.filter(edge => edge.active).length, 1)
  assert.equal(topology.edges.find(edge => edge.active).channel, 'mcp')
  assert.equal(topology.edges.find(edge => edge.channel === 'rest').flowState, 'idle')
})

test('replay reserves final noun slots while reveal and state advance over stable top-left positions', () => {
  const events = [
    event(1, 'agent.action.declared', { requestId: 'page', objectType: 'page', objectId: 464, channel: 'wp-cli', summary: 'Edit the page' }),
    event(2, 'wp.post.updated', { requestId: 'page', objectType: 'post', objectId: 464, postType: 'page', title: 'QA page', channel: 'wp-cli' }),
    event(3, 'agent.action.declared', { requestId: 'setting', objectType: 'option', option: 'blogdescription', channel: 'wp-cli', summary: 'Edit the tagline' }),
    event(4, 'wp.option.updated', { requestId: 'setting', objectType: 'option', name: 'blogdescription', channel: 'wp-cli' }),
  ]
  const early = layoutSiteTopology(buildSiteTopology(events.slice(0, 1), { blueprintEvents: events }))
  const final = layoutSiteTopology(buildSiteTopology(events, { blueprintEvents: events }))

  assert.equal(early.nodes[0].x, 52)
  assert.equal(early.nodes[0].y, 72)
  assert.equal(early.nodes[1].future, false)
  assert.equal(early.nodes[1].visibility, 'declared')
  assert.equal(early.nodes[2].future, true)
  assert.deepEqual(
    early.nodes.map(node => [node.id, node.x, node.y]),
    final.nodes.map(node => [node.id, node.x, node.y]),
  )
  assert.equal(early.width, final.width)
  assert.equal(early.height, final.height)
  assert.equal(early.lanes.find(lane => lane.category === 'content').empty, false)
  assert.equal(early.lanes.find(lane => lane.category === 'settings').empty, true)
  assert.equal(early.lanes.find(lane => lane.category === 'settings').height, 24)
  assert.equal(final.lanes.find(lane => lane.category === 'settings').empty, false)
})

test('an ended claim remains a visible unconfirmed version of the same place', () => {
  const declared = event(1, 'agent.action.declared', { requestId: 'setting', objectType: 'option', option: 'blogdescription', channel: 'wp-cli', summary: 'Edit the tagline' })
  const unrelatedClose = event(2, 'presence.close', { requestId: 'another-request', channel: 'wp-cli' })
  const awaiting = buildSiteTopology([declared, unrelatedClose])
  const ended = event(3, 'session.end', {}, 'session')
  const topology = buildSiteTopology([declared, ended])

  assert.equal(awaiting.nodes[0].changes[0].status, 'in-flight')
  assert.equal(topology.nodes.length, 1)
  assert.equal(topology.nodes[0].id, 'wp:option:blogdescription')
  assert.equal(topology.nodes[0].visibility, 'unconfirmed')
  assert.equal(topology.nodes[0].future, false)
  assert.equal(topology.nodes[0].changes[0].status, 'unconfirmed')
})

test('a typed create claim is born in its final lane and gains identity on confirmation', () => {
  const events = [
    event(1, 'agent.action.declared', { requestId: 'create', objectType: 'post', channel: 'wp-cli', summary: 'Create a post' }),
    event(2, 'wp.post.created', { requestId: 'create', objectType: 'post', objectId: 468, title: 'QA post', status: 'draft', channel: 'wp-cli' }),
  ]
  const declared = buildSiteTopology(events.slice(0, 1), { blueprintEvents: events })
  const confirmed = buildSiteTopology(events, { blueprintEvents: events })
  const declaredLayout = layoutSiteTopology(declared)
  const confirmedLayout = layoutSiteTopology(confirmed)

  assert.deepEqual({ id: declared.nodes[0].id, type: declared.nodes[0].type, category: declared.nodes[0].category, title: declared.nodes[0].title, identity: declared.nodes[0].identity }, {
    id: 'wp:post:468', type: 'post', category: 'content', title: 'New post', identity: '',
  })
  assert.equal(confirmed.nodes[0].title, 'QA post')
  assert.equal(confirmed.nodes[0].identity, '468')
  assert.deepEqual(
    declaredLayout.nodes.map(node => [node.id, node.x, node.y]),
    confirmedLayout.nodes.map(node => [node.id, node.x, node.y]),
  )
})

test('deleted content and site identity remain owner-readable at the playhead', () => {
  const topology = buildSiteTopology([
    event(1, 'session.start', { target: 'http://localhost:8081' }, 'session'),
    event(2, 'runtime.site.identity', { siteName: 'Accelerate Demo' }, 'sidecar'),
    event(3, 'wp.post.deleted', { objectType: 'post', objectId: 468, title: 'QA post', blockCount: 1, channel: 'wp-cli' }),
    event(4, 'wp.post.deleted', { objectType: 'post', objectId: 469, title: 'QA post', channel: 'wp-cli' }),
  ])

  assert.equal(topology.root.title, 'Accelerate Demo')
  assert.deepEqual(topology.nodes.map(node => node.stateLine), ['Deleted · 1 block', 'Deleted'])
  assert.equal(topology.nodes.some(node => node.stateLine === 'Content'), false)
})

test('renamable places use the latest observed name at each playhead', () => {
  const events = [
    event(1, 'wp.post.updated', { objectType: 'post', objectId: 339, postType: 'page', title: 'Home', status: 'publish', changedProperties: ['title'], channel: 'wp-cli' }),
    event(2, 'wp.post.updated', { objectType: 'post', objectId: 339, postType: 'page', title: 'Home — Aphelion live run', status: 'publish', changedProperties: ['title'], channel: 'wp-cli' }),
    event(3, 'wp.post.updated', { objectType: 'post', objectId: 339, postType: 'page', title: 'Home', status: 'publish', changedProperties: ['title'], channel: 'wp-cli' }),
  ]

  assert.equal(buildSiteTopology(events.slice(0, 1)).nodes[0].title, 'Home')
  assert.equal(buildSiteTopology(events.slice(0, 2)).nodes[0].title, 'Home — Aphelion live run')
  const restored = buildSiteTopology(events)
  assert.equal(restored.nodes[0].title, 'Home')
  assert.deepEqual(restored.nodes[0].changes.map(change => change.state.title), ['Home', 'Home — Aphelion live run', 'Home'])
  assert.deepEqual(restored.nodes[0].changes.map(change => change.verb), ['Renamed', 'Renamed', 'Renamed'])
})

test('title and name changes use rename verbs without changing other updates', () => {
  const declaration = event(1, 'agent.action.declared', { requestId: 'rename', objectType: 'page', objectId: 339, changedProperties: ['title'], summary: 'Update the page title', channel: 'wp-cli' })
  const renamed = event(2, 'wp.post.updated', { requestId: 'rename', objectType: 'post', objectId: 339, postType: 'page', title: 'Home — Aphelion live run', changedProperties: ['title'], channel: 'wp-cli' })
  const updated = event(3, 'wp.post.updated', { requestId: 'content', objectType: 'post', objectId: 339, postType: 'page', title: 'Home — Aphelion live run', changedProperties: ['content'], channel: 'wp-cli' })

  assert.equal(buildSiteTopology([declaration]).nodes[0].changes[0].verb, 'Renaming…')
  assert.deepEqual(buildSiteTopology([declaration, renamed, updated]).nodes[0].changes.map(change => change.verb), ['Renamed', 'Updated'])
})

test('desktop site layout uses append-stable category lanes', () => {
  const events = []
  for (let index = 0; index < 20; index++) {
    events.push(event(index + 1, 'wp.post.updated', { objectType: 'post', objectId: index + 1, postType: 'page', title: `Page ${index + 1}`, channel: 'wp-cli' }))
  }
  const layoutSeed = { desktopWrapColumns: 4 }
  const first = layoutSiteTopology(buildSiteTopology(events.slice(0, 18)), { layoutSeed })
  const final = layoutSiteTopology(buildSiteTopology(events), { layoutSeed })
  const compact = layoutSiteTopology(buildSiteTopology(events), { compact: true, layoutSeed })
  const finalPositions = new Map(final.nodes.map(node => [node.id, `${node.x}:${node.y}`]))
  const content = final.nodes.slice(1)

  assert.equal(final.lanes.length, 1)
  assert.equal(new Set(content.map(node => node.x)).size, 4)
  assert.equal(new Set(content.map(node => node.y)).size, 5)
  for (const node of first.nodes) assert.equal(`${node.x}:${node.y}`, finalPositions.get(node.id))
  assert.deepEqual(compact.lanes.map(lane => [lane.category, lane.compact]), [['content', true]])
})
