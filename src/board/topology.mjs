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

const text = value => String(value ?? '').trim()
const titleCase = value => text(value)
  .replace(/^_+/, '')
  .replace(/^yoast_wpseo_/, '')
  .replace(/[-_./]+/g, ' ')
  .replace(/\b\w/g, character => character.toUpperCase())

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

function transport(event) {
  return text(event?.data?.transport || 'transport unknown')
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

function mergeEntity(previous, incoming) {
  if (!previous) return { ...incoming }
  const nextType = previous.type === 'content' && ['page', 'post'].includes(incoming.type) ? incoming.type : previous.type
  const genericTitle = /^(?:Content|Page|Post) #\d+$/.test(previous.title)
  return {
    ...previous,
    type: nextType,
    category: incoming.category || previous.category,
    title: genericTitle && incoming.title ? incoming.title : previous.title,
    plugin: incoming.plugin || previous.plugin || null,
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

  const ensureEntity = (key, event) => {
    const direct = resolveTopologyEntity(event)
    const previous = entities.get(key)
    const fallback = direct || { key, identity: key.split(':').at(-1), type: 'object', category: 'objects', title: titleCase(key.split(':').at(-1)), plugin: null }
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
    if (!requestStates.has(id)) requestStates.set(id, { id, declared: false, observed: false, open: false })
    return requestStates.get(id)
  }

  for (const event of events) {
    const classification = topologyEventClass(event)
    const eventTargets = targetsForEvent(event, requestTargets)
    const id = requestId(event)
    const request = ensureRequest(id)
    if (classification === 'declared' && request) request.declared = true
    if (classification === 'observed' && request) request.observed = true
    if (classification === 'presence' && request) request.open = !TERMINAL_PHASES.has(event.kind.slice('presence.'.length))

    if (classification !== 'presence') {
      for (const key of eventTargets) {
        const entity = ensureEntity(key, event)
        entity.lastSeq = event.seq
        entity.lastAt = event.ts
        entity.title = mergeEntity(entity, resolveTopologyEntity(event) || entity).title
        entity.type = mergeEntity(entity, resolveTopologyEntity(event) || entity).type
        entity.summary = eventSummary(event)
        entity.history.push({
          seq: event.seq,
          ts: event.ts,
          kind: event.kind,
          class: classification || 'record',
          summary: eventSummary(event),
          channel: channel(event),
          transport: transport(event),
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
        phase: classification || 'record',
      })
      const edge = edges.get(edgeKey)
      edge.transports.add(transport(event))
      if (id) edge.requests.add(id)
      edge.lastSeq = event.seq
      edge.lastAt = event.ts
      edge.phase = classification === 'presence' ? event.kind.slice('presence.'.length) : classification || 'record'
    }
    currentTargets = eventTargets
  }

  for (const edge of edges.values()) {
    const states = [...edge.requests].map(id => requestStates.get(id)).filter(Boolean)
    edge.active = states.some(request => request.open || (request.declared && !request.observed))
    edge.current = currentTargets.includes(edge.to)
  }

  return { entities, entityOrder, edges, currentTargets }
}

function serializeEntity(entity, order, visible, edges) {
  if (!visible) return {
    id: entity.key,
    key: entity.key,
    identity: entity.identity,
    type: entity.type,
    category: entity.category,
    title: entity.title,
    order,
    future: true,
    history: [],
    properties: [],
    channels: [],
    transports: [],
    plugins: [],
    runCount: 0,
    declaredCount: 0,
    observedCount: 0,
    active: false,
    current: false,
  }
  const relatedEdges = edges.filter(edge => edge.to === entity.key)
  return {
    id: entity.key,
    key: entity.key,
    identity: entity.identity,
    type: entity.type,
    category: entity.category,
    title: entity.title,
    summary: entity.summary,
    order,
    future: false,
    firstSeq: entity.firstSeq,
    lastSeq: entity.lastSeq,
    lastAt: entity.lastAt,
    history: entity.history,
    properties: [...entity.properties.values()],
    channels: [...entity.channels],
    transports: [...entity.transports],
    plugins: [...entity.plugins],
    runCount: entity.requestIds.size || Math.max(entity.declaredCount, entity.observedCount, 1),
    declaredCount: entity.declaredCount,
    observedCount: entity.observedCount,
    active: relatedEdges.some(edge => edge.active),
    current: relatedEdges.some(edge => edge.current),
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
      current: false,
      future: true,
    }
  })
  const nodes = blueprint.entityOrder.map((key, order) => {
    const blueprintEntity = blueprint.entities.get(key)
    const visibleEntity = visible.entities.get(key)
    return serializeEntity(visibleEntity || blueprintEntity, order, Boolean(visibleEntity), edges)
  })
  const visibleNodes = nodes.filter(node => !node.future)
  const target = options.target || visibleEvents.find(event => event.kind === 'session.start')?.data?.target || 'Local WordPress site'
  const activeEdges = edges.filter(edge => !edge.future && edge.active)
  return {
    root: {
      id: 'wp:site',
      key: 'wp:site',
      type: 'site',
      category: 'site',
      title: 'WordPress site',
      target,
      future: false,
      active: activeEdges.length > 0,
      current: false,
      runCount: new Set(visibleEdges.flatMap(edge => [...edge.requests])).size,
      objectCount: visibleNodes.length,
      channelCount: new Set(visibleEdges.map(edge => edge.channel)).size,
      history: [],
      properties: [],
    },
    nodes,
    edges,
    currentTargets: visible.currentTargets,
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
  const rowsPerColumn = compact ? Number.POSITIVE_INFINITY : Math.max(1, options.rowsPerColumn || 6)
  const placed = []
  const root = { ...topology.root, x: padX, y: padY, depth: 0 }
  placed.push(root)

  topology.nodes.forEach((node, index) => {
    const column = compact ? 0 : Math.floor(index / rowsPerColumn)
    const row = compact ? index : index % rowsPerColumn
    placed.push({
      ...node,
      x: compact ? padX : padX + nodeW + gapX + column * (nodeW + gapX),
      y: compact ? padY + nodeH + gapY + row * (nodeH + gapY) : padY + row * (nodeH + gapY),
      depth: column + 1,
    })
  })

  const maxX = Math.max(...placed.map(node => node.x + nodeW), padX + nodeW)
  const maxY = Math.max(...placed.map(node => node.y + nodeH), padY + nodeH)
  return {
    nodes: placed,
    edges: topology.edges,
    width: maxX + padX,
    height: maxY + padY,
    nodeW,
    nodeH,
  }
}
