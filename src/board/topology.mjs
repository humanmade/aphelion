// Site-entity projection: trail events resolve onto durable WordPress nouns.

const TERMINAL_PHASES = new Set(['close', 'disconnect', 'error', 'timeout'])
const DECLARED_KINDS = /(?:\.call|\.declared)$/
const CORE_OPTIONS = {
  blogdescription: 'Site tagline',
  blogname: 'Site title',
  page_for_posts: 'Posts page',
  page_on_front: 'Homepage',
  show_on_front: 'Homepage display',
}
const BOOKKEEPING_OPTIONS = new Set(['cron', 'category_children', 'rewrite_rules', 'recently_edited'])

const text = value => String(value ?? '').trim()
const isBookkeepingOption = value => {
  const name = text(value)
  return name.startsWith('_transient_') || name.startsWith('_site_transient_') || BOOKKEEPING_OPTIONS.has(name)
}
const titleCase = value => text(value)
  .replace(/^_+/, '')
  .replace(/^yoast_wpseo_/, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[-_./]+/g, ' ')
  .replace(/\b\w/g, character => character.toUpperCase())
  .replace(/\b(?:Seo|Wp|Cli|Mcp)\b/g, word => ({ Seo: 'SEO', Wp: 'WP', Cli: 'CLI', Mcp: 'MCP' })[word])

export function topologyEventClass(event) {
  if (!event?.kind) return null
  if (event.kind.startsWith('presence.')) return 'presence'
  if (event.kind.startsWith('tool.') || DECLARED_KINDS.test(event.kind) || event.kind.startsWith('plan.')) return 'declared'
  if (event.kind.startsWith('file.') || event.kind.startsWith('wp.') || event.kind.startsWith('adapter.') || event.kind.startsWith('runtime.')) return 'observed'
  return null
}

function entityLabel(type, identity, data) {
  if (type === 'option') return CORE_OPTIONS[identity] || titleCase(identity)
  if (type === 'ability') return titleCase(identity)
  if (type === 'plugin') return titleCase(identity)
  if (type === 'route') return text(data.route || identity)
  if (data.title) return text(data.title)
  if (type === 'page') return `Page #${identity}`
  if (type === 'post') return `Post #${identity}`
  return `${titleCase(type)} #${identity}`
}

function provisionalEntity(key, event) {
  const data = event?.data || {}
  const rawType = text(data.objectType || data.type).toLowerCase().replaceAll('_', '-')
  if (!rawType) return null
  const type = rawType === 'post-meta' || rawType === 'postmeta'
    ? data.postType === 'page' ? 'page' : 'post'
    : rawType === 'post' && data.postType === 'page' ? 'page' : rawType
  const category = ['page', 'post'].includes(type)
    ? 'content'
    : type === 'option'
      ? 'settings'
      : type === 'ability'
        ? 'abilities'
        : type === 'plugin'
          ? 'plugins'
          : type === 'route'
            ? 'interfaces'
            : 'objects'
  const noun = type === 'option' ? 'setting' : type
  return {
    key,
    identity: '',
    type,
    category,
    title: `New ${noun}`,
    plugin: data.plugin || null,
    provisionalIdentity: true,
  }
}

export function resolveTopologyEntity(event) {
  const data = event?.data || {}
  const rawType = text(data.objectType || data.type).toLowerCase().replaceAll('_', '-')
  const objectId = data.objectId ?? data.id

  if (objectId !== undefined && objectId !== null && ['page', 'post', 'post-meta', 'postmeta'].includes(rawType)) {
    const type = rawType === 'page' || data.postType === 'page' ? 'page' : rawType === 'post' && data.postType !== 'page' ? 'post' : 'content'
    return {
      key: `wp:post:${objectId}`,
      identity: String(objectId),
      type,
      category: 'content',
      title: entityLabel(type, objectId, data),
      plugin: data.plugin || null,
    }
  }

  const optionName = data.option || (rawType === 'option' ? data.name ?? data.id : null)
  if (optionName !== undefined && optionName !== null && text(optionName)) {
    if (isBookkeepingOption(optionName)) return null
    return {
      key: `wp:option:${text(optionName)}`,
      identity: text(optionName),
      type: 'option',
      category: 'settings',
      title: entityLabel('option', optionName, data),
      plugin: data.plugin || null,
    }
  }

  if (data.ability) {
    return {
      key: `wp:ability:${text(data.ability)}`,
      identity: text(data.ability),
      type: 'ability',
      category: 'abilities',
      title: entityLabel('ability', data.ability, data),
      plugin: data.plugin || null,
    }
  }

  if (data.plugin && !objectId) {
    return {
      key: `wp:plugin:${text(data.plugin)}`,
      identity: text(data.plugin),
      type: 'plugin',
      category: 'plugins',
      title: entityLabel('plugin', data.plugin, data),
      plugin: text(data.plugin),
    }
  }

  if (data.route && event.kind.startsWith('wp.rest.')) {
    const identity = `${text(data.method || 'request').toLowerCase()}:${text(data.route)}`
    return {
      key: `wp:route:${identity}`,
      identity,
      type: 'route',
      category: 'interfaces',
      title: entityLabel('route', identity, data),
      plugin: null,
    }
  }

  if (objectId !== undefined && objectId !== null && rawType) {
    return {
      key: `wp:${rawType}:${objectId}`,
      identity: String(objectId),
      type: rawType,
      category: 'objects',
      title: entityLabel(rawType, objectId, data),
      plugin: data.plugin || null,
    }
  }

  return null
}

function requestId(event) {
  return event?.data?.requestId || event?.data?.correlationId || null
}

function channel(event) {
  return text(event?.data?.channel || event?.source || 'unknown')
}

export function displayChannel(value) {
  const normalized = text(value).toLowerCase()
  return ({
    'wp-cli': 'WP-CLI',
    rest: 'REST',
    mcp: 'MCP',
    'wp-admin': 'wp-admin',
    runtime: 'Runtime',
    cron: 'Cron',
  })[normalized] || titleCase(value)
}

function transport(event) {
  return text(event?.data?.transport || 'transport unknown')
}

function actor(event) {
  const value = event?.data?.actor
  if (typeof value === 'string') return text(value) || null
  if (text(value?.login || value?.name)) return text(value.login || value.name)
  return Number(value?.id) > 0 ? `User #${value.id}` : null
}

function eventSummary(event) {
  const data = event.data || {}
  if (data.summary) return text(data.summary)
  if (event.kind.startsWith('wp.post_meta.')) return `${data.plugin ? `${titleCase(data.plugin)} ` : ''}metadata ${event.kind.split('.').at(-1)}`
  if (event.kind.startsWith('wp.post.')) return `${data.postType === 'page' ? 'Page' : 'Post'} ${event.kind.split('.').at(-1)}`
  if (event.kind.startsWith('wp.option.')) return `Setting ${event.kind.split('.').at(-1)}`
  if (event.kind.startsWith('wp.ability.')) return `Ability ${event.kind.split('.').at(-1)}`
  return event.kind.replaceAll('.', ' ')
}

function observedVerb(event) {
  const action = event.kind.split('.').at(-1)
  return ({
    created: 'Created',
    deleted: 'Deleted',
    executed: 'Executed',
    restored: 'Restored',
    trashed: 'Trashed',
    updated: 'Updated',
    changed: 'Changed',
  })[action] || titleCase(action)
}

function claimedVerb(event) {
  if (event.kind.endsWith('.call')) return 'Calling…'
  const first = eventSummary(event).split(/\s+/)[0]?.toLowerCase()
  return ({
    change: 'Changing…',
    create: 'Creating…',
    delete: 'Deleting…',
    edit: 'Editing…',
    inspect: 'Inspecting…',
    restore: 'Restoring…',
    set: 'Setting…',
    trash: 'Trashing…',
    update: 'Updating…',
  })[first] || 'Changing…'
}

function stateData(event) {
  const data = event.data || {}
  return {
    title: text(data.title || data.displayName || data.objectName) || null,
    status: data.status || null,
    blockCount: Number.isFinite(data.blockCount) ? data.blockCount : null,
    restored: data.restored === true,
    beforeType: data.beforeType || null,
    afterType: data.afterType || data.valueType || null,
    metaKey: data.metaKey || null,
  }
}

function changeRecords(history, sessionEnded = false) {
  const claims = new Map()
  const openClaims = new Map()
  const changes = []

  for (const item of history) {
    const id = item.requestId || `seq:${item.seq}`
    if (item.class === 'declared') {
      const claim = {
        seq: item.seq,
        ts: item.ts,
        summary: item.summary,
        channel: item.channel,
        transport: item.transport,
        actor: item.actor,
      }
      claims.set(id, claim)
      const record = {
        id: `change:${id}:claim:${item.seq}`,
        requestId: item.requestId,
        claim,
        confirmation: null,
        verb: claimedVerb(item),
        status: 'in-flight',
        seq: item.seq,
        ts: item.ts,
        channel: item.channel,
        actor: item.actor,
        transport: item.transport,
        state: item.state,
      }
      changes.push(record)
      openClaims.set(id, record)
      continue
    }
    if (item.class !== 'observed') continue

    const claim = claims.get(id) || null
    const open = openClaims.get(id)
    const confirmation = {
      seq: item.seq,
      ts: item.ts,
      summary: item.summary,
      kind: item.kind,
      channel: item.channel,
      transport: item.transport,
      actor: item.actor,
      state: item.state,
    }
    if (open && !open.confirmation) {
      Object.assign(open, {
        confirmation,
        verb: observedVerb(item),
        status: 'confirmed',
        seq: item.seq,
        ts: item.ts,
        channel: item.channel || open.channel,
        actor: item.actor || open.actor,
        transport: item.transport || open.transport,
        state: item.state,
      })
      openClaims.delete(id)
    } else {
      changes.push({
        id: `change:${id}:effect:${item.seq}`,
        requestId: item.requestId,
        claim,
        confirmation,
        verb: observedVerb(item),
        status: 'confirmed',
        seq: item.seq,
        ts: item.ts,
        channel: item.channel || claim?.channel || 'unknown',
        actor: item.actor || claim?.actor || null,
        transport: item.transport || claim?.transport || 'transport unknown',
        state: item.state,
      })
    }
  }

  for (const change of changes) {
    if (change.confirmation) continue
    change.status = sessionEnded ? 'unconfirmed' : 'in-flight'
  }
  return changes
}

function placeState(entity, changes) {
  const confirmations = changes.filter(change => change.confirmation)
  const latest = confirmations.at(-1)
  const relevant = confirmations.map(change => change.state).filter(Boolean)
  const latestStatus = [...relevant].reverse().find(state => state.status)?.status
  const blockCount = [...relevant].reverse().find(state => state.blockCount !== null)?.blockCount

  if (['page', 'post', 'content'].includes(entity.type)) {
    const latestKind = latest?.confirmation?.kind || ''
    const state = latestKind.endsWith('.deleted')
      ? 'Deleted'
      : latestKind.endsWith('.trashed')
        ? 'Trash'
        : latestStatus
          ? titleCase(latestStatus)
          : latestKind.endsWith('.created')
            ? 'Created'
            : latestKind.endsWith('.updated')
              ? 'Updated'
              : null
    const parts = state ? [state] : []
    if (blockCount !== undefined && blockCount !== null) parts.push(`${blockCount} ${blockCount === 1 ? 'block' : 'blocks'}`)
    return parts.join(' · ') || null
  }
  if (entity.type === 'option') {
    const state = latest?.state || {}
    const type = ({ string: 'Text value', integer: 'Number', number: 'Number', boolean: 'Boolean' })[state.afterType] || 'Value'
    return `${type} · ${state.restored ? 'restored' : latest ? 'changed' : 'unchanged'}`
  }
  if (entity.type === 'plugin') return `${confirmations.length} confirmed ${confirmations.length === 1 ? 'change' : 'changes'}`
  if (entity.category === 'abilities') return confirmations.length ? `${confirmations.length} ${confirmations.length === 1 ? 'invocation' : 'invocations'}` : 'No confirmed invocations'
}

function mergeEntity(previous, incoming) {
  if (!previous) return { ...incoming }
  const canRefineType = ['object', 'content'].includes(previous.type) && !['object', 'content'].includes(incoming.type)
  const nextType = canRefineType ? incoming.type : previous.type
  const genericTitle = entity => entity.title === entity.identity || /^(?:Content|Page|Post) #\d+$/.test(entity.title) || /^New\s/i.test(entity.title)
  const canRefineTitle = genericTitle(previous) && (canRefineType || !genericTitle(incoming))
  return {
    ...previous,
    identity: previous.identity || incoming.identity,
    type: nextType,
    category: incoming.category || previous.category,
    title: canRefineTitle && incoming.title ? incoming.title : previous.title,
    plugin: incoming.plugin || previous.plugin || null,
    provisionalIdentity: previous.provisionalIdentity && !incoming.identity,
  }
}

function buildRequestTargets(events) {
  const targets = new Map()
  for (const event of events) {
    if (topologyEventClass(event) === 'presence') continue
    const id = requestId(event)
    const entity = resolveTopologyEntity(event)
    if (!id || !entity) continue
    const list = targets.get(id) || []
    if (!list.includes(entity.key)) list.push(entity.key)
    targets.set(id, list)
  }
  return targets
}

function targetsForEvent(event, requestTargets) {
  const direct = resolveTopologyEntity(event)
  if (direct) return [direct.key]
  return requestTargets.get(requestId(event)) || []
}

function propertyRows(event, classification) {
  const data = event.data || {}
  const rows = []
  const add = (key, label, value) => {
    const rendered = text(value)
    if (rendered) rows.push({ key, label, value: rendered, seq: event.seq })
  }

  if (classification === 'declared') add(`intent:${requestId(event) || event.seq}`, 'Intent', eventSummary(event))
  if (data.metaKey) add(`meta:${data.metaKey}`, data.plugin ? titleCase(data.plugin) : 'Metadata', `${titleCase(data.metaKey)} · ${event.kind.split('.').at(-1)}`)
  for (const change of data.blockChanges || []) for (const property of change.properties || []) {
    add(`block:${change.path}:${change.name}:${property}`, titleCase(change.name?.replace(/^core\//, '') || 'Block'), `${titleCase(property)} · ${change.change || 'updated'}`)
  }
  for (const property of data.changedProperties || []) add(`property:${property}`, 'Property', `${titleCase(property)} · changed`)
  if (data.restored) add(`restored:${event.seq}`, 'Setting', 'Restored to its prior state')
  else if (classification === 'observed' && event.kind.startsWith('wp.option.')) add(`option:${event.kind}`, 'Setting', titleCase(event.kind.split('.').at(-1)))
  if (data.status) add(`status:${data.status}`, 'Status', titleCase(data.status))
  if (data.blockCount !== undefined) add('blocks:count', 'Blocks', `${data.blockCount} recorded`)
  if (classification === 'observed' && !rows.length) add(`effect:${event.kind}`, 'Observed', eventSummary(event))
  return rows
}

function analyze(events, requestTargets) {
  const entities = new Map()
  const entityOrder = []
  const edges = new Map()
  const requestStates = new Map()
  let currentTargets = []
  let currentEdgeKey = null

  const ensureEntity = (key, event) => {
    const direct = resolveTopologyEntity(event)
    const previous = entities.get(key)
    const fallback = direct || provisionalEntity(key, event) || { key, identity: key.split(':').at(-1), type: 'object', category: 'objects', title: titleCase(key.split(':').at(-1)), plugin: null }
    if (!previous) {
      entityOrder.push(key)
      entities.set(key, {
        ...fallback,
        firstSeq: event.seq,
        lastSeq: event.seq,
        declaredCount: 0,
        observedCount: 0,
        requestIds: new Set(),
        channels: new Set(),
        transports: new Set(),
        plugins: new Set(fallback.plugin ? [fallback.plugin] : []),
        properties: new Map(),
        history: [],
      })
    } else entities.set(key, { ...previous, ...mergeEntity(previous, fallback) })
    return entities.get(key)
  }

  const ensureRequest = id => {
    if (!id) return null
    if (!requestStates.has(id)) requestStates.set(id, {
      id,
      declared: false,
      observed: false,
      open: false,
      declaredAt: null,
      observedAt: null,
      openedAt: null,
      closedAt: null,
      lastAt: null,
      actor: null,
    })
    return requestStates.get(id)
  }

  for (const event of events) {
    const classification = topologyEventClass(event)
    const eventTargets = targetsForEvent(event, requestTargets)
    currentEdgeKey = null
    const id = requestId(event)
    const request = ensureRequest(id)
    if (request) {
      request.lastAt = event.ts
      request.actor = actor(event) || request.actor
    }
    if (classification === 'declared' && request) {
      request.declared = true
      request.declaredAt ??= event.ts
    }
    if (classification === 'observed' && request) {
      request.observed = true
      request.observedAt ??= event.ts
    }
    if (classification === 'presence' && request) {
      const phase = event.kind.slice('presence.'.length)
      request.open = !TERMINAL_PHASES.has(phase)
      if (request.open) request.openedAt ??= event.ts
      else request.closedAt = event.ts
    }

    if (classification !== 'presence') {
      for (const key of eventTargets) {
        const entity = ensureEntity(key, event)
        entity.lastSeq = event.seq
        entity.lastAt = event.ts
        const resolved = resolveTopologyEntity(event)
        const merged = mergeEntity(entity, resolved || provisionalEntity(key, event) || entity)
        entity.identity = merged.identity
        entity.title = merged.title
        const observedTitle = classification === 'observed' ? text(event.data?.title || event.data?.displayName || event.data?.objectName) : ''
        if (observedTitle) entity.title = observedTitle
        entity.type = merged.type
        entity.category = merged.category
        entity.provisionalIdentity = merged.provisionalIdentity
        entity.summary = eventSummary(event)
        entity.history.push({
          seq: event.seq,
          ts: event.ts,
          kind: event.kind,
          class: classification || 'record',
          summary: eventSummary(event),
          channel: channel(event),
          transport: transport(event),
          actor: actor(event),
          requestId: id,
          state: stateData(event),
        })
        if (classification === 'declared') entity.declaredCount++
        if (classification === 'observed') entity.observedCount++
        if (id) entity.requestIds.add(id)
        entity.channels.add(channel(event))
        entity.transports.add(transport(event))
        if (event.data?.plugin) entity.plugins.add(event.data.plugin)
        for (const row of propertyRows(event, classification)) if (!entity.properties.has(row.key)) entity.properties.set(row.key, row)
      }
    }

    for (const key of eventTargets) {
      if (!entities.has(key) && classification === 'presence') continue
      const edgeKey = `${key}|${channel(event)}`
      if (!edges.has(edgeKey)) edges.set(edgeKey, {
        id: `channel:${channel(event)}:${key}`,
        from: 'wp:site',
        to: key,
        channel: channel(event),
        transports: new Set(),
        requests: new Set(),
        lastSeq: event.seq,
        lastAt: event.ts,
        lastRequestId: id,
        phase: classification || 'record',
        classification: classification || 'record',
        actor: actor(event),
      })
      const edge = edges.get(edgeKey)
      edge.transports.add(transport(event))
      if (id) edge.requests.add(id)
      edge.lastSeq = event.seq
      edge.lastAt = event.ts
      edge.lastRequestId = id || edge.lastRequestId
      edge.phase = classification === 'presence' ? event.kind.slice('presence.'.length) : classification || 'record'
      edge.classification = classification || 'record'
      edge.actor = actor(event) || edge.actor
      currentEdgeKey = edgeKey
    }
    currentTargets = eventTargets
  }

  const sessionEnded = events.some(event => event?.kind === 'session.end')
  for (const edge of edges.values()) {
    const states = [...edge.requests].map(id => requestStates.get(id)).filter(Boolean)
    edge.connected = !sessionEnded && states.some(request => request.open)
    edge.active = edge.connected || states.some(request => request.declared && !request.observed)
    edge.current = `${edge.to}|${edge.channel}` === currentEdgeKey
    const latest = requestStates.get(edge.lastRequestId) || states.toSorted((a, b) => (b.lastAt || 0) - (a.lastAt || 0))[0]
    const measured = latest?.declaredAt && (latest.observedAt || latest.lastAt)
      ? (latest.observedAt || latest.lastAt) - latest.declaredAt
      : latest?.openedAt && latest?.closedAt
        ? latest.closedAt - latest.openedAt
        : null
    edge.durationMs = Number.isFinite(measured) && measured > 0 ? measured : 1200
    edge.actor = latest?.actor || edge.actor || null
    edge.flowState = edge.current && edge.classification === 'observed'
      ? 'settled'
      : edge.current && edge.connected
        ? 'live'
        : edge.current && !sessionEnded && states.some(request => request.declared && !request.observed)
          ? 'claimed'
          : edge.connected
            ? 'live'
            : 'idle'
    edge.active = edge.current && ['claimed', 'live'].includes(edge.flowState)
  }

  return { entities, entityOrder, edges, currentTargets, currentEdgeKey }
}

function serializeEntity(entity, order, visibility, edges, seen = true, sessionEnded = false) {
  const relatedEdges = edges.filter(edge => edge.to === entity.key)
  const changes = seen ? changeRecords(entity.history, sessionEnded) : []
  const latestChange = changes.at(-1) || null
  if (visibility === 'blueprint-future') return {
    id: entity.key,
    key: entity.key,
    identity: entity.identity,
    type: entity.type,
    category: entity.category,
    title: entity.title,
    order,
    visibility,
    future: true,
    history: seen ? entity.history : [],
    changes,
    stateLine: placeState(entity, changes),
    lastChange: latestChange,
    properties: [],
    channels: [],
    transports: [],
    plugins: [],
    runCount: 0,
    declaredCount: 0,
    observedCount: 0,
    active: relatedEdges.some(edge => edge.active),
    current: relatedEdges.some(edge => edge.current),
    flowState: relatedEdges.find(edge => edge.current)?.flowState || (relatedEdges.some(edge => edge.connected) ? 'live' : 'idle'),
  }
  return {
    id: entity.key,
    key: entity.key,
    identity: entity.identity,
    type: entity.type,
    category: entity.category,
    title: entity.title,
    summary: entity.summary,
    order,
    visibility,
    future: false,
    firstSeq: entity.firstSeq,
    lastSeq: entity.lastSeq,
    lastAt: entity.lastAt,
    history: entity.history,
    changes,
    stateLine: placeState(entity, changes),
    lastChange: latestChange,
    properties: [...entity.properties.values()],
    channels: [...entity.channels],
    transports: [...entity.transports],
    plugins: [...entity.plugins],
    runCount: entity.requestIds.size || Math.max(changes.length, 1),
    declaredCount: entity.declaredCount,
    observedCount: entity.observedCount,
    active: relatedEdges.some(edge => edge.active),
    current: relatedEdges.some(edge => edge.current),
    flowState: relatedEdges.find(edge => edge.current)?.flowState || (relatedEdges.some(edge => edge.connected) ? 'live' : 'idle'),
  }
}

export function buildSiteTopology(events, options = {}) {
  const visibleEvents = Array.from(events || [])
  const blueprintEvents = Array.from(options.blueprintEvents || visibleEvents)
  const requestTargets = buildRequestTargets(blueprintEvents)
  const blueprint = analyze(blueprintEvents, requestTargets)
  const visible = analyze(visibleEvents, requestTargets)
  const blueprintEdges = [...blueprint.edges.values()]
  const visibleEdges = [...visible.edges.values()]
  const visibleEdgeById = new Map(visibleEdges.map(edge => [edge.id, edge]))
  const edges = blueprintEdges.map(edge => {
    const current = visibleEdgeById.get(edge.id)
    return current ? {
      ...current,
      transports: [...current.transports],
      requests: [...current.requests],
      future: false,
    } : {
      ...edge,
      transports: [...edge.transports],
      requests: [],
      active: false,
      connected: false,
      current: false,
      future: true,
    }
  })
  const sessionEnded = visibleEvents.some(event => event?.kind === 'session.end')
  const nodes = blueprint.entityOrder.map((key, order) => {
    const blueprintEntity = blueprint.entities.get(key)
    const visibleEntity = visible.entities.get(key)
    const visibility = visibleEntity?.observedCount
      ? 'confirmed'
      : visibleEntity?.declaredCount
        ? sessionEnded ? 'unconfirmed' : 'declared'
        : 'blueprint-future'
    return serializeEntity(visibleEntity || blueprintEntity, order, visibility, edges, Boolean(visibleEntity), sessionEnded)
  })
  const visibleNodes = nodes.filter(node => !node.future)
  const session = visibleEvents.find(event => event.kind === 'session.start')?.data || {}
  const target = options.target || session.target || 'Local WordPress site'
  const address = target.includes('://') ? new URL(target).host : target
  const identityEvent = [...visibleEvents].reverse().find(event => event.kind === 'runtime.site.identity' && text(event.data?.siteName))
    || [...blueprintEvents].reverse().find(event => event.kind === 'runtime.site.identity' && text(event.data?.siteName))
  const siteName = options.siteName || session.siteName || session.targetName || session.siteTitle || session.blogname || identityEvent?.data?.siteName || address
  const activeEdges = edges.filter(edge => !edge.future && edge.active)
  const visibleFlows = edges.filter(edge => !edge.future)
  const latestFlow = visibleFlows.toSorted((a, b) => (b.lastAt || 0) - (a.lastAt || 0))[0] || null
  const rootFlow = visibleFlows.find(edge => edge.connected) || visibleFlows.find(edge => edge.active) || latestFlow
  const allChanges = nodes.flatMap(node => node.changes.map(change => ({ ...change, placeId: node.id, placeTitle: node.title })))
    .toSorted((a, b) => a.seq - b.seq)
  const focusEdge = visibleFlows.find(edge => edge.current) || null
  const focusChange = focusEdge
    ? [...allChanges].reverse().find(change => change.placeId === focusEdge.to && (!focusEdge.lastRequestId || change.requestId === focusEdge.lastRequestId)) || null
    : null
  return {
    root: {
      id: 'wp:site',
      key: 'wp:site',
      type: 'site',
      category: 'site',
      identity: address,
      title: siteName,
      target,
      future: false,
      active: activeEdges.length > 0,
      current: false,
      flowState: focusEdge?.flowState || 'idle',
      runCount: new Set(visibleEdges.flatMap(edge => [...edge.requests])).size,
      objectCount: visibleNodes.length,
      channelCount: new Set(visibleEdges.map(edge => edge.channel)).size,
      history: [],
      changes: allChanges,
      stateLine: `${visibleNodes.length} ${visibleNodes.length === 1 ? 'place' : 'places'} touched${rootFlow ? ` · ${displayChannel(rootFlow.channel)} ${rootFlow.connected ? 'live' : rootFlow.active ? 'in flight' : 'idle'}` : ''}`,
      lastChange: allChanges.at(-1) || null,
      properties: [],
    },
    nodes,
    edges,
    currentTargets: visible.currentTargets,
    changes: allChanges,
    focus: focusChange && focusEdge ? { change: focusChange, edge: focusEdge, place: nodes.find(node => node.id === focusEdge.to) || null } : null,
  }
}

export function layoutSiteTopology(topology, options = {}) {
  const compact = Boolean(options.compact)
  const padX = options.padX ?? (compact ? 24 : 52)
  const padY = options.padY ?? (compact ? 132 : 72)
  const nodeW = options.nodeW ?? (compact ? 316 : 360)
  const nodeH = options.nodeH ?? 164
  const gapX = options.gapX ?? (compact ? 38 : 112)
  const gapY = options.gapY ?? (compact ? 28 : 40)
  const categoryOrder = options.categoryOrder || ['content', 'settings', 'abilities', 'interfaces', 'objects', 'plugins']
  const categoryRank = new Map(categoryOrder.map((category, index) => [category, index]))
  // A session-stable logical seed, not viewport width, owns wrapping. Four
  // 320px cards produce a balanced 4x5 block for the 20-place desktop case.
  const desktopWrapColumns = Math.max(1, Number(options.layoutSeed?.desktopWrapColumns || 4))
  const nodeHeights = options.nodeHeights || {}
  const placed = []
  const lanes = []
  const root = { ...topology.root, x: padX, y: padY, depth: 0 }
  placed.push(root)

  const groups = new Map()
  for (const node of topology.nodes) (groups.get(node.category) || groups.set(node.category, []).get(node.category)).push(node)
  const orderedCategories = [...groups.keys()].toSorted((left, right) => {
    const leftRank = categoryRank.get(left) ?? categoryOrder.length
    const rightRank = categoryRank.get(right) ?? categoryOrder.length
    return leftRank - rightRank || left.localeCompare(right)
  })
  let compactIndex = 0
  let nextLaneY = padY
  let visibleBottom = padY + (nodeHeights[root.id] || nodeH)
  for (const category of orderedCategories) {
    const rank = categoryRank.get(category) ?? categoryOrder.length + orderedCategories.filter(item => !categoryRank.has(item)).indexOf(category)
    const entries = groups.get(category)
    const empty = entries.every(node => node.future)
    if (compact) {
      entries.forEach(node => placed.push({ ...node, x: padX, y: padY + nodeH + gapY + compactIndex++ * (nodeH + gapY), depth: rank + 1 }))
      continue
    }
    const y = nextLaneY
    entries.forEach((node, index) => placed.push({
      ...node,
      x: padX + nodeW + gapX + (index % desktopWrapColumns) * (nodeW + gapX),
      y: y + Math.floor(index / desktopWrapColumns) * (nodeH + gapY),
      depth: rank + 1,
    }))
    const reservedRows = Math.max(1, Math.ceil(entries.length / desktopWrapColumns))
    const visibleEntries = entries.filter(node => !node.future)
    const visibleColumns = Math.max(1, Math.min(desktopWrapColumns, visibleEntries.length))
    const laneHeight = empty ? 0 : Math.max(...visibleEntries.map(node => {
      const index = entries.indexOf(node)
      const rowY = Math.floor(index / desktopWrapColumns) * (nodeH + gapY)
      return rowY + (nodeHeights[node.id] || nodeH)
    }))
    const visualY = empty ? visibleBottom + gapY : y
    lanes.push({
      id: `lane:${category}`,
      category,
      empty,
      x: padX + nodeW + gapX - 24,
      y: visualY - 24,
      width: empty ? 148 : Math.max(nodeW + 48, visibleColumns * (nodeW + gapX) - gapX + 48),
      height: empty ? 24 : laneHeight + 48,
    })
    if (!empty) visibleBottom = Math.max(visibleBottom, y + laneHeight)
    nextLaneY = y + reservedRows * nodeH + Math.max(0, reservedRows - 1) * gapY + gapY * 2
  }

  const maxX = Math.max(...placed.map(node => node.x + nodeW), padX + nodeW)
  const maxY = Math.max(...placed.map(node => node.y + nodeH), padY + nodeH)
  return {
    nodes: placed,
    lanes,
    edges: topology.edges,
    width: maxX + padX,
    height: maxY + padY,
    nodeW,
    nodeH,
  }
}
