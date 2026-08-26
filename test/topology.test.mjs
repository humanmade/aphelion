import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSiteTopology, displayChannel, FULL_FIT_PLACE_LIMIT, groupTopologyChanges, layoutSiteTopology, OVERVIEW_IDLE_EDGE_LIMIT, resolveTopologyEntity, routeContainmentElbows, routeSiteTopologyEdges, siteCardHeight, topologyRunLabel, visibleTopologyEdges } from '../src/board/topology.mjs'

const event = (seq, kind, data = {}, source = kind.startsWith('wp.') || kind.startsWith('presence.') ? 'wp' : 'agent') => ({
  v: 1,
  seq,
  ts: 1_000 + seq * 100,
  source,
  kind,
  data,
})

test('missing and explicit v1 sessions retain byte-identical topology semantics', () => {
  const observed = event(2, 'wp.post.updated', { objectType: 'post', objectId: 464, postType: 'page', title: 'Legacy page', status: 'publish', channel: 'wp-cli' })
  const missingVersion = buildSiteTopology([event(1, 'session.start', { target: 'http://localhost:8081' }, 'session'), observed])
  const explicitV1 = buildSiteTopology([event(1, 'session.start', { target: 'http://localhost:8081', topologyVersion: 1 }, 'session'), observed])
  const v2 = buildSiteTopology([event(1, 'session.start', { target: 'http://localhost:8081', topologyVersion: 2 }, 'session'), observed])

  assert.equal(JSON.stringify(missingVersion), JSON.stringify(explicitV1))
  assert.equal('topologyVersion' in missingVersion, false)
  assert.equal(v2.topologyVersion, 2)
  assert.equal(v2.nodes[0].id, missingVersion.nodes[0].id)
})

test('v2 projects stable WordPress territories and plugin sub-regions without changing place identity', () => {
  const events = [
    event(1, 'session.start', { target: 'http://localhost:8081', topologyVersion: 2 }, 'session'),
    event(2, 'wp.post.updated', { objectType: 'post', objectId: 464, postType: 'page', title: 'Pricing', channel: 'wp-cli' }),
    event(3, 'wp.option.updated', { objectType: 'option', name: 'accelerate_outbound_tracking_enabled', channel: 'wp-cli' }),
    event(4, 'wp.option.updated', { objectType: 'option', name: 'blogdescription', channel: 'wp-cli' }),
  ]
  const topology = buildSiteTopology(events)
  const byId = Object.fromEntries(topology.nodes.map(node => [node.id, node]))
  assert.equal(byId['wp:post:464'].territory, 'content')
  assert.equal(byId['wp:option:accelerate_outbound_tracking_enabled'].territory, 'plugins')
  assert.deepEqual(byId['wp:option:accelerate_outbound_tracking_enabled'].ownerPlugin, { id: 'altis-accelerate', label: 'Altis Accelerate', source: 'prefix', confidence: 'medium' })
  assert.equal(byId['wp:option:blogdescription'].territory, 'settings')
  assert.deepEqual(topology.nodes.map(node => node.id), ['wp:post:464', 'wp:option:accelerate_outbound_tracking_enabled', 'wp:option:blogdescription'])
  const layout = layoutSiteTopology(topology, { nodeW: 320, nodeH: 220, gapX: 112, gapY: 24, padX: 42, padY: 44, layoutSeed: { desktopWrapColumns: 4 } })
  assert.ok(layout.regions.some(region => region.id === 'plugin-region:altis-accelerate' && region.label === 'Altis Accelerate'))

  const reverseEvents = [events[0], events[3], events[2], events[1]]
  const reverseLayout = layoutSiteTopology(buildSiteTopology(reverseEvents), { nodeW: 320, nodeH: 220, gapX: 112, gapY: 24, padX: 42, padY: 44, layoutSeed: { desktopWrapColumns: 4 } })
  assert.deepEqual(layout.regions.filter(region => region.kind === 'territory').map(region => region.territory), ['content', 'plugins', 'settings'])
  assert.deepEqual(reverseLayout.regions.filter(region => region.kind === 'territory').map(region => region.territory), ['content', 'plugins', 'settings'])
  const positions = value => Object.fromEntries(value.nodes.filter(node => node.id !== 'wp:site').map(node => [node.id, [node.x, node.y]]))
  assert.deepEqual(positions(reverseLayout), positions(layout))
})

test('v2 containment elbows follow only observed parent relations without moving the child', () => {
  const events = [
    event(1, 'session.start', { target: 'http://localhost:8081', topologyVersion: 2 }, 'session'),
    event(2, 'wp.post.updated', { objectType: 'post', objectId: 100, postType: 'page', title: 'Parent one', status: 'publish', channel: 'wp-cli' }),
    event(3, 'wp.post.updated', { objectType: 'post', objectId: 200, postType: 'page', title: 'Parent two', status: 'publish', channel: 'wp-cli' }),
    event(4, 'wp.post.updated', { objectType: 'post', objectId: 300, postType: 'page', title: 'Child', status: 'publish', parentId: 100, channel: 'wp-cli' }),
    event(5, 'wp.post.updated', { objectType: 'post', objectId: 300, postType: 'page', title: 'Child', status: 'publish', parentId: 200, channel: 'wp-cli' }),
  ]
  const options = { blueprintEvents: events, nodeW: 320, nodeH: 220, gapX: 112, gapY: 24, padX: 42, padY: 44, layoutSeed: { desktopWrapColumns: 4 } }
  const beforeTopology = buildSiteTopology(events.slice(0, 4), { blueprintEvents: events })
  const afterTopology = buildSiteTopology(events, { blueprintEvents: events })
  const beforeLayout = layoutSiteTopology(beforeTopology, options)
  const afterLayout = layoutSiteTopology(afterTopology, options)
  const beforeChild = beforeLayout.nodes.find(node => node.id === 'wp:post:300')
  const afterChild = afterLayout.nodes.find(node => node.id === 'wp:post:300')

  assert.deepEqual(beforeTopology.containments, [{ id: 'containment:wp:post:300:wp:post:100', childId: 'wp:post:300', parentId: 'wp:post:100' }])
  assert.deepEqual(afterTopology.containments, [{ id: 'containment:wp:post:300:wp:post:200', childId: 'wp:post:300', parentId: 'wp:post:200' }])
  assert.deepEqual([afterChild.x, afterChild.y], [beforeChild.x, beforeChild.y])
  const routed = routeContainmentElbows(afterLayout.nodes, afterTopology.containments, { nodeW: 320 })
  assert.match(routed[0].path, /^M[\d.]+ [\d.]+H[\d.]+V[\d.]+H[\d.]+$/)

  const missingParent = buildSiteTopology([events[0], events[3]])
  assert.deepEqual(missingParent.containments, [])
})

test('v2 collapses consecutive cross-visit changes and compacts only playhead-dead leaves', () => {
  const events = [
    event(1, 'session.start', { target: 'http://localhost:8081', topologyVersion: 2 }, 'session'),
    event(2, 'wp.post.created', { requestId: 'create', objectType: 'post', objectId: 464, postType: 'page', title: 'Disposable page', status: 'draft', blockCount: 1, channel: 'wp-cli' }),
    event(3, 'wp.post.updated', { requestId: 'edit-a', objectType: 'post', objectId: 464, postType: 'page', title: 'Disposable page', status: 'draft', changedProperties: ['content'], channel: 'wp-cli' }),
    event(4, 'wp.post.updated', { requestId: 'edit-b', objectType: 'post', objectId: 464, postType: 'page', title: 'Disposable page', status: 'draft', changedProperties: ['content'], channel: 'wp-cli' }),
    event(5, 'wp.post.deleted', { requestId: 'delete', objectType: 'post', objectId: 464, postType: 'page', title: 'Disposable page', channel: 'wp-cli' }),
    event(6, 'wp.option.updated', { requestId: 'later', objectType: 'option', name: 'blogdescription', channel: 'wp-cli' }),
    event(7, 'session.end', {}, 'session'),
  ]
  const beforeDelete = buildSiteTopology(events.slice(0, 4), { blueprintEvents: events })
  const afterDelete = buildSiteTopology(events.slice(0, 6), { blueprintEvents: events })
  const beforePage = beforeDelete.nodes.find(node => node.id === 'wp:post:464')
  const afterPage = afterDelete.nodes.find(node => node.id === 'wp:post:464')

  assert.equal(beforePage.stateLine, 'Draft · 1 block')
  assert.equal(beforePage.sizeTier, 'standard')
  assert.equal(afterPage.stateLine, 'Deleted · 1 block')
  assert.equal(afterPage.sizeTier, 'tombstone')
  assert.equal(siteCardHeight(afterPage), 58)
  assert.equal(groupTopologyChanges(beforePage.changes).find(group => group[0].confirmation?.kind === 'wp.post.updated').length, 2)
  const options = { blueprintEvents: events, layoutSeed: { desktopWrapColumns: 4 } }
  const beforeLayout = layoutSiteTopology(beforeDelete, options)
  const afterLayout = layoutSiteTopology(afterDelete, options)
  const beforePosition = beforeLayout.nodes.find(node => node.id === 'wp:post:464')
  const afterPosition = afterLayout.nodes.find(node => node.id === 'wp:post:464')
  assert.deepEqual([afterPosition.x, afterPosition.y], [beforePosition.x, beforePosition.y])
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

test('revision and autosave cascades remain member evidence on their parent place', () => {
  const events = [
    event(1, 'session.start', { target: 'http://localhost:8081', topologyVersion: 2 }, 'session'),
    event(2, 'wp.option.updated', { requestId: 'tagline', objectType: 'option', name: 'blogdescription', channel: 'wp-cli' }),
    event(3, 'wp.option.updated', { requestId: 'accelerate', objectType: 'option', name: 'accelerate_outbound_tracking_enabled', channel: 'wp-cli' }),
    event(4, 'wp.post.created', { requestId: 'create', objectType: 'post', objectId: 476, postType: 'post', title: 'Scratch post', channel: 'wp-cli' }),
    event(5, 'wp.term.created', { requestId: 'term', objectType: 'term', objectId: 51, title: 'QA', channel: 'wp-cli' }),
    event(6, 'wp.post.updated', { requestId: 'rename', objectType: 'post', objectId: 339, postType: 'page', title: 'Home', channel: 'wp-cli' }),
    event(7, 'wp.post.updated', { requestId: 'edit', objectType: 'post', objectId: 476, postType: 'post', title: 'Scratch post', changedProperties: ['content'], channel: 'wp-cli' }),
    event(8, 'wp.post.trashed', { requestId: 'trash', objectType: 'post', objectId: 476, postType: 'post', title: 'Scratch post', channel: 'wp-cli' }),
    event(9, 'wp.post.deleted', { requestId: 'delete', objectType: 'post', objectId: 477, postType: 'revision', post_parent: 476, title: 'Scratch post', channel: 'wp-cli' }),
    event(10, 'wp.post.deleted', { requestId: 'delete', objectType: 'post', objectId: 476, postType: 'post', title: 'Scratch post', channel: 'wp-cli' }),
    event(11, 'wp.post.deleted', { requestId: 'unknown-revision', objectType: 'post', objectId: 999, postType: 'autosave', title: 'Unknown autosave', channel: 'wp-cli' }),
  ]
  const topology = buildSiteTopology(events)
  const scratch = topology.nodes.find(node => node.id === 'wp:post:476')

  assert.equal(topology.root.objectCount, 5)
  assert.equal(topology.nodes.some(node => node.id === 'wp:post:477' || node.id === 'wp:post:999'), false)
  assert.ok(scratch.history.some(item => item.kind === 'wp.post.deleted' && item.summary === 'Revision deleted'))
  assert.equal(resolveTopologyEntity(events[8]).key, 'wp:post:476')
  assert.equal(resolveTopologyEntity(events[10]), null)
})

test('semantic adapter evidence replaces its raw effect on the card without deleting either event', () => {
  const toggle = (seq, requestId) => [
    event(seq, 'wp.option.updated', { requestId, objectType: 'option', name: 'accelerate_outbound_tracking_enabled', channel: 'wp-cli' }),
    event(seq + 1, 'adapter.accelerate.changed', { requestId, objectType: 'option', name: 'accelerate_outbound_tracking_enabled', channel: 'wp-cli', adapter: 'altis-accelerate', rawKind: 'wp.option.updated', summary: 'Accelerate changed outbound tracking' }, 'adapter'),
  ]
  const place = buildSiteTopology([...toggle(1, 'toggle-on'), ...toggle(3, 'toggle-off')]).nodes[0]

  assert.equal(place.changes.length, 2)
  assert.deepEqual(place.changes.map(change => change.confirmation.kind), ['adapter.accelerate.changed', 'adapter.accelerate.changed'])
  assert.deepEqual(place.changes.map(change => change.confirmations.map(item => item.kind)), [
    ['wp.option.updated', 'adapter.accelerate.changed'],
    ['wp.option.updated', 'adapter.accelerate.changed'],
  ])
  assert.equal(groupTopologyChanges(place.changes).length, 1)
  assert.equal(groupTopologyChanges(place.changes)[0].length, 2)
  assert.deepEqual(place.history.map(item => item.kind), ['wp.option.updated', 'adapter.accelerate.changed', 'wp.option.updated', 'adapter.accelerate.changed'])
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

test('menus use owner language while WordPress counters remain root evidence', () => {
  const events = [
    event(1, 'session.start', { target: 'http://localhost:8081', topologyVersion: 2 }, 'session'),
    event(2, 'wp.term.created', { requestId: 'menu', objectType: 'term', objectId: 53, taxonomy: 'nav_menu', title: 'Primary navigation', channel: 'wp-cli' }),
    event(3, 'wp.option.updated', { requestId: 'user', objectType: 'option', name: 'user_count', channel: 'wp-cli' }),
  ]
  const topology = buildSiteTopology(events)

  assert.deepEqual(topology.nodes.map(node => node.id), ['wp:term:53'])
  assert.equal(topology.nodes[0].type, 'menu')
  assert.equal(topology.nodes[0].title, 'Primary navigation')
  assert.equal(topology.root.objectCount, 1)
  assert.deepEqual(topology.root.systemEvidence.map(item => item.kind), ['wp.option.updated'])
})

test('users are People places and comments remain evidence on their post', () => {
  const events = [
    event(1, 'session.start', { target: 'http://localhost:8081', topologyVersion: 2 }, 'session'),
    event(2, 'wp.post.updated', { requestId: 'page', objectType: 'post', objectId: 339, postType: 'page', title: 'Home', status: 'publish', channel: 'wp-cli' }),
    event(3, 'wp.user.created', { requestId: 'user', objectType: 'user', objectId: 72, displayName: 'Aphelion Reviewer', roles: ['subscriber'], channel: 'wp-cli' }),
    event(4, 'wp.user.role_changed', { requestId: 'role', objectType: 'user', objectId: 72, displayName: 'Aphelion Reviewer', role: 'editor', roles: ['editor'], channel: 'wp-cli' }),
    event(5, 'wp.comment.created', { requestId: 'comment', objectType: 'comment', objectId: 91, postId: 339, postType: 'page', postTitle: 'Home', commentStatus: 'approve', channel: 'wp-cli' }),
    event(6, 'wp.comment.status_changed', { requestId: 'comment-delete', objectType: 'comment', objectId: 91, postId: 339, postType: 'page', postTitle: 'Home', commentStatus: 'trash', channel: 'wp-cli' }),
    event(7, 'wp.comment.deleted', { requestId: 'comment-delete', objectType: 'comment', objectId: 91, postId: 339, postType: 'page', postTitle: 'Home', commentStatus: 'delete', channel: 'wp-cli' }),
    event(8, 'wp.user.deleted', { requestId: 'user-delete', objectType: 'user', objectId: 72, displayName: 'Aphelion Reviewer', roles: ['editor'], channel: 'wp-cli' }),
    event(9, 'session.end', {}, 'session'),
  ]
  const topology = buildSiteTopology(events)
  const user = topology.nodes.find(node => node.id === 'wp:user:72')
  const page = topology.nodes.find(node => node.id === 'wp:post:339')

  assert.deepEqual(topology.nodes.map(node => node.id), ['wp:post:339', 'wp:user:72'])
  assert.equal(user.title, 'Aphelion Reviewer')
  assert.equal(user.territory, 'people')
  assert.equal(user.stateLine, 'Deleted')
  assert.equal(user.sizeTier, 'tombstone')
  assert.deepEqual(user.changes.map(change => change.verb), ['Created', 'Role changed to Editor', 'Deleted'])
  assert.deepEqual(user.changes.map(change => change.confirmation.summary), ['Created', 'Role changed to Editor', 'Deleted'])
  assert.equal(page.title, 'Home')
  assert.equal(page.stateLine, 'Publish')
  assert.deepEqual(page.changes.filter(change => change.state?.memberDetail === 'comment').map(change => change.verb), ['Comment added', 'Comment removed'])
  assert.deepEqual(page.changes.find(change => change.verb === 'Comment removed').confirmations.map(item => item.kind), ['wp.comment.status_changed', 'wp.comment.deleted'])
  assert.deepEqual(page.history.filter(item => item.kind.startsWith('wp.comment.')).map(item => item.kind), ['wp.comment.created', 'wp.comment.status_changed', 'wp.comment.deleted'])
  assert.equal(topology.nodes.some(node => node.id === 'wp:comment:91'), false)
})

test('comment evidence requires observed parent identity and observer drift remains visible', () => {
  const events = [
    event(1, 'session.start', { target: 'http://localhost:8081', topologyVersion: 2 }, 'session'),
    event(2, 'wp.comment.created', { requestId: 'missing-parent', objectType: 'comment', objectId: 90, postId: 338, channel: 'wp-cli' }),
    event(3, 'wp.comment.created', { requestId: 'comment', objectType: 'comment', objectId: 91, postId: 339, postType: 'page', postTitle: 'Home', commentStatus: 'approve', channel: 'wp-cli' }),
    event(4, 'runtime.observer.version', { reportedVersion: '0.0.9', expectedVersion: '0.1.0', status: 'outdated', channel: 'wp-cli' }, 'sidecar'),
  ]
  const topology = buildSiteTopology(events)
  const page = topology.nodes.find(node => node.id === 'wp:post:339')

  assert.deepEqual(topology.nodes.map(node => node.id), ['wp:post:339'])
  assert.equal(page.title, 'Home')
  assert.equal(page.stateLine, null)
  assert.deepEqual(topology.warnings, [{
    id: 'observer-version',
    message: 'Observer out of date — some activity may not be recorded',
    expectedVersion: '0.1.0',
    reportedVersion: '0.0.9',
  }])
})

test('site flows use short orthogonal routes and enter the nearest honest face', () => {
  const events = [
    event(1, 'session.start', { target: 'http://localhost:8081', topologyVersion: 2 }, 'session'),
    event(2, 'wp.post.updated', { requestId: 'scratch', objectType: 'post', objectId: 480, postType: 'post', title: 'Scratch', channel: 'wp-cli' }),
    event(3, 'wp.post.updated', { requestId: 'home', objectType: 'post', objectId: 339, postType: 'page', title: 'Home', channel: 'wp-cli' }),
    event(4, 'wp.term.created', { requestId: 'category', objectType: 'term', objectId: 52, taxonomy: 'category', title: 'QA', channel: 'wp-cli' }),
    event(5, 'wp.option.updated', { requestId: 'plugin', objectType: 'option', name: 'accelerate_outbound_tracking_enabled', channel: 'wp-cli' }),
    event(6, 'wp.option.updated', { requestId: 'setting', objectType: 'option', name: 'blogdescription', channel: 'wp-cli' }),
  ]
  const topology = buildSiteTopology(events)
  const metrics = Object.fromEntries([topology.root, ...topology.nodes].map(node => [node.id, { h: siteCardHeight(node) }]))
  const layout = layoutSiteTopology(topology, { nodeW: 320, nodeH: 220, gapX: 112, gapY: 24, padX: 42, padY: 44, nodeHeights: Object.fromEntries(Object.entries(metrics).map(([id, value]) => [id, value.h])) })
  const routes = routeSiteTopologyEdges(layout.nodes, topology.edges, { nodeW: 320, metrics, regions: layout.regions })
  const home = routes.find(edge => edge.to === 'wp:post:339')

  assert.ok(routes.every(edge => !/[CQSA]/i.test(edge.path)))
  assert.ok(home.cornerCount <= 2)
  assert.equal(home.entryFace, 'top')
  assert.ok(routes.reduce((sum, edge) => sum + edge.segmentCount, 0) < topology.edges.length * 5)
})

test('shared cross-territory runs stay in the inter-band gutter', () => {
  const events = [
    event(1, 'session.start', { target: 'http://localhost:8081', topologyVersion: 2 }, 'session'),
    event(2, 'wp.post.updated', { requestId: 'scratch', objectType: 'post', objectId: 480, postType: 'post', title: 'Scratch', channel: 'wp-cli' }),
    event(3, 'wp.post.updated', { requestId: 'home', objectType: 'post', objectId: 339, postType: 'page', title: 'Home', channel: 'wp-cli' }),
    event(4, 'wp.comment.created', { requestId: 'comment', objectType: 'comment', objectId: 91, postId: 339, postType: 'page', postTitle: 'Home', commentStatus: 'approve', channel: 'wp-cli' }),
    event(5, 'wp.comment.status_changed', { requestId: 'comment-delete', objectType: 'comment', objectId: 91, postId: 339, postType: 'page', postTitle: 'Home', commentStatus: 'trash', channel: 'wp-cli' }),
    event(6, 'wp.comment.deleted', { requestId: 'comment-delete', objectType: 'comment', objectId: 91, postId: 339, postType: 'page', postTitle: 'Home', commentStatus: 'delete', channel: 'wp-cli' }),
    event(7, 'wp.term.created', { requestId: 'category', objectType: 'term', objectId: 52, taxonomy: 'category', title: 'QA', channel: 'wp-cli' }),
    event(8, 'wp.term.created', { requestId: 'menu', objectType: 'term', objectId: 53, taxonomy: 'nav_menu', title: 'Primary navigation', channel: 'wp-cli' }),
    event(9, 'wp.option.updated', { requestId: 'plugin', objectType: 'option', name: 'accelerate_outbound_tracking_enabled', channel: 'wp-cli' }),
    event(10, 'wp.option.updated', { requestId: 'setting', objectType: 'option', name: 'blogdescription', channel: 'wp-cli' }),
  ]
  const topology = buildSiteTopology(events)
  const graphNodes = [{ ...topology.root, changes: [] }, ...topology.nodes]
  const metrics = Object.fromEntries(graphNodes.map(node => [node.id, { h: siteCardHeight(node) }]))
  const layout = layoutSiteTopology(topology, { nodeW: 320, nodeH: 220, gapX: 112, gapY: 24, padX: 42, padY: 44, nodeHeights: Object.fromEntries(Object.entries(metrics).map(([id, value]) => [id, value.h])) })
  const routes = routeSiteTopologyEdges(layout.nodes, topology.edges, { nodeW: 320, metrics, regions: layout.regions })
  const contentRegion = layout.regions.find(region => region.territory === 'content')
  const contentBottom = contentRegion.y + contentRegion.height
  const lowerBandTop = Math.min(...layout.regions.filter(region => ['structure', 'plugins', 'settings'].includes(region.territory)).map(region => region.y))

  for (const target of ['wp:term:53', 'wp:option:accelerate_outbound_tracking_enabled', 'wp:option:blogdescription']) {
    const route = routes.find(edge => edge.to === target)
    const gutterY = Number(route.path.match(/V(-?[\d.]+)H/)[1])
    assert.ok(gutterY > contentBottom, `${target} crosses the content territory`)
    assert.ok(gutterY < lowerBandTop, `${target} misses the inter-band gutter`)
  }
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
  const awaiting = buildSiteTopology(events.slice(0, 3)).nodes[0]

  assert.equal(topology.root.identity, 'localhost:8081')
  assert.equal(topology.root.title, 'Accelerate Demo')
  assert.equal(page.id, 'wp:post:464')
  assert.equal(page.title, 'QA journey')
  assert.equal(page.stateLine, 'Trash · 4 blocks')
  assert.equal(page.lastChange.verb, 'Trashed')
  assert.equal(page.changes.length, 2)
  assert.equal(page.changes[0].id, awaiting.changes[0].id)
  assert.equal(page.stateChangeId, page.changes[1].id)
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
  assert.equal(buildSiteTopology([event(1, 'session.start', { target: 'http://localhost:8081', topologyVersion: 2 }, 'session')]).root.title, 'localhost:8081')
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

test('homogeneous change runs keep their verb while mixed runs stay generic', () => {
  const renamed = buildSiteTopology([
    event(1, 'wp.post.updated', { requestId: 'rename-a', objectType: 'post', objectId: 339, postType: 'page', title: 'Home A', changedProperties: ['title'], channel: 'wp-cli' }),
    event(2, 'wp.post.updated', { requestId: 'rename-b', objectType: 'post', objectId: 339, postType: 'page', title: 'Home B', changedProperties: ['title'], channel: 'wp-cli' }),
  ]).nodes[0]
  const mixed = buildSiteTopology([
    event(1, 'wp.post.updated', { requestId: 'rename', objectType: 'post', objectId: 339, postType: 'page', title: 'Home A', changedProperties: ['title'], channel: 'wp-cli' }),
    event(2, 'wp.post.updated', { requestId: 'content', objectType: 'post', objectId: 339, postType: 'page', title: 'Home A', changedProperties: ['content'], channel: 'wp-cli' }),
  ]).nodes[0]
  const settings = buildSiteTopology([
    event(1, 'wp.option.updated', { requestId: 'setting-a', objectType: 'option', name: 'blogdescription', channel: 'wp-cli' }),
    event(2, 'wp.option.updated', { requestId: 'setting-b', objectType: 'option', name: 'blogdescription', channel: 'wp-cli' }),
  ]).nodes[0]

  assert.equal(topologyRunLabel(groupTopologyChanges(renamed.changes)[0]), 'renames')
  assert.equal(topologyRunLabel(groupTopologyChanges(mixed.changes)[0]), 'updates')
  assert.equal(topologyRunLabel(groupTopologyChanges(settings.changes)[0]), 'updates')
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

test('v2 scale fixtures preserve nouns and coordinates while bounding overview edges', () => {
  const session = event(1, 'session.start', { target: 'http://localhost:8081', topologyVersion: 2 }, 'session')
  const placeEvents = Array.from({ length: 200 }, (_, index) => event(index + 2, 'wp.post.updated', {
    requestId: `touch-${index + 1}`,
    objectType: 'post',
    objectId: index + 1,
    postType: 'page',
    title: `Scale page ${index + 1}`,
    status: 'publish',
    channel: 'wp-cli',
  }))
  const first = buildSiteTopology([session, ...placeEvents.slice(0, 150)])
  const final = buildSiteTopology([session, ...placeEvents])
  const options = { layoutSeed: { desktopWrapColumns: 4 } }
  const firstLayout = layoutSiteTopology(first, options)
  const finalLayout = layoutSiteTopology(final, options)
  const finalPositions = new Map(finalLayout.nodes.map(node => [node.id, [node.x, node.y]]))

  assert.equal(final.nodes.length, 200)
  for (const node of firstLayout.nodes) assert.deepEqual(finalPositions.get(node.id), [node.x, node.y])
  assert.equal(FULL_FIT_PLACE_LIMIT, 24)
  const overviewEdges = visibleTopologyEdges(final.edges, final.nodes.length)
  assert.equal(overviewEdges.length, OVERVIEW_IDLE_EDGE_LIMIT)
  assert.ok(overviewEdges.some(edge => edge.current))

  const edits = Array.from({ length: 300 }, (_, index) => event(index + 2, 'wp.post.updated', {
    requestId: `edit-${index + 1}`,
    objectType: 'post',
    objectId: 464,
    postType: 'page',
    title: 'One intensely edited page',
    status: 'draft',
    changedProperties: ['content'],
    channel: 'wp-cli',
  }))
  const edited = buildSiteTopology([session, ...edits])
  assert.equal(edited.nodes.length, 1)
  assert.equal(edited.nodes[0].history.length, 300)
  assert.equal(groupTopologyChanges(edited.nodes[0].changes).length, 1)
  assert.equal(groupTopologyChanges(edited.nodes[0].changes)[0].length, 300)
})
