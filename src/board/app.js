import { createProjection, reduceEvent, summarizeEvent } from '/assets/reducer.mjs'
import { buildReplayIndex, projectReplay } from '/assets/replay.mjs'
import { buildSiteTopology, displayChannel, layoutSiteTopology } from '/assets/topology.mjs'

// Graph layout and expandable node interaction substantially adapt sodiumsun/agenttrail (MIT, snapshot 41454d4).

const $ = id => document.getElementById(id)
const SVG_NS = 'http://www.w3.org/2000/svg'
const state = {
  mode: 'live',
  liveModel: createProjection(),
  liveEvents: [],
  replayEvents: [],
  replayIndex: null,
  sessions: [],
  sessionId: null,
  cursor: 0,
  selectedSeq: null,
  playing: false,
  timer: null,
  source: null,
  openGraphNodes: new Set(),
  focused: new URLSearchParams(location.search).get('focus') === '1',
}

function node(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function svgNode(tag, attributes = {}, text) {
  const element = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes)) if (value !== undefined && value !== null) element.setAttribute(name, String(value))
  if (text !== undefined) element.textContent = text
  return element
}

function formatClock(timestamp) {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(timestamp)
}

function formatDate(timestamp) {
  if (!timestamp) return 'Unknown time'
  const date = new Date(timestamp)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return new Intl.DateTimeFormat([], sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function elapsed(start, end) {
  const milliseconds = Math.max(0, (end || Date.now()) - (start || end || Date.now()))
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function duration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return 'timing pending'
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`
}

function eventClass(event) {
  if (event.kind.startsWith('presence.')) return 'presence'
  if (event.kind.startsWith('tool.') || event.kind.includes('.call') || event.kind.endsWith('.declared') || event.kind.startsWith('plan.')) return 'declared'
  if (event.kind.startsWith('file.') || event.kind.startsWith('wp.') || event.kind.startsWith('adapter.') || event.kind.startsWith('runtime.') || event.kind === 'repo.snapshot') return 'observed'
  return 'record'
}

function channel(event) {
  return event.data?.channel || event.data?.transport || ({ watcher: 'repo', hook: 'agent', plan: 'plan', session: 'session', wp: 'WordPress', mcp: 'MCP', cli: 'WP-CLI' }[event.source] || event.source)
}

function eventDetail(event) {
  const data = event.data || {}
  return data.file || data.title || data.objectType || data.ability || data.tool || data.phase || event.kind
}

function currentEvents() {
  return state.mode === 'live' ? state.liveEvents : state.replayEvents
}

function visibleTrailEvents() {
  if (state.mode === 'live') return state.liveEvents
  return state.replayEvents.slice(0, Math.max(0, state.cursor + 1))
}

function currentTopology(model) {
  const trailEvents = visibleTrailEvents()
  const blueprintEvents = state.mode === 'live' ? trailEvents : state.replayEvents
  const target = model.session?.target || model.daemon?.target || 'Local WordPress site'
  const siteName = model.session?.siteName || model.session?.targetName || model.session?.siteTitle || null
  return buildSiteTopology(trailEvents, { blueprintEvents, target, siteName })
}

function currentProjection() {
  if (state.mode === 'live') return state.liveModel
  if (!state.replayIndex || state.replayIndex.length !== state.replayEvents.length || state.replayIndex.lastSeq !== state.replayEvents.at(-1)?.seq) state.replayIndex = buildReplayIndex(state.replayEvents)
  return projectReplay(state.replayEvents, state.cursor, state.replayIndex)
}

function activeConnections(model) {
  return Object.values(model.connections || {}).filter(connection => connection.active)
}

function selectedEvent() {
  const events = currentEvents()
  return state.selectedSeq === null ? null : events.find(event => event.seq === state.selectedSeq) || null
}

function setText(id, value) {
  $(id).textContent = value
}

function toast(message) {
  const element = $('toast')
  element.textContent = message
  element.dataset.visible = 'true'
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { delete element.dataset.visible }, 2200)
}

function renderHeader(model) {
  const target = model.session?.target || model.daemon?.target || 'Local WordPress project'
  const targetName = target.includes('://') ? new URL(target).host : target.split(/[\\/]/).filter(Boolean).at(-1) || target
  setText('target-name', targetName)
  setText('target-path', target)
  const signal = $('live-signal')
  const live = state.mode === 'live' && model.status === 'live'
  signal.dataset.status = live ? 'live' : state.mode === 'live' ? 'offline' : 'replay'
  signal.querySelector('span').textContent = live ? 'Recording live' : state.mode === 'live' ? 'Recorded' : state.mode === 'replay' ? 'Replaying' : 'Rendering path'
}

function renderSessions(model) {
  setText('session-count', String(state.sessions.length))
  const list = $('session-list')
  const items = state.sessions.map(session => {
    const start = session.start?.data || {}
    const currentSessionId = state.liveModel.daemon?.sessionId || state.liveModel.session?.sessionId
    const button = node('button', 'session-item')
    button.type = 'button'
    button.dataset.live = String(session.id === currentSessionId && state.liveModel.status === 'live')
    button.setAttribute('aria-current', String(session.id === state.sessionId))
    const copy = node('span', 'session-copy')
    copy.append(node('strong', '', session.id === currentSessionId ? 'Current recording' : formatDate(session.start?.ts)))
    copy.append(node('span', '', `${start.agent || 'Observed session'} · ${Math.max(1, Math.round(session.size / 1024))} KB`))
    button.append(copy)
    button.addEventListener('click', () => selectSession(session.id))
    return button
  })
  if (!items.length) {
    const empty = node('p', 'panel-empty', 'The first path will appear as soon as an event is recorded.')
    list.replaceChildren(empty)
  } else list.replaceChildren(...items)
}

function renderOrbit(model) {
  const events = currentEvents()
  const max = Math.max(0, events.length - 1)
  const cursor = state.mode === 'live' ? max : Math.min(state.cursor, max)
  const scrubber = $('scrubber')
  scrubber.max = String(max)
  scrubber.value = String(cursor)
  scrubber.disabled = state.mode === 'live' || max === 0
  $('playback').disabled = state.mode === 'live' || max === 0
  $('playback').dataset.playing = String(state.playing)
  $('playback').querySelector('span').textContent = state.playing ? 'Pause trail' : state.mode === 'timelapse' ? 'Play timelapse' : 'Play trail'
  const current = events[cursor]
  const first = events[0]
  setText('playback-time', current ? `${formatClock(current.ts)} · ${elapsed(first?.ts, current.ts)}` : 'Waiting for evidence')
  setText('event-position', `${events.length ? cursor + 1 : 0} / ${events.length} events`)
}

function renderBrief(model, topology) {
  const focus = topology?.focus
  if (focus?.place && focus?.change && focus?.edge) {
    const actorName = focus.edge.actor || focus.change.actor
    const subject = actorName || 'Unattributed work'
    setText('brief-title', `${subject} via ${displayChannel(focus.edge.channel)} is changing ${focus.place.title}`)
    setText('brief-detail', focus.change.confirmation
      ? `Confirmed by WordPress: ${focus.change.confirmation.summary}${focus.change.claim ? ` · Claim: ${focus.change.claim.summary}` : ' · No matching claim was recorded.'}`
      : `Claimed: ${focus.change.claim?.summary || focus.change.verb}. Waiting for independent WordPress confirmation.`)
    setText('declared-count', String(model.counts?.declared || 0))
    setText('observed-count', String(model.counts?.observed || 0))
    setText('connection-count', String(activeConnections(model).length))
    return
  }
  const latestChange = topology?.changes?.at(-1)
  if (latestChange) {
    setText('brief-title', `${latestChange.verb} ${latestChange.placeTitle}`)
    setText('brief-detail', latestChange.confirmation
      ? `${displayChannel(latestChange.channel)} delivered a WordPress-confirmed change. Open the place history to compare its claim and confirmation.`
      : `${displayChannel(latestChange.channel)} recorded a claim without a WordPress confirmation.`)
    setText('declared-count', String(model.counts?.declared || 0))
    setText('observed-count', String(model.counts?.observed || 0))
    setText('connection-count', String(activeConnections(model).length))
    return
  }
  const latest = model.recent?.find(event => !event.kind.startsWith('presence.') || /(?:error|timeout|disconnect)$/.test(event.kind))
  setText('brief-title', latest?.summary || (model.status === 'ended' ? 'This recorded path is ready to replay' : 'Waiting for the first recorded action'))
  const detail = latest
    ? latest.kind.startsWith('presence.')
      ? 'Connection state is evidence too. The channel remains distinct from the work it may perform.'
      : latest.kind.startsWith('wp.')
        ? 'WordPress reported this effect independently of the agent’s declared intent.'
        : latest.kind.startsWith('tool.') || latest.kind.includes('.call')
          ? 'This is what the agent declared or requested. Observed effects remain separate below.'
          : 'This event is preserved in the trail and will render identically in replay and timelapse.'
    : 'Aphelion is ready. Agent intent and observed WordPress changes will appear here as separate evidence.'
  setText('brief-detail', detail)
  setText('declared-count', String(model.counts?.declared || 0))
  setText('observed-count', String(model.counts?.observed || 0))
  setText('connection-count', String(activeConnections(model).length))
}

function renderComponents(model, topology = currentTopology(model)) {
  const plannedComponents = (model.plan?.nodes || []).filter(item => item.level === 'component')
  const declarations = model.repository?.declarations || []
  // WordPress actions are the work in a site session. PLAN.md remains trail
  // evidence, but it must never displace the durable site map from top-left.
  const components = topology.nodes.length ? [] : plannedComponents
  const visibleEntities = topology.nodes.filter(item => !item.future)
  const entitySummary = topology.nodes.length ? `${visibleEntities.length}/${topology.nodes.length} ${topology.nodes.length === 1 ? 'place' : 'places'} · ${topology.changes.length} ${topology.changes.length === 1 ? 'change' : 'changes'}` : ''
  const completed = components.filter(item => item.status === 'done').length
  const planSummary = components.length ? `${completed}/${components.length} components` : ''
  setText('map-summary', [entitySummary, planSummary].filter(Boolean).join(' · '))
  const flow = $('component-flow')
  flow.style.removeProperty('height')
  flow.style.removeProperty('--expanded-height')
  flow.dataset.expanded = String(state.openGraphNodes.size > 0)
  document.querySelector('.app-shell').dataset.graphExpanded = String(state.openGraphNodes.size > 0)
  const compact = window.innerWidth <= 680
  const graphNodes = []
  const graphEdges = []
  const scalar = value => Array.isArray(value) ? value.join(' · ') : value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')
  const label = value => String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, character => character.toUpperCase())
  const changeProperties = change => [
    { label: 'Claim', value: change.claim?.summary || 'No declared claim recorded' },
    { label: 'Confirmation', value: change.confirmation?.summary || 'No WordPress confirmation recorded' },
  ].filter(Boolean)
  const changeRow = change => ({
    title: change.verb,
    status: change.status === 'confirmed' ? 'done' : change.status === 'in-flight' ? 'active' : 'blocked',
    meta: `${formatClock(change.ts)} · ${displayChannel(change.channel)} · ${change.status}`,
    properties: changeProperties(change),
    seq: change.seq,
  })
  const lastChangeLine = change => change
    ? `${change.verb} · ${change.status === 'in-flight' ? 'claimed via' : 'via'} ${displayChannel(change.channel)} · ${formatClock(change.ts)}`
    : 'No changes recorded'
  const taskRows = component => model.plan.nodes.filter(candidate => candidate.parent === component.id).map(task => ({
    title: task.title,
    status: task.status,
    meta: task.status === 'active' ? 'Editing now' : task.status === 'done' ? 'Completed' : task.status === 'blocked' ? 'Blocked' : 'Planned',
    properties: [
      task.tech ? { label: 'Technical', value: task.tech } : null,
      task.by ? { label: 'Agent', value: task.by } : null,
      { label: 'Stable ID', value: task.id },
    ].filter(Boolean),
  }))

  if (components.length) {
    const byId = Object.fromEntries(components.map(component => [component.id, component]))
    const depth = {}, visiting = new Set()
    const getDepth = component => {
      if (depth[component.id] !== undefined) return depth[component.id]
      if (visiting.has(component.id)) return 0
      visiting.add(component.id)
      const predecessors = (component.needs || []).filter(id => byId[id])
      depth[component.id] = predecessors.length ? 1 + Math.max(...predecessors.map(id => getDepth(byId[id]))) : 0
      visiting.delete(component.id)
      return depth[component.id]
    }
    components.forEach(getDepth)
    for (const component of components) {
      const rows = taskRows(component), done = rows.filter(row => row.status === 'done').length
      graphNodes.push({ id: component.id, depth: getDepth(component), group: 'plan', kind: 'component', kicker: component.tech || `Component · ${component.id}`, title: component.title, meta: `${done} of ${rows.length} tasks · ${component.status}`, status: component.status, progress: rows.length ? done / rows.length : 0, rows })
    }
    for (const component of components) for (const need of component.needs || []) if (byId[need]) graphEdges.push({ from: need, to: component.id, kind: 'dependency' })
    const links = new Set()
    for (const component of components) for (const linked of component.links || []) if (byId[linked]) {
      const key = [component.id, linked].sort().join('|')
      if (!links.has(key)) { links.add(key); graphEdges.push({ from: component.id, to: linked, kind: 'link' }) }
    }
  }

  if (topology.nodes.length) {
    graphNodes.push({
      id: topology.root.id,
      group: 'site',
      kind: 'site',
      kicker: `Site · ${topology.root.identity}`,
      title: topology.root.title,
      stateLine: topology.root.stateLine,
      lastChangeLine: lastChangeLine(topology.root.lastChange),
      historyLabel: `${topology.root.changes.length} ${topology.root.changes.length === 1 ? 'change' : 'changes'} · open history`,
      status: topology.root.active ? 'active' : 'done',
      flowState: topology.root.flowState,
      progress: 1,
      rows: [...topology.root.changes].reverse().map(changeRow),
      topologyRoot: true,
    })

    for (const entity of topology.nodes) {
      const typeLabel = entity.type === 'option' ? 'Setting' : entity.type === 'content' ? 'Content' : label(entity.type)
      const status = entity.future ? 'pending' : entity.active ? 'active' : entity.observedCount ? 'done' : 'pending'
      const historyRows = [...entity.changes].reverse().map(changeRow)
      graphNodes.push({
        id: entity.id,
        group: 'site',
        kind: 'entity',
        entityType: entity.type,
        future: entity.future,
        kicker: `${typeLabel} · ${entity.identity}`,
        title: entity.title,
        stateLine: entity.future ? 'Not reached yet' : entity.stateLine,
        lastChangeLine: entity.future ? 'No changes recorded' : lastChangeLine(entity.lastChange),
        historyLabel: `${entity.changes.length} ${entity.changes.length === 1 ? 'change' : 'changes'} · open history`,
        status,
        flowState: entity.flowState,
        progress: status === 'done' ? 1 : status === 'active' ? .5 : 0,
        seq: entity.lastSeq,
        rows: historyRows,
        current: entity.current,
        topologyOrder: entity.order,
      })
    }

    const futureIds = new Set(topology.nodes.filter(entity => entity.future).map(entity => entity.id))
    for (const edge of topology.edges) graphEdges.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      kind: 'channel',
      label: displayChannel(edge.channel),
      claim: topology.focus?.edge.id === edge.id && !topology.focus.change.confirmation ? topology.focus.change.claim?.summary : null,
      active: edge.active,
      flowState: edge.flowState,
      current: edge.current,
      future: edge.future || (futureIds.has(edge.to) && edge.flowState === 'idle'),
      duration: edge.durationMs,
    })
  }

  if (!graphNodes.length && declarations.length) declarations.slice(0, 8).forEach((declaration, index) => graphNodes.push({
    id: `declaration-${index}`, depth: index, group: 'plan', kind: 'declaration', kicker: `WordPress · ${declaration.type.replaceAll('-', ' ')}`, title: declaration.title || declaration.name,
    meta: declaration.type.replaceAll('-', ' '), status: 'pending', progress: 0,
    rows: [{ title: declaration.name || declaration.title, status: 'pending', meta: declaration.type, properties: Object.entries(declaration).filter(([key]) => !['title', 'name', 'type'].includes(key)).map(([key, value]) => ({ label: label(key), value: scalar(value) })) }],
  }))

  if (!graphNodes.length) {
    const empty = node('div', 'empty-ledger')
    empty.append(node('strong', '', 'The site map will grow from the first durable object.'), node('span', '', 'Actions resolve onto WordPress content, settings, plugins, and abilities. Connection lifecycle stays on the edges.'))
    flow.replaceChildren(empty)
    return
  }

  // AgentTrail assigns durable components a stable position and updates their
  // activity in place. Site entities keep that same spatial contract.
  const flowWidth = Math.max(320, flow.clientWidth || (compact ? 358 : 760))
  const nodeW = compact ? Math.min(320, Math.max(280, flowWidth - 48)) : state.focused ? 360 : Math.min(340, Math.max(280, Math.round(flowWidth * .46)))
  const nodeH = 176
  const gapX = compact ? 38 : 112
  const gapY = compact ? 28 : 40
  const padX = compact ? 24 : 52
  const padY = compact ? 132 : 80
  const detailHeight = item => Math.min(680, Math.max(84, 16 + item.rows.reduce((height, row) => height + 48 + Math.min(12, row.properties.length) * 22, 0)))
  const metrics = Object.fromEntries(graphNodes.map(item => {
    const open = state.openGraphNodes.has(item.id), detailH = open ? detailHeight(item) : 0
    return [item.id, { w: nodeW, nodeW, nodeH, detailH, h: nodeH + (open ? 24 + detailH : 0) }]
  }))
  const planNodes = graphNodes.filter(item => item.group === 'plan')
  const siteNodes = graphNodes.filter(item => item.group === 'site')
  const layoutGroup = (items, offsetY = padY) => {
    if (!items.length) return { bottom: offsetY, right: padX }
    if (compact) {
      let y = offsetY, right = padX
      for (const item of items) { Object.assign(item, { x: padX, y }); y += metrics[item.id].h + gapY; right = Math.max(right, padX + nodeW) }
      return { bottom: y - gapY + padY, right: right + padX }
    }
    const columns = {}
    for (const item of items) (columns[item.depth] ??= []).push(item)
    const ordered = Object.keys(columns).map(Number).sort((a, b) => a - b)
    let x = padX, bottom = offsetY, right = padX
    for (const column of ordered) {
      let y = offsetY
      for (const item of columns[column]) { Object.assign(item, { x, y }); y += metrics[item.id].h + gapY }
      bottom = Math.max(bottom, y - gapY + padY); right = x + nodeW + padX; x += nodeW + gapX
    }
    return { bottom, right }
  }
  const planLayout = layoutGroup(planNodes)
  if (siteNodes.length) {
    const siteOffsetY = planNodes.length ? planLayout.bottom + 72 : padY
    const siteLayout = layoutSiteTopology(topology, { compact, nodeW, nodeH, gapX, gapY, padX, padY: siteOffsetY })
    const positions = new Map(siteLayout.nodes.map(item => [item.id, item]))
    const columnShift = new Map()
    for (const item of siteNodes) {
      const position = positions.get(item.id)
      if (!position) continue
      const shift = columnShift.get(position.depth) || 0
      Object.assign(item, { x: position.x, y: position.y + shift, depth: position.depth })
      if (state.openGraphNodes.has(item.id)) columnShift.set(position.depth, shift + metrics[item.id].detailH + 24)
    }
  }
  const graphBottom = Math.max(padY, ...graphNodes.map(item => item.y + metrics[item.id].h + padY))
  const graphRight = Math.max(padX, ...graphNodes.map(item => item.x + nodeW + padX))
  const fitScale = Math.min(1, flowWidth / graphRight)
  const desiredHeight = graphBottom * fitScale + 48
  const minHeight = compact ? 520 : 360
  // Expanded AgentTrail-style detail cards are part of the work surface, not
  // a tooltip. Give them room to grow before SVG has to scale the type down;
  // collapsed maps retain the compact first-viewport bounds.
  const maxHeight = state.openGraphNodes.size ? (compact ? 1800 : 1400) : (compact ? 720 : 620)
  const renderedFlowHeight = Math.round(Math.max(minHeight, Math.min(maxHeight, desiredHeight)))
  flow.style.height = `${renderedFlowHeight}px`
  if (state.openGraphNodes.size) flow.style.setProperty('--expanded-height', `${renderedFlowHeight}px`)
  const byGraphId = Object.fromEntries(graphNodes.map(item => [item.id, item]))
  const shell = node('div', 'graph-shell')
  const svg = svgNode('svg', { class: 'work-graph', role: 'img', preserveAspectRatio: 'xMinYMin meet', 'aria-labelledby': 'graph-title graph-description' })
  svg.append(svgNode('title', { id: 'graph-title' }, 'Stable WordPress agent-work topology'), svgNode('desc', { id: 'graph-description' }, 'The map starts at the top left. Durable WordPress objects retain their positions while declared actions, observed effects, and connection state update them over trail time.'))
  const defs = svgNode('defs')
  const pattern = svgNode('pattern', { id: 'graph-grid', width: 24, height: 24, patternUnits: 'userSpaceOnUse' })
  pattern.append(svgNode('circle', { cx: 1, cy: 1, r: 1, class: 'graph-grid-dot' }))
  const marker = svgNode('marker', { id: 'graph-arrow', viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 9, markerHeight: 9, markerUnits: 'userSpaceOnUse', orient: 'auto' })
  marker.append(svgNode('path', { d: 'M1 1.5 8 5 1 8.5', class: 'graph-arrow' }))
  defs.append(pattern, marker)
  svg.append(defs, svgNode('rect', { width: '100%', height: '100%', class: 'graph-grid-fill' }))
  const world = svgNode('g', { class: 'graph-world' })
  const edgeGroups = new Map()
  for (const edge of graphEdges) {
    const list = edgeGroups.get(edge.to) || []
    list.push(edge)
    edgeGroups.set(edge.to, list)
  }
  for (const list of edgeGroups.values()) list.forEach((edge, index) => { edge.laneOffset = (index - (list.length - 1) / 2) * 12 })
  const edgePath = (from, to, edge) => {
    const laneOffset = edge?.laneOffset || 0
    const vertical = Math.abs(from.x - to.x) < 30 || compact
    if (vertical) {
      const x1 = from.x + nodeW / 2 + laneOffset, y1 = from.y + nodeH, x2 = to.x + nodeW / 2 + laneOffset, y2 = to.y
      const bend = Math.max(38, Math.abs(y2 - y1) / 2)
      return `M${x1} ${y1}C${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}`
    }
    const forward = to.x >= from.x
    const x1 = from.x + (forward ? nodeW : 0), y1 = from.y + nodeH / 2 + laneOffset, x2 = to.x + (forward ? 0 : nodeW), y2 = to.y + nodeH / 2 + laneOffset
    const bend = Math.max(44, Math.abs(x2 - x1) / 2)
    return `M${x1} ${y1}C${x1 + (forward ? bend : -bend)} ${y1} ${x2 + (forward ? -bend : bend)} ${y2} ${x2} ${y2}`
  }
  for (const edge of graphEdges) {
    const from = byGraphId[edge.from], to = byGraphId[edge.to]
    if (!from || !to) continue
    const pathData = edgePath(from, to, edge)
    world.append(svgNode('path', { d: pathData, class: `graph-edge ${edge.kind}${edge.flowState ? ` ${edge.flowState}` : ''}${edge.active ? ' active' : ''}${edge.future ? ' future' : ''}`, 'data-edge-id': edge.id, 'data-flow-state': edge.flowState, 'data-from': edge.from, 'data-to': edge.to, style: edge.active ? `--flow-duration:${edge.duration}ms` : null, 'aria-hidden': edge.future ? true : null, 'marker-end': edge.kind === 'link' || edge.future ? null : 'url(#graph-arrow)' }))
    if (edge.label && !edge.future) {
      const vertical = Math.abs(from.x - to.x) < 30 || compact
      const sameRow = !vertical && Math.abs(from.y - to.y) < 30
      world.append(svgNode('text', {
        class: `graph-edge-label${edge.active ? ' active' : ''}`,
        x: vertical ? to.x + nodeW / 2 + edge.laneOffset : sameRow ? (from.x + nodeW + to.x) / 2 : to.x - 14,
        y: vertical ? to.y - 12 : sameRow ? to.y - 12 : to.y + nodeH / 2 + edge.laneOffset - 9,
        'text-anchor': vertical || sameRow ? 'middle' : 'end',
      }, edge.label.slice(0, 44)))
    }
    if (edge.claim && !edge.future) {
      world.append(svgNode('text', {
        class: 'graph-flow-claim',
        x: to.x + 16,
        y: to.y + nodeH / 2 - 18,
      }, `Claim · ${edge.claim.length > 48 ? `${edge.claim.slice(0, 47)}…` : edge.claim}`))
    }
    if (edge.active) {
      const particle = svgNode('circle', { r: 5, class: 'energy-particle', 'data-edge-id': edge.id, 'data-duration': edge.duration })
      particle.append(svgNode('animateMotion', { dur: `${edge.duration}ms`, repeatCount: 'indefinite', path: pathData }))
      world.append(particle)
    }
  }
  const titleLines = value => {
    const words = String(value).split(/\s+/)
    const lines = ['']
    for (const word of words) {
      const current = lines.at(-1)
      if (current && `${current} ${word}`.length > 40 && lines.length < 2) lines.push(word)
      else lines[lines.length - 1] = `${current} ${word}`.trim()
    }
    return lines
  }
  const clip = (value, max) => {
    const rendered = String(value)
    return rendered.length > max ? `${rendered.slice(0, max - 1)}…` : rendered
  }
  for (const item of graphNodes) {
    const open = state.openGraphNodes.has(item.id)
    const detailNoun = item.kind === 'component' ? 'tasks' : item.kind === 'entity' ? 'history' : 'details'
    const group = svgNode('g', { class: `graph-node ${item.status} ${item.flowState || ''} ${item.kind}${open ? ' selected' : ''}${item.future ? ' future' : ''}${item.current ? ' current' : ''}`, 'data-node-id': item.id, 'data-node-kind': item.kind, 'data-node-group': item.group, 'data-flow-state': item.flowState, transform: `translate(${item.x} ${item.y})`, tabindex: item.future ? null : 0, role: item.future ? null : 'button', 'aria-hidden': item.future ? true : null, 'aria-expanded': item.future ? null : open, 'aria-label': item.future ? null : `${open ? 'Hide' : 'Show'} ${detailNoun} for ${item.title}` })
    group.append(svgNode('rect', { class: 'graph-node-box', width: nodeW, height: nodeH, rx: 8 }), svgNode('circle', { class: 'graph-port', cx: 0, cy: nodeH / 2, r: 4 }), svgNode('circle', { class: 'graph-port', cx: nodeW, cy: nodeH / 2, r: 4 }))
    group.append(svgNode('text', { class: 'graph-node-kind', x: 16, y: 25 }, String(item.kicker).slice(0, 48)))
    const lines = titleLines(item.title)
    lines.forEach((line, index) => group.append(svgNode('text', { class: 'graph-node-title', x: 16, y: 54 + index * 20 }, line)))
    const metaY = 54 + (lines.length - 1) * 20 + 28
    if (item.kind === 'entity' || item.kind === 'site') {
      group.append(svgNode('text', { class: 'graph-node-state', x: 16, y: metaY }, clip(item.stateLine, 52)))
      group.append(svgNode('text', { class: 'graph-node-last-change', x: 16, y: metaY + 24 }, clip(item.lastChangeLine, 52)))
      group.append(svgNode('text', { class: 'graph-node-history', x: 16, y: nodeH - 14 }, open ? item.historyLabel.replace('open history', 'close history') : item.historyLabel))
    } else {
      group.append(svgNode('text', { class: 'graph-node-meta', x: 16, y: metaY }, item.meta.slice(0, 58)))
      group.append(svgNode('rect', { class: 'graph-progress-bg', x: 16, y: 120, width: nodeW - 32, height: 4, rx: 2 }), svgNode('rect', { class: 'graph-progress', x: 16, y: 120, width: (nodeW - 32) * item.progress, height: 4, rx: 2 }))
      group.append(svgNode('text', { class: 'graph-node-action', x: 16, y: 153 }, open ? 'Hide details ↑' : `Show ${item.kind === 'component' ? 'tasks' : 'properties'} ↓`))
    }
    if (item.kind !== 'entity' && item.kind !== 'site') {
      const status = svgNode('g', { class: 'graph-node-status', transform: `translate(${nodeW - 26} 26)` })
      status.append(svgNode('circle', { r: 8 }))
      if (item.status === 'done') status.append(svgNode('path', { d: 'M-4 0l3 3 6-7' }))
      group.append(status)
    }
    const select = () => {
      open ? state.openGraphNodes.delete(item.id) : state.openGraphNodes.add(item.id)
      if (item.seq) state.selectedSeq = item.seq
      renderComponents(model); renderDetail(model); renderLedger(model)
    }
    if (!item.future) {
      group.addEventListener('click', select)
      group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select() } })
    }
    world.append(group)
    if (open) {
      const detailY = item.y + nodeH + 24, detailH = metrics[item.id].detailH
      world.append(svgNode('path', { class: 'graph-detail-tether', d: `M${item.x + nodeW / 2} ${item.y + nodeH}V${detailY}` }))
      const foreign = svgNode('foreignObject', { class: 'graph-detail', x: item.x, y: detailY, width: nodeW, height: detailH })
      const card = node('div', 'graph-detail-card')
      card.setAttribute('role', 'list')
      for (const [rowIndex, row] of item.rows.entries()) {
        const capsule = node('div', `graph-detail-row ${row.status}`)
        capsule.setAttribute('role', 'listitem')
        const heading = node('div', 'graph-detail-heading')
        heading.append(node('i', 'graph-detail-marker'), node('strong', '', row.title), node('span', '', row.meta))
        capsule.append(heading)
        if (row.properties.length) {
          const properties = node('dl', 'graph-property-list')
          for (const property of row.properties) {
            const propertyRow = node('div', 'graph-property-row')
            propertyRow.style.setProperty('--row-delay', `${120 + rowIndex * 70}ms`)
            propertyRow.append(node('dt', '', property.label), node('dd', '', property.value))
            properties.append(propertyRow)
          }
          capsule.append(properties)
        }
        card.append(capsule)
      }
      foreign.append(card); world.append(foreign)
    }
  }
  svg.append(world)
  const controlIcon = pathData => {
    const icon = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': true })
    for (const path of pathData) icon.append(svgNode('path', { d: path }))
    return icon
  }
  const controls = node('div', 'graph-controls')
  const zoomOut = node('button', 'graph-control'); zoomOut.type = 'button'; zoomOut.setAttribute('aria-label', 'Zoom graph out'); zoomOut.append(controlIcon(['M6 12h12']))
  const zoomValue = node('span', 'graph-zoom', 'Fit')
  const zoomIn = node('button', 'graph-control'); zoomIn.type = 'button'; zoomIn.setAttribute('aria-label', 'Zoom graph in'); zoomIn.append(controlIcon(['M12 6v12', 'M6 12h12']))
  const fit = node('button', 'graph-control fit'); fit.type = 'button'; fit.setAttribute('aria-label', 'Fit graph to view'); fit.append(controlIcon(['M9 4H4v5', 'M15 4h5v5', 'M20 15v5h-5', 'M4 15v5h5']))
  controls.append(zoomOut, zoomValue, zoomIn, fit)
  shell.append(svg, controls)
  flow.replaceChildren(shell)

  let view = { x: 0, y: 0, width: graphRight, height: graphBottom }
  const fitted = { ...view }
  const updateView = () => { svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`); zoomValue.textContent = `${Math.round(fitted.width / view.width * 100)}%` }
  const zoom = factor => { const width = view.width * factor, height = view.height * factor; view = { x: view.x + (view.width - width) / 2, y: view.y + (view.height - height) / 2, width, height }; updateView() }
  zoomIn.addEventListener('click', () => zoom(.82)); zoomOut.addEventListener('click', () => zoom(1.22)); fit.addEventListener('click', () => { view = { ...fitted }; updateView() })
  let pan = null
  svg.addEventListener('pointerdown', event => { if (event.target.closest('.graph-node')) return; svg.setPointerCapture(event.pointerId); pan = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y } })
  svg.addEventListener('pointermove', event => { if (!pan) return; const box = svg.getBoundingClientRect(); view.x = pan.viewX - (event.clientX - pan.x) * view.width / box.width; view.y = pan.viewY - (event.clientY - pan.y) * view.height / box.height; updateView() })
  svg.addEventListener('pointerup', () => { pan = null }); svg.addEventListener('pointercancel', () => { pan = null })
  svg.addEventListener('wheel', event => { event.preventDefault(); zoom(event.deltaY < 0 ? .9 : 1.1) }, { passive: false })
  updateView()
}

function renderLedger(model, topology = currentTopology(model)) {
  if (topology.changes.length) {
    const rows = [...topology.changes].reverse().map(change => {
      const button = node('button', 'ledger-row')
      button.type = 'button'
      button.dataset.class = change.status === 'confirmed' ? 'observed' : 'declared'
      button.setAttribute('aria-pressed', String(change.seq === state.selectedSeq))
      button.append(node('span', 'ledger-time', formatClock(change.ts)))
      const evidence = node('span', 'ledger-evidence')
      evidence.append(document.createElement('i'))
      const copy = node('span')
      copy.append(
        node('strong', '', `${change.verb} ${change.placeTitle}`),
        node('span', '', change.confirmation
          ? `${change.claim ? 'Claim + confirmation' : 'Confirmation without claim'} · ${change.confirmation.summary}`
          : `${change.status === 'in-flight' ? 'Claim in flight' : 'Unconfirmed claim'} · ${change.claim?.summary || change.verb}`),
      )
      evidence.append(copy)
      button.append(evidence, node('span', 'channel-tag', displayChannel(change.channel)))
      button.addEventListener('click', () => {
        state.selectedSeq = change.seq
        render(model)
      })
      return button
    })
    $('ledger-rows').replaceChildren(...rows)
    return
  }
  const events = (model.recent || []).slice(0, 70)
  const rows = events.map(event => {
    const button = node('button', 'ledger-row')
    button.type = 'button'
    button.dataset.class = eventClass(event)
    button.setAttribute('aria-pressed', String(event.seq === state.selectedSeq))
    button.append(node('span', 'ledger-time', formatClock(event.ts)))
    const evidence = node('span', 'ledger-evidence')
    evidence.append(document.createElement('i'))
    const copy = node('span')
    copy.append(node('strong', '', event.summary || summarizeEvent(event)), node('span', '', eventDetail(event)))
    evidence.append(copy)
    button.append(evidence, node('span', 'channel-tag', channel(event)))
    button.addEventListener('click', () => {
      state.selectedSeq = event.seq
      render(model)
    })
    return button
  })
  const ledger = $('ledger-rows')
  if (!rows.length) {
    const empty = node('div', 'empty-ledger')
    empty.append(node('strong', '', 'No evidence has landed yet.'), node('span', '', 'The watcher, agent hooks, sidecar, and WordPress audit log all write into this same ledger.'))
    ledger.replaceChildren(empty)
  } else ledger.replaceChildren(...rows)
}

function renderPresence(model) {
  const connections = Object.values(model.connections || {}).filter(connection => connection.active).sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  const active = connections.length
  setText('presence-summary', active ? `${active} live ${active === 1 ? 'channel' : 'channels'}` : 'No live channels')
  const rows = connections.slice(0, 8).map(connection => {
    const row = node('div', 'presence-row')
    row.dataset.active = String(connection.active)
    row.dataset.phase = connection.phase
    row.append(document.createElement('i'))
    const copy = node('div')
    const actor = typeof connection.actor === 'string' ? connection.actor : connection.actor?.login || connection.channel || 'Connection'
    copy.append(node('strong', '', actor))
    copy.append(node('span', '', `${connection.channel || 'unknown channel'} · ${connection.transport || 'transport unknown'} · ${connection.phase}`))
    row.append(copy)
    return row
  })
  $('presence-list').replaceChildren(...(rows.length ? rows : [node('p', 'panel-empty', 'Connections appear here even before they change WordPress.')]))
}

function renderWordPress(model) {
  const actions = model.wordpress?.actions || []
  setText('wordpress-count', `${actions.length} observed ${actions.length === 1 ? 'effect' : 'effects'}`)
  const rows = actions.slice(0, 8).map(action => {
    const row = node('div', 'wordpress-row')
    row.append(document.createElement('i'))
    const copy = node('div')
    copy.append(node('strong', '', action.summary || action.title || action.kind))
    const context = [action.plugin, action.objectType, action.title, action.blocks?.join(', '), action.channel].filter(Boolean).join(' · ')
    copy.append(node('span', '', context || `${action.source} · ${formatClock(action.ts)}`))
    row.append(copy)
    return row
  })
  $('wordpress-list').replaceChildren(...(rows.length ? rows : [node('p', 'panel-empty', 'Runtime and hook-layer effects will remain readable after the site is gone.')]))
}

function renderDetail(model) {
  const event = selectedEvent()
  const detail = $('event-detail')
  if (!event) {
    detail.className = 'event-detail empty'
    detail.textContent = 'Technical provenance stays one level down, ready when you need it.'
    setText('detail-sequence', 'Select a ledger row')
    return
  }
  detail.className = 'event-detail'
  setText('detail-sequence', `Event ${event.seq} · ${event.kind}`)
  const summary = node('p', 'detail-summary', summarizeEvent(event))
  const facts = node('dl', 'detail-grid')
  const requestId = event.data?.requestId || event.data?.correlationId
  const journey = requestId ? model.journeys?.[requestId] : null
  const rows = [
    ['Source', event.source], ['Channel', channel(event)], ['Observed at', new Date(event.ts).toISOString()],
    ...(event.receivedAt ? [['Captured at', new Date(event.receivedAt).toISOString()], ['Capture lag', duration(event.receivedAt - event.ts)]] : []),
    ...(requestId ? [['Request', requestId]] : []),
    ...(journey?.effectLatencyMs !== null && journey?.effectLatencyMs !== undefined ? [['Declared → effect', duration(journey.effectLatencyMs)]] : []),
    ['Sequence', event.seq],
  ]
  for (const [label, value] of rows) {
    const row = document.createElement('div')
    row.append(node('dt', '', label), node('dd', '', String(value)))
    facts.append(row)
  }
  const raw = node('pre', 'detail-json', JSON.stringify(event.data, null, 2))
  detail.replaceChildren(summary, facts, raw)
}

function render(model = currentProjection()) {
  const topology = currentTopology(model)
  document.querySelector('.app-shell').dataset.appState = 'ready'
  document.querySelector('.app-shell').dataset.mode = state.mode
  renderHeader(model)
  renderSessions(model)
  renderOrbit(model)
  renderBrief(model, topology)
  renderComponents(model, topology)
  renderLedger(model, topology)
  renderPresence(model)
  renderWordPress(model)
  renderDetail(model)
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

async function loadLive() {
  const model = await fetchJson('/api/model')
  state.liveModel = model
  state.sessionId = model.daemon?.sessionId || model.session?.sessionId
  const [sessions, events] = await Promise.all([
    fetchJson('/api/sessions'),
    state.sessionId ? fetchJson(`/api/sessions/${encodeURIComponent(state.sessionId)}/events`) : Promise.resolve([]),
  ])
  state.sessions = sessions
  state.liveEvents = events
  state.cursor = Math.max(0, events.length - 1)
  render(state.liveModel)
}

async function selectSession(sessionId) {
  stopPlayback()
  if (sessionId === state.liveModel.daemon?.sessionId) {
    state.mode = 'live'
    state.sessionId = sessionId
    syncModeButtons()
    render(state.liveModel)
    return
  }
  state.replayEvents = await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/events`)
  state.replayIndex = buildReplayIndex(state.replayEvents)
  state.sessionId = sessionId
  state.mode = 'replay'
  state.cursor = Math.max(0, state.replayEvents.length - 1)
  state.selectedSeq = null
  syncModeButtons()
  render()
}

function syncModeButtons() {
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-selected', String(button.dataset.mode === state.mode))
}

function syncFocus() {
  const shell = document.querySelector('.app-shell')
  const button = $('focus-canvas')
  shell.dataset.focus = String(state.focused)
  button.setAttribute('aria-pressed', String(state.focused))
  button.querySelector('span').textContent = state.focused ? 'Exit focus' : 'Focus canvas'
}

function setMode(mode) {
  stopPlayback()
  state.mode = mode
  state.selectedSeq = null
  if (mode === 'live') {
    state.sessionId = state.liveModel.daemon?.sessionId
    state.cursor = Math.max(0, state.liveEvents.length - 1)
  } else {
    if (!state.replayEvents.length) {
      state.replayEvents = [...state.liveEvents]
      state.replayIndex = buildReplayIndex(state.replayEvents)
    }
    state.cursor = mode === 'timelapse' ? 0 : Math.max(0, state.replayEvents.length - 1)
  }
  syncModeButtons()
  render()
}

function stopPlayback() {
  state.playing = false
  clearInterval(state.timer)
  state.timer = null
}

function togglePlayback() {
  if (state.playing) {
    stopPlayback()
    render()
    return
  }
  if (state.cursor >= state.replayEvents.length - 1) state.cursor = 0
  state.playing = true
  state.timer = setInterval(() => {
    state.cursor++
    if (state.cursor >= state.replayEvents.length - 1) stopPlayback()
    render()
  }, state.mode === 'timelapse' ? 180 : 420)
  render()
}

function connectEvents() {
  state.source?.close()
  const source = new EventSource('/events')
  state.source = source
  source.addEventListener('open', () => {
    $('connection-banner').hidden = true
    $('live-signal').dataset.status = 'live'
  })
  source.addEventListener('trail', event => {
    const item = JSON.parse(event.data)
    if (!state.liveEvents.some(existing => existing.seq === item.seq)) state.liveEvents.push(item)
    state.liveModel = reduceEvent(state.liveModel, item)
    if (state.mode === 'live') {
      state.cursor = state.liveEvents.length - 1
      render(state.liveModel)
    }
  })
  source.addEventListener('error', () => {
    $('connection-banner').hidden = false
    $('live-signal').dataset.status = 'offline'
    $('live-signal').querySelector('span').textContent = 'Reconnecting'
  })
}

for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => setMode(button.dataset.mode))
$('scrubber').addEventListener('input', event => {
  stopPlayback()
  state.cursor = Number(event.target.value)
  render()
})
$('playback').addEventListener('click', togglePlayback)
$('focus-canvas').addEventListener('click', () => {
  state.focused = !state.focused
  syncFocus()
  render()
})
$('copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href)
    toast('Local board link copied')
  } catch {
    toast('Copy unavailable — use the address bar')
  }
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.playing) { stopPlayback(); render() }
  if (event.key === ' ' && state.mode !== 'live' && event.target === document.body) { event.preventDefault(); togglePlayback() }
})

syncFocus()
loadLive().then(connectEvents).catch(error => {
  document.querySelector('.app-shell').dataset.appState = 'error'
  setText('brief-title', 'Aphelion could not open this trail')
  setText('brief-detail', `${error.message}. Check that the local daemon is still running, then reload.`)
  $('connection-banner').hidden = false
  $('connection-banner').querySelector('strong').textContent = 'The local board is unavailable.'
})
