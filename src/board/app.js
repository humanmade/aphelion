import { createProjection, reduceEvent, summarizeEvent } from '/assets/reducer.mjs'
import { buildReplayIndex, projectReplay } from '/assets/replay.mjs'
import { buildSiteTopology, displayChannel, FULL_FIT_PLACE_LIMIT, groupTopologyChanges, layoutSiteTopology, routeContainmentElbows, routeSiteTopologyEdges, siteCardHeight, topologyCameraFrames, topologyRunLabel, visibleTopologyEdges } from '/assets/topology.mjs'

// Graph layout and node interaction substantially adapt sodiumsun/agenttrail (MIT, snapshot 41454d4).

const $ = id => document.getElementById(id)
const SVG_NS = 'http://www.w3.org/2000/svg'
const STANDARD_TRANSITION_MS = 300
const SLOW_TRANSITION_MS = 500
const state = {
  mode: 'live',
  liveModel: createProjection(),
  liveEvents: [],
  replayEvents: [],
  replayIndex: null,
  sessions: [],
  sessionId: null,
  cursor: 0,
  playing: false,
  timer: null,
  source: null,
  expandedTails: new Set(),
  layoutSeeds: new Map(),
  nodePositions: new Map(),
  camera: null,
  cameraBounds: null,
  cameraContext: null,
  userMovedCamera: false,
  territoryFilter: 'all',
  territoryFilterContext: null,
  fitFilteredOnRender: false,
  graph: null,
  renderFrame: null,
  pendingRenderModel: null,
  inspectorSelection: null,
  inspectorTab: 'place',
  urlReady: false,
  renderClock: null,
  renderDirection: 'none',
}

const deepLinkKeys = ['session', 'mode', 'seq', 'place', 'flow', 'tab']

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
  return new Intl.DateTimeFormat([], date.toDateString() === today.toDateString()
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function duration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return 'timing pending'
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`
}

function channel(event) {
  return event.data?.channel || event.data?.transport || ({ watcher: 'repo', hook: 'agent', plan: 'plan', session: 'session', wp: 'WordPress', mcp: 'MCP', cli: 'WP-CLI' }[event.source] || event.source)
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

function syncDeepLink() {
  if (!state.urlReady) return
  const url = new URL(window.location.href)
  for (const key of deepLinkKeys) url.searchParams.delete(key)
  if (state.mode !== 'live') {
    if (state.sessionId) url.searchParams.set('session', state.sessionId)
    url.searchParams.set('mode', state.mode)
    const event = state.replayEvents[state.cursor]
    if (event?.seq !== undefined) url.searchParams.set('seq', String(event.seq))
  }
  if (state.inspectorSelection?.kind === 'place') url.searchParams.set('place', state.inspectorSelection.id)
  if (state.inspectorSelection?.kind === 'edge') url.searchParams.set('flow', state.inspectorSelection.id)
  if (state.inspectorSelection && state.inspectorTab === 'trail') url.searchParams.set('tab', 'trail')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function setText(id, value) {
  if ($(id).textContent !== value) $(id).textContent = value
}

function toast(message) {
  const element = $('toast')
  element.textContent = message
  element.dataset.visible = 'true'
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { delete element.dataset.visible }, 2200)
}

function renderHeader(model) {
  const signal = $('live-signal')
  const live = state.mode === 'live' && model.status === 'live'
  signal.dataset.status = live ? 'live' : state.mode === 'live' ? 'offline' : 'replay'
  const label = live ? 'Live' : state.mode === 'live' ? 'Recorded' : state.mode === 'replay' ? 'Replay' : 'Timelapse'
  if (signal.querySelector('span').textContent !== label) signal.querySelector('span').textContent = label
}

function renderWarnings(topology) {
  const element = $('observer-warning')
  const warning = topology.warnings?.find(item => item.id === 'observer-version')
  element.hidden = !warning
  element.title = warning ? `Expected observer ${warning.expectedVersion || 'current'}; reported ${warning.reportedVersion || 'no version'}` : ''
}

function renderSessions(model) {
  const select = $('session-select')
  const currentSessionId = state.liveModel.daemon?.sessionId || state.liveModel.session?.sessionId
  const options = state.sessions.map(session => {
    const start = session.start?.data || {}
    const target = start.siteName || start.targetName || start.target || start.agent || 'recorded session'
    const option = node('option', '', session.id === currentSessionId ? `Live · ${target}` : `${formatDate(session.start?.ts)} · ${target}`)
    option.value = session.id
    return option
  })
  if (!options.length) {
    if (select.dataset.signature !== 'empty') {
      const option = node('option', '', 'Waiting for first session')
      option.value = ''
      select.replaceChildren(option)
      select.dataset.signature = 'empty'
    }
    select.disabled = true
    return
  }
  select.disabled = false
  const signature = options.map(option => `${option.value}:${option.textContent}`).join('|')
  if (select.dataset.signature !== signature) {
    select.replaceChildren(...options)
    select.dataset.signature = signature
  }
  select.value = state.sessionId || model.daemon?.sessionId || options[0].value
}

function playbackCaption(model, topology, current) {
  if (topology?.focus?.place && topology?.focus?.edge) {
    const rawActor = topology.focus.edge.actor || topology.focus.change.actor || 'Agent'
    const actor = /^WordPress sidecar$/i.test(rawActor) ? 'Sidecar' : rawActor
    return `${actor} · ${displayChannel(topology.focus.edge.channel)} → ${topology.focus.place.title}`
  }
  if (current) return current.summary || summarizeEvent(current)
  return model.status === 'ended' ? 'Session ended' : 'Waiting for evidence'
}

function renderOrbit(model, topology) {
  const events = currentEvents()
  const max = Math.max(0, events.length - 1)
  const cursor = state.mode === 'live' ? max : Math.min(state.cursor, max)
  const scrubber = $('scrubber')
  scrubber.max = String(max)
  scrubber.value = String(cursor)
  scrubber.disabled = state.mode === 'live' || max === 0
  $('playback').disabled = state.mode === 'live' || max === 0
  $('playback').dataset.playing = String(state.playing)
  $('playback').setAttribute('aria-label', state.playing ? 'Pause trail' : state.mode === 'timelapse' ? 'Play timelapse' : 'Play trail')
  const current = events[cursor]
  const position = `${events.length ? cursor + 1 : 0} / ${events.length}`
  setText('event-position', state.mode === 'live' ? position : `${state.playing ? 'Playing' : 'Paused'} · moment ${position}`)
  setText('playback-caption', current ? `${formatClock(current.ts)} · ${playbackCaption(model, topology, current)}` : playbackCaption(model, topology, current))
}

function titleCase(value) {
  return String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replaceAll('-', ' ').replace(/^./, character => character.toUpperCase())
}

function placeType(item) {
  if (item.kind === 'site') return 'Site'
  if (item.kind === 'component') return 'Component'
  if (item.kind === 'declaration') return 'WordPress'
  if (item.entityType === 'option') return 'Setting'
  return titleCase(item.entityType || item.kind)
}

function placeIcon(type) {
  const icon = svgNode('svg', { class: 'place-icon', viewBox: '0 0 24 24', 'aria-hidden': true })
  const paths = type === 'Site'
    ? ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18']
    : type === 'Setting'
      ? ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V20.3h-3v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7.08 15a1.7 1.7 0 0 0-1.55-1H5.4v-3h.13a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1-1.55V4.7h3v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.55 1h.13v3h-.13a1.7 1.7 0 0 0-1.55 1Z']
      : type === 'Plugin'
        ? ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z']
        : type === 'Ability'
          ? ['m13 2-9 12h8l-1 8 9-12h-8z']
          : ['M6 3h9l4 4v14H6z', 'M14 3v5h5', 'M9 13h6M9 17h6']
  for (const d of paths) icon.append(svgNode('path', { d }))
  return icon
}

function collapseChanges(changes = []) {
  return groupTopologyChanges(changes).map(group => changeRow(group)).reverse()
}

function timeRange(group) {
  const first = formatClock(group[0].ts)
  const last = formatClock(group.at(-1).ts)
  if (group.length === 1 || first === last) return last
  const firstParts = first.match(/^(.*?):(\d{2})(\s(?:AM|PM))?$/i)
  const lastParts = last.match(/^(.*?):(\d{2})(\s(?:AM|PM))?$/i)
  if (firstParts && lastParts && firstParts[1] === lastParts[1] && firstParts[3] === lastParts[3]) return `${firstParts[1]}:${firstParts[2]}–${lastParts[2]}${lastParts[3] || ''}`
  return `${first}–${last}`
}

const actionForms = {
  update: ['Updated', 'Updating'],
  edit: ['Edited', 'Editing'],
  rename: ['Renamed', 'Renaming'],
  restore: ['Restored', 'Restoring'],
  inspect: ['Inspected', 'Inspecting'],
  create: ['Created', 'Creating'],
  delete: ['Deleted', 'Deleting'],
  trash: ['Trashed', 'Trashing'],
  change: ['Changed', 'Changing'],
  set: ['Set', 'Setting'],
  call: ['Called', 'Calling'],
}

function actionPhrase(summary, tense = 'past') {
  const words = String(summary || '').trim().split(/\s+/).filter(Boolean)
  const actionIndex = words.findIndex(word => actionForms[word.toLowerCase().replace(/[^a-z]/g, '')])
  if (actionIndex < 0) return null
  const action = words[actionIndex].toLowerCase().replace(/[^a-z]/g, '')
  const modifiers = words.slice(0, actionIndex).filter(word => /ly$/i.test(word))
  const subject = words.slice(actionIndex + 1).join(' ').replace(/^(?:the|a|an)\s+/i, '').replace(/[.!]+$/, '')
  const form = actionForms[action][tense === 'progressive' ? 1 : 0]
  return [form, subject, ...modifiers.map(word => word.toLowerCase())].filter(Boolean).join(' ')
}

function cardPhrase(change, awaiting) {
  if (change.verb?.startsWith('Renam')) return change.verb
  if (change.claim?.summary) {
    const phrase = actionPhrase(change.claim.summary, awaiting ? 'progressive' : 'past')
    if (phrase) return awaiting ? `${phrase}…` : phrase
  }
  if (awaiting) return change.verb?.endsWith('…') ? change.verb : `${change.verb || 'Changing'}…`
  return change.verb || 'Changed'
}

function phraseParts(phrase, runLead = null) {
  if (runLead) return { lead: runLead, rest: phrase.slice(runLead.length).trim() }
  const [lead, ...rest] = String(phrase).split(/\s+/)
  return { lead, rest: rest.join(' ') }
}

function changeRow(group) {
  const latest = group.at(-1)
  const failed = ['failed', 'refuted'].includes(latest.status)
  const awaiting = latest.status === 'in-flight'
  const unconfirmed = latest.status === 'unconfirmed'
  if (group.length > 1) {
    const lead = `${group.length} ${topologyRunLabel(group)}`
    return { lead, rest: '', time: timeRange(group), status: failed ? 'failed' : awaiting ? 'awaiting' : unconfirmed ? 'unconfirmed' : 'confirmed', changes: group }
  }
  const phrase = cardPhrase(latest, awaiting)
  return { ...phraseParts(phrase), time: awaiting ? '' : formatClock(latest.ts), status: failed ? 'failed' : awaiting ? 'awaiting' : unconfirmed ? 'unconfirmed' : 'confirmed', changes: group }
}

function cardRows(item) {
  if (item.sizeTier === 'tombstone') return []
  if (item.changes?.length) return collapseChanges(item.changes)
  return item.rows || []
}

function cardStateLine(item) {
  if (item.sizeTier === 'tombstone') return ''
  const stateLine = String(item.stateLine || item.meta || '').trim()
  if (!stateLine || stateLine === 'No state recorded' || item.future) return ''
  const genericName = /^(?:Content|Page|Post) #\d+$/.test(String(item.title || ''))
  const placeholder = stateLine.toLowerCase() === placeType(item).toLowerCase()
  return genericName && placeholder ? '' : stateLine
}

function cardHeight(item) {
  if (item.sizeTier === 'tombstone') return 58
  if (item.changes?.length || item.group === 'site') return siteCardHeight(item, { expanded: state.expandedTails.has(item.id) })
  const rows = cardRows(item)
  const base = 30 + (cardStateLine(item) ? 74 : 52)
  if (!rows.length) return base
  const expanded = state.expandedTails.has(item.id)
  const visibleRows = expanded ? Math.min(rows.length, 8) : Math.min(rows.length, 3)
  const affordance = rows.length > 3 ? 29 : 0
  return base + visibleRows * 29 + affordance
}

function changeRowElement(row) {
  const element = node('div', `change-row entering ${row.status === 'confirmed' ? '' : row.status}`.trim())
  const copy = node('span', 'change-copy')
  copy.append(node('strong', '', row.lead))
  if (row.rest) copy.append(node('span', 'change-rest', ` ${row.rest}`))
  const meta = node('span', 'change-meta')
  if (row.status !== 'confirmed') meta.append(node('span', `change-flag ${row.status}`, row.status))
  if (row.time) meta.append(node('time', '', row.time))
  element.append(copy, meta)
  const settle = () => element.classList.remove('entering')
  element.addEventListener('animationend', settle, { once: true })
  setTimeout(settle, SLOW_TRANSITION_MS + 50)
  return element
}

function placeCard(item, height, model) {
  const type = placeType(item)
  const card = node('div', 'place-card')
  const band = node('div', 'place-band')
  const icon = placeIcon(type)
  const typeLabel = node('span', 'place-type', type)
  const address = node('span', 'place-address', item.address || item.identity || item.id)
  const dot = node('i', 'place-dot')
  band.append(icon, typeLabel, address, dot)
  const identity = node('div', 'place-identity')
  const name = node('strong', 'place-name', item.title)
  const stateLine = node('div', 'place-state')
  identity.append(name, stateLine)
  const tail = node('div', 'change-tail')
  card.append(band, identity, tail)
  card.__aphelion = { type, icon, typeLabel, address, dot, band, identity, name, stateLine, tail, rows: new Map(), more: null }
  patchPlaceCard(card, item, height, model)
  return card
}

function changeRowKey(row, index) {
  const first = row.changes?.[0]
  if (first?.id) return first.id
  if (first?.seq !== undefined) return `change:seq:${first.seq}`
  return row.id || `row:${index}`
}

function patchChangeRow(element, row) {
  let changed = false
  element.classList.remove('awaiting', 'failed', 'unconfirmed')
  if (row.status !== 'confirmed') element.classList.add(row.status)
  const copy = element.querySelector('.change-copy')
  const strong = copy.querySelector('strong')
  if (strong.textContent !== row.lead) { strong.textContent = row.lead; changed = true }
  let rest = copy.querySelector('.change-rest')
  if (row.rest) {
    if (!rest) { rest = node('span', 'change-rest'); copy.append(rest); changed = true }
    if (rest.textContent !== ` ${row.rest}`) { rest.textContent = ` ${row.rest}`; changed = true }
  } else if (rest) { rest.remove(); changed = true }
  const meta = element.querySelector('.change-meta')
  let flag = meta.querySelector('.change-flag')
  if (row.status !== 'confirmed') {
    if (!flag) { flag = node('span', `change-flag ${row.status}`); meta.prepend(flag); changed = true }
    flag.className = `change-flag ${row.status}`
    if (flag.textContent !== row.status) { flag.textContent = row.status; changed = true }
  } else if (flag) { flag.remove(); changed = true }
  let time = meta.querySelector('time')
  if (row.time) {
    if (!time) { time = node('time'); meta.append(time); changed = true }
    if (time.textContent !== row.time) { time.textContent = row.time; changed = true }
  } else if (time) { time.remove(); changed = true }
  if (changed) showEvidenceUpdate(element)
}

function cancelExit(element) {
  const exit = element.__aphelionExit
  if (exit) {
    clearTimeout(exit.timer)
    element.removeEventListener('transitionend', exit.finish)
    delete element.__aphelionExit
  }
  element.classList.remove('leaving')
}

function transitionOut(element, complete) {
  cancelExit(element)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { complete(); return }
  element.classList.remove('entering', 'updating')
  element.classList.add('leaving')
  const finish = event => {
    if (event?.target && event.target !== element) return
    clearTimeout(element.__aphelionExit?.timer)
    element.removeEventListener('transitionend', finish)
    delete element.__aphelionExit
    element.classList.remove('leaving')
    complete()
  }
  const timer = setTimeout(finish, SLOW_TRANSITION_MS + 50)
  element.__aphelionExit = { finish, timer }
  element.addEventListener('transitionend', finish)
}

function showEvidenceUpdate(element) {
  if (state.renderDirection === 'none' || element.classList.contains('entering') || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  element.classList.remove('updating')
  void element.offsetWidth
  element.classList.add('updating')
  clearTimeout(element.__aphelionUpdateTimer)
  element.__aphelionUpdateTimer = setTimeout(() => element.classList.remove('updating'), SLOW_TRANSITION_MS + 50)
}

function patchEvidenceText(element, value, key) {
  const rendered = String(value ?? '')
  const changed = element.textContent !== rendered
  if (element.textContent !== rendered) element.textContent = rendered
  if (key) element.dataset.changeKey = key
  if (changed) showEvidenceUpdate(element)
}

function patchPlaceCard(card, item, height, model) {
  const refs = card.__aphelion
  const type = placeType(item)
  if (refs.type !== type) {
    const nextIcon = placeIcon(type)
    refs.icon.replaceWith(nextIcon)
    refs.icon = nextIcon
    refs.type = type
  }
  refs.band.dataset.placeKey = item.id
  patchEvidenceText(refs.typeLabel, type, item.id)
  const address = item.address ?? item.identity ?? item.id
  patchEvidenceText(refs.address, address, item.id)
  const changeKey = item.stateChangeId || item.lastChange?.id || (item.seq !== undefined ? `change:seq:${item.seq}` : item.id)
  patchEvidenceText(refs.name, item.title, changeKey)

  const stateLine = cardStateLine(item)
  refs.identity.className = `place-identity${stateLine ? '' : ' without-state'}${item.sizeTier === 'tombstone' ? ' tombstone' : ''}`
  if (stateLine) {
    cancelExit(refs.stateLine)
    refs.stateLine.hidden = false
    patchEvidenceText(refs.stateLine, stateLine, changeKey)
  } else if (!refs.stateLine.hidden) {
    const hide = () => { refs.stateLine.hidden = true }
    if (state.renderDirection === 'backward') transitionOut(refs.stateLine, hide)
    else hide()
  }

  const rows = cardRows(item)
  const expanded = state.expandedTails.has(item.id)
  if (rows.length) {
    cancelExit(refs.tail)
    if (!refs.tail.isConnected) card.append(refs.tail)
  }
  refs.tail.dataset.expanded = String(expanded)
  const visibleRows = expanded ? rows : rows.slice(0, 3)
  const wanted = new Set()
  let nextRow = refs.tail.firstElementChild
  visibleRows.forEach((row, index) => {
    const key = changeRowKey(row, index)
    wanted.add(key)
    let element = refs.rows.get(key)
    if (!element) {
      element = changeRowElement(row)
      element.dataset.changeKey = key
      refs.rows.set(key, element)
    } else patchChangeRow(element, row)
    cancelExit(element)
    // Preserve a keyed row in its current slot. Re-appending an entering row
    // detaches it briefly and restarts tail-birth when a singleton becomes a run.
    if (element !== nextRow) refs.tail.insertBefore(element, nextRow)
    nextRow = element.nextElementSibling
  })
  for (const [key, element] of refs.rows) if (!wanted.has(key) && element.isConnected) {
    if (state.renderDirection === 'backward') transitionOut(element, () => element.remove())
    else element.remove()
  }

  if (rows.length > 3) {
    if (!refs.more) {
      refs.more = node('button', 'tail-more')
      refs.more.type = 'button'
      refs.more.addEventListener('click', event => {
        event.stopPropagation()
        const id = card.closest('.graph-node')?.dataset.nodeId
        if (!id) return
        state.expandedTails.has(id) ? state.expandedTails.delete(id) : state.expandedTails.add(id)
        if (state.expandedTails.has(id)) {
          const group = card.closest('.graph-node')
          group?.parentElement?.append(group)
        }
        render()
      })
    }
    refs.more.textContent = expanded ? 'Show latest' : `+${rows.length - 3} earlier`
    const earlier = rows.length - 3
    refs.more.setAttribute('aria-label', expanded ? `Collapse changes for ${item.title}` : `Show ${earlier} earlier ${earlier === 1 ? 'change' : 'changes'} for ${item.title}`)
    refs.tail.append(refs.more)
  } else if (refs.more) {
    refs.more.remove()
    refs.more = null
  }
  if (!rows.length && refs.tail.isConnected) {
    if (state.renderDirection === 'backward') transitionOut(refs.tail, () => refs.tail.remove())
    else refs.tail.remove()
  }
  card.style.height = `${height}px`
}

function setSvgAttributes(element, attributes) {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) element.removeAttribute(name)
    else if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value))
  }
}

function resetCamera(context = null) {
  state.camera = null
  state.cameraBounds = null
  state.cameraContext = context
  state.userMovedCamera = false
}

function updateCamera() {
  const graph = state.graph
  if (!graph || !state.camera) return
  const { x, y, width, height } = state.camera
  graph.svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
  setSvgAttributes(graph.grid, { x, y, width, height })
  const fittedWidth = Math.max(1, state.cameraBounds?.width || width)
  graph.zoomValue.textContent = `${Math.round(fittedWidth / width * 100)}%`
}

function syncGraphPlaybackMotion() {
  const graph = state.graph
  if (!graph?.svg) return
  const paused = state.mode !== 'live' && !state.playing
  if (graph.playbackMotionPaused === paused) return
  if (paused) graph.svg.pauseAnimations()
  else graph.svg.unpauseAnimations()
  graph.playbackMotionPaused = paused
}

function ensureGraphShell(flow) {
  if (state.graph?.shell?.isConnected) return state.graph

  const shell = node('div', 'graph-shell')
  const svg = svgNode('svg', { class: 'work-graph', role: 'img', preserveAspectRatio: 'xMinYMin meet', 'aria-labelledby': 'graph-title graph-description' })
  svg.append(svgNode('title', { id: 'graph-title' }, 'WordPress agent work map'), svgNode('desc', { id: 'graph-description' }, 'Durable WordPress places stay at fixed top-left positions while recorded work travels over labeled flows.'))
  const defs = svgNode('defs')
  const pattern = svgNode('pattern', { id: 'graph-grid', width: 24, height: 24, patternUnits: 'userSpaceOnUse' })
  pattern.append(svgNode('circle', { cx: 1, cy: 1, r: 1, class: 'graph-grid-dot' }))
  const marker = svgNode('marker', { id: 'graph-arrow', viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 9, markerHeight: 9, markerUnits: 'userSpaceOnUse', orient: 'auto' })
  marker.append(svgNode('path', { d: 'M1 1.5 8 5 1 8.5', class: 'graph-arrow' }))
  defs.append(pattern, marker)
  const grid = svgNode('rect', { width: '100%', height: '100%', class: 'graph-grid-fill' })
  const world = svgNode('g', { class: 'graph-world' })
  const laneLayer = svgNode('g', { class: 'graph-lanes', 'aria-hidden': true })
  const containmentLayer = svgNode('g', { class: 'graph-containments', 'aria-hidden': true })
  const edgeLayer = svgNode('g', { class: 'graph-edges' })
  const nodeLayer = svgNode('g', { class: 'graph-nodes' })
  world.append(laneLayer, containmentLayer, edgeLayer, nodeLayer)
  svg.append(defs, grid, world)

  const controlIcon = paths => {
    const icon = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': true })
    for (const d of paths) icon.append(svgNode('path', { d }))
    return icon
  }
  const controls = node('div', 'graph-controls')
  const zoomOut = node('button', 'graph-control'); zoomOut.type = 'button'; zoomOut.setAttribute('aria-label', 'Zoom graph out'); zoomOut.append(controlIcon(['M6 12h12']))
  const zoomValue = node('span', 'graph-zoom', '100%')
  const zoomIn = node('button', 'graph-control'); zoomIn.type = 'button'; zoomIn.setAttribute('aria-label', 'Zoom graph in'); zoomIn.append(controlIcon(['M12 6v12', 'M6 12h12']))
  const fit = node('button', 'graph-control fit'); fit.type = 'button'; fit.setAttribute('aria-label', 'Fit graph to view'); fit.append(controlIcon(['M9 4H4v5', 'M15 4h5v5', 'M20 15v5h-5', 'M4 15v5h5']))
  controls.append(zoomOut, zoomValue, zoomIn, fit)
  const filters = node('div', 'territory-filters')
  filters.setAttribute('role', 'toolbar')
  filters.setAttribute('aria-label', 'Filter map by territory')
  const empty = node('div', 'empty-board')
  empty.append(node('p', '', 'The map grows when the first durable place is touched.'), node('p', '', 'No account, no telemetry, nothing leaves this machine.'))
  shell.append(svg, controls, filters, empty)
  while (flow.firstChild) flow.firstChild.remove()
  flow.append(shell)

  const graph = state.graph = {
    shell, svg, grid, world, laneLayer, containmentLayer, edgeLayer, nodeLayer, controls, filters, empty, zoomValue,
    nodeElements: new Map(), edgeElements: new Map(), laneElements: new Map(), containmentElements: new Map(),
    model: null, topology: null, pan: null,
  }

  const zoom = factor => {
    if (!state.camera) return
    const width = state.camera.width * factor
    const height = state.camera.height * factor
    state.camera = {
      x: state.camera.x + (state.camera.width - width) / 2,
      y: state.camera.y + (state.camera.height - height) / 2,
      width,
      height,
    }
    state.userMovedCamera = true
    updateCamera()
  }
  zoomIn.addEventListener('click', event => { event.stopPropagation(); zoom(.82) })
  zoomOut.addEventListener('click', event => { event.stopPropagation(); zoom(1.22) })
  fit.addEventListener('click', event => {
    event.stopPropagation()
    if (!state.cameraBounds) return
    state.camera = { ...state.cameraBounds }
    state.userMovedCamera = true
    updateCamera()
  })
  svg.addEventListener('pointerdown', event => {
    if (event.target.closest('.graph-node, .graph-edge-hit')) return
    svg.setPointerCapture(event.pointerId)
    graph.pan = { x: event.clientX, y: event.clientY, viewX: state.camera.x, viewY: state.camera.y }
  })
  svg.addEventListener('pointermove', event => {
    if (!graph.pan || !state.camera) return
    const box = svg.getBoundingClientRect()
    state.camera.x = graph.pan.viewX - (event.clientX - graph.pan.x) * state.camera.width / box.width
    state.camera.y = graph.pan.viewY - (event.clientY - graph.pan.y) * state.camera.height / box.height
    state.userMovedCamera = true
    updateCamera()
  })
  svg.addEventListener('pointerup', () => { graph.pan = null })
  svg.addEventListener('pointercancel', () => { graph.pan = null })
  svg.addEventListener('wheel', event => {
    event.preventDefault()
    event.stopPropagation()
    zoom(event.deltaY < 0 ? .9 : 1.1)
  }, { passive: false })
  return graph
}

function createEdgeElement(edge) {
  const group = svgNode('g', { class: 'graph-edge-group', 'data-edge-id': edge.id })
  const path = svgNode('path')
  const hit = svgNode('path', { class: 'graph-edge-hit' })
  const label = svgNode('text', { class: 'graph-edge-label', 'text-anchor': 'middle' })
  group.append(path, hit, label)
  const entry = { id: edge.id, group, path, hit, label, particle: null, motion: null }
  const select = event => {
    event.stopPropagation()
    if (entry.future) return
    openInspector({ kind: 'edge', id: entry.id }, state.graph.model, state.graph.topology)
  }
  hit.addEventListener('click', select)
  hit.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(event) } })
  return entry
}

function createLaneElement(lane) {
  const group = svgNode('g', { class: 'graph-lane', 'data-lane-id': lane.id })
  const frame = svgNode('rect', { rx: 12 })
  const label = svgNode('text', { class: 'graph-lane-label' })
  group.append(frame, label)
  return { id: lane.id, group, frame, label }
}

function createContainmentElement(relation) {
  const path = svgNode('path', { class: 'containment-guide entering', 'data-containment-id': relation.id, 'data-parent-id': relation.parentId, 'data-child-id': relation.childId })
  path.addEventListener('transitionend', () => path.classList.remove('entering'), { once: true })
  requestAnimationFrame(() => path.classList.remove('entering'))
  return { id: relation.id, childId: relation.childId, path }
}

function createNodeElement(item, nodeW, height, model) {
  const group = svgNode('g', { 'data-node-id': item.id })
  const foreign = svgNode('foreignObject', { class: 'place-card-foreign', x: 0, y: 0, width: nodeW, height })
  const card = placeCard(item, height, model)
  foreign.append(card)
  const inPort = svgNode('circle', { class: 'graph-port', cx: 0, cy: 15, r: 4 })
  const outPort = svgNode('circle', { class: 'graph-port', cx: nodeW, cy: 15, r: 4 })
  group.append(foreign, inPort, outPort)
  const entry = { id: item.id, group, foreign, card, inPort, outPort, future: item.future }
  const select = event => {
    if (entry.future || event.target.closest?.('.tail-more')) return
    event.stopPropagation()
    openInspector({ kind: 'place', id: entry.id }, state.graph.model, state.graph.topology)
  }
  group.addEventListener('click', select)
  group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(event) } })
  return entry
}

function showNodeBirth(group) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  group.classList.remove('birth')
  requestAnimationFrame(() => group.classList.add('birth'))
  const clean = () => group.classList.remove('birth')
  group.addEventListener('animationend', clean, { once: true })
  setTimeout(clean, 700)
}

function renderComponents(model, topology = currentTopology(model)) {
  const flow = $('component-flow')
  const graph = ensureGraphShell(flow)
  graph.model = model
  graph.topology = topology
  const plannedComponents = (model.plan?.nodes || []).filter(item => item.level === 'component')
  const declarations = model.repository?.declarations || []
  const target = model.session?.target || model.daemon?.target || ''
  const siteSession = topology.nodes.length > 0 || model.session?.targetType === 'site' || model.daemon?.targetType === 'site' || /^https?:\/\//.test(target)
  const components = siteSession ? [] : plannedComponents
  const graphNodes = []
  const graphEdges = []

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
      const tasks = model.plan.nodes.filter(candidate => candidate.parent === component.id)
      const done = tasks.filter(task => task.status === 'done').length
      graphNodes.push({ id: component.id, depth: getDepth(component), group: 'plan', kind: 'component', address: component.id, title: component.title, stateLine: `${done} of ${tasks.length} tasks · ${component.status}`, status: component.status, rows: tasks.slice().reverse().map(task => ({ id: task.id, lead: task.status === 'done' ? 'Completed' : task.status === 'active' ? 'Working' : 'Planned', rest: task.title, time: '', status: task.status === 'blocked' ? 'failed' : task.status === 'active' ? 'awaiting' : 'confirmed' })) })
    }
    for (const component of components) for (const need of component.needs || []) if (byId[need]) graphEdges.push({ from: need, to: component.id, kind: 'dependency' })
  }

  if (siteSession) {
    graphNodes.push({
      id: topology.root.id,
      group: 'site',
      kind: 'site',
      address: topology.root.identity,
      identity: topology.root.identity,
      title: topology.root.title,
      stateLine: topology.root.stateLine,
      stateChangeId: topology.root.stateChangeId,
      lastChange: topology.root.lastChange,
      // The site root summarizes territory; repeating every child change here
      // would make one action appear twice on the same map.
      changes: [],
      flowState: topology.root.flowState,
      current: topology.root.current,
      topologyRoot: true,
    })
    for (const entity of topology.nodes) graphNodes.push({
      id: entity.id,
      group: 'site',
      kind: 'entity',
      entityType: entity.type,
      address: entity.identity,
      identity: entity.identity,
      title: entity.title,
      stateLine: entity.future ? 'Not reached yet' : ['declared', 'unconfirmed'].includes(entity.visibility) ? null : entity.stateLine,
      stateChangeId: entity.stateChangeId,
      lastChange: entity.lastChange,
      changes: entity.changes,
      future: entity.future,
      visibility: entity.visibility,
      territory: entity.territory,
      parentId: entity.parentId,
      ownerPlugin: entity.ownerPlugin,
      sizeTier: entity.sizeTier,
      flowState: entity.flowState,
      current: entity.current,
      seq: entity.lastSeq,
      topologyOrder: entity.order,
    })
    const futureIds = new Set(topology.nodes.filter(entity => entity.future).map(entity => entity.id))
    for (const edge of topology.edges) graphEdges.push({
      ...edge,
      kind: 'channel',
      label: displayChannel(edge.channel),
      future: edge.future || (futureIds.has(edge.to) && edge.flowState === 'idle'),
      duration: edge.durationMs,
    })
  }

  const labeledChannels = new Map()
  for (const edge of graphEdges.filter(edge => edge.kind === 'channel' && !edge.future)) {
    const current = labeledChannels.get(edge.channel)
    if (!current || edge.active) labeledChannels.set(edge.channel, edge)
  }
  let channelLabelIndex = 0
  for (const edge of graphEdges.filter(edge => edge.kind === 'channel')) {
    const representative = labeledChannels.get(edge.channel)
    if (representative?.id !== edge.id) edge.label = null
    else if (edge.active && edge.actor) {
      const actorName = typeof edge.actor === 'string' ? edge.actor : edge.actor.login || edge.actor.name
      edge.label = actorName ? `${displayChannel(edge.channel)} · ${actorName}` : displayChannel(edge.channel)
    }
    if (representative?.id === edge.id) edge.channelLabelIndex = channelLabelIndex++
  }

  if (!graphNodes.length && declarations.length) declarations.slice(0, 8).forEach((declaration, index) => graphNodes.push({
    id: `declaration-${index}`, depth: index, group: 'plan', kind: 'declaration', address: declaration.type, title: declaration.title || declaration.name, stateLine: declaration.type.replaceAll('-', ' '), rows: [],
  }))

  if (!graphNodes.length) {
    graph.empty.hidden = false
    graph.svg.hidden = true
    graph.controls.hidden = true
    for (const entry of graph.nodeElements.values()) entry.group.remove()
    for (const entry of graph.edgeElements.values()) entry.group.remove()
    for (const entry of graph.laneElements.values()) entry.group.remove()
    for (const entry of graph.containmentElements.values()) entry.path.remove()
    graph.nodeElements.clear()
    graph.edgeElements.clear()
    graph.laneElements.clear()
    graph.containmentElements.clear()
    return
  }
  graph.empty.hidden = true
  graph.svg.hidden = false
  graph.controls.hidden = false

  const compact = window.innerWidth <= 680
  const flowWidth = Math.max(320, flow.clientWidth || 1440)
  const flowHeight = Math.max(360, flow.clientHeight || window.innerHeight - 48)
  const nodeW = compact ? Math.min(320, Math.max(280, flowWidth - 48)) : 320
  const layoutNodeH = compact ? 238 : 220
  const gapX = compact ? 38 : 112
  const gapY = compact ? 28 : 24
  const padX = compact ? 24 : 42
  const edgeLabelStep = 17
  const padY = compact ? 56 : 44
  const metrics = Object.fromEntries(graphNodes.map(item => [item.id, { w: nodeW, h: cardHeight(item) }]))
  const planNodes = graphNodes.filter(item => item.group === 'plan')
  const siteNodes = graphNodes.filter(item => item.group === 'site')
  let layoutLanes = []

  const layoutPlan = items => {
    const columns = {}
    for (const item of items) (columns[item.depth || 0] ??= []).push(item)
    for (const [column, entries] of Object.entries(columns)) entries.forEach((item, row) => Object.assign(item, { x: padX + Number(column) * (nodeW + gapX), y: padY + row * (layoutNodeH + gapY) }))
  }
  layoutPlan(planNodes)
  if (siteNodes.length) {
    const layoutSessionId = model.session?.sessionId || model.daemon?.sessionId || state.sessionId || 'current'
    if (!state.layoutSeeds.has(layoutSessionId)) state.layoutSeeds.set(layoutSessionId, { desktopWrapColumns: 4 })
    const siteLayout = layoutSiteTopology(topology, { compact, nodeW, nodeH: layoutNodeH, nodeHeights: Object.fromEntries(Object.entries(metrics).map(([id, metric]) => [id, metric.h])), gapX, gapY, padX, padY, layoutSeed: state.layoutSeeds.get(layoutSessionId) })
    layoutLanes = siteLayout.lanes || []
    const positions = new Map(siteLayout.nodes.map(item => [item.id, item]))
    for (const item of siteNodes) {
      const position = positions.get(item.id) || { x: padX, y: padY, depth: 0 }
      Object.assign(item, { x: position.x, y: position.y, depth: position.depth })
    }
  }

  const occupiedNodes = graphNodes.filter(item => !item.future)
  const territoryFilterContext = model.session?.sessionId || model.daemon?.sessionId || state.sessionId || 'current'
  if (state.territoryFilterContext !== territoryFilterContext) {
    state.territoryFilter = 'all'
    state.territoryFilterContext = territoryFilterContext
  }
  const visibleTerritories = [...new Set(topology.nodes.filter(node => !node.future).map(node => node.territory).filter(Boolean))]
  if (state.territoryFilter !== 'all' && !visibleTerritories.includes(state.territoryFilter)) state.territoryFilter = 'all'
  const showTerritoryFilters = siteSession && topology.topologyVersion > 1 && topology.nodes.filter(node => !node.future).length > FULL_FIT_PLACE_LIMIT && visibleTerritories.length > 1
  graph.filters.hidden = !showTerritoryFilters
  if (showTerritoryFilters) {
    const labels = new Map((topology.territories || []).map(territory => [territory.id, territory.label]))
    const choices = ['all', ...visibleTerritories]
    for (const button of [...graph.filters.children]) if (!choices.includes(button.dataset.territory)) button.remove()
    for (const territory of choices) {
      let button = graph.filters.querySelector(`[data-territory="${territory}"]`)
      if (!button) {
        button = node('button', 'territory-filter')
        button.type = 'button'
        button.dataset.territory = territory
        button.addEventListener('click', () => {
          state.territoryFilter = button.dataset.territory
          state.fitFilteredOnRender = true
          render()
        })
        graph.filters.append(button)
      }
      button.textContent = territory === 'all' ? 'All' : labels.get(territory) || titleCase(territory)
      button.setAttribute('aria-pressed', String(state.territoryFilter === territory))
    }
  }
  const territoryAllows = item => !siteSession || state.territoryFilter === 'all' || item.topologyRoot || item.territory === state.territoryFilter
  const displayedNodes = occupiedNodes.filter(territoryAllows)
  const byGraphId = Object.fromEntries(graphNodes.map(item => [item.id, item]))
  const filteredGraphEdges = graphEdges.filter(edge => territoryAllows(byGraphId[edge.to] || {}))
  const renderedGraphEdges = siteSession ? visibleTopologyEdges(filteredGraphEdges, topology.nodes.filter(node => !node.future && territoryAllows(node)).length) : filteredGraphEdges
  const routedEdges = new Map(routeSiteTopologyEdges(graphNodes, renderedGraphEdges, { compact, nodeW, metrics, edgeLabelStep, regions: layoutLanes }).map(edge => [edge.id, edge]))

  const labelStacks = new Map()

  const wantedLanes = new Set()
  for (const lane of layoutLanes) {
    wantedLanes.add(lane.id)
    let entry = graph.laneElements.get(lane.id)
    if (!entry) {
      entry = createLaneElement(lane)
      graph.laneElements.set(lane.id, entry)
      graph.laneLayer.append(entry.group)
    }
    setSvgAttributes(entry.group, { class: `graph-lane${lane.kind === 'territory' ? ' territory-region' : ''}${lane.kind === 'plugin' ? ' plugin-subregion' : ''}${lane.compact ? ' compact' : ''}${lane.empty ? ' empty' : ''}`, 'data-territory': lane.territory, 'data-plugin-region': lane.plugin?.id })
    entry.group.hidden = state.territoryFilter !== 'all' && lane.territory !== state.territoryFilter
    setSvgAttributes(entry.frame, { x: lane.x, y: lane.y, width: lane.width, height: lane.height })
    setSvgAttributes(entry.label, { x: lane.labelX ?? lane.x + 12, y: lane.labelY ?? lane.y + (lane.empty ? 15 : 16) })
    entry.label.textContent = lane.label || lane.category
  }
  for (const [id, entry] of graph.laneElements) if (!wantedLanes.has(id)) { entry.group.remove(); graph.laneElements.delete(id) }

  const routedContainments = routeContainmentElbows(graphNodes, (topology.containments || []).filter(relation => territoryAllows(byGraphId[relation.childId] || {}) && territoryAllows(byGraphId[relation.parentId] || {})), { nodeW, metrics })
  const wantedContainments = new Set()
  for (const relation of routedContainments) {
    if (!relation.path) continue
    wantedContainments.add(relation.id)
    let entry = graph.containmentElements.get(relation.id)
    if (!entry) {
      entry = createContainmentElement(relation)
      graph.containmentElements.set(relation.id, entry)
      graph.containmentLayer.append(entry.path)
    }
    setSvgAttributes(entry.path, { d: relation.path, 'data-parent-id': relation.parentId, 'data-child-id': relation.childId })
  }
  for (const [id, entry] of graph.containmentElements) if (!wantedContainments.has(id)) {
    graph.containmentElements.delete(id)
    entry.path.classList.add('leaving')
    const remove = () => entry.path.remove()
    entry.path.addEventListener('transitionend', remove, { once: true })
    setTimeout(remove, 420)
  }

  const wantedEdges = new Set()
  for (const edge of renderedGraphEdges) {
    const from = byGraphId[edge.from], to = byGraphId[edge.to]
    if (!from || !to) continue
    wantedEdges.add(edge.id)
    const routed = routedEdges.get(edge.id)
    const pathData = routed?.path
    if (!pathData) continue
    const pathClass = `graph-edge ${edge.kind}${edge.flowState ? ` ${edge.flowState}` : ''}${edge.active ? ' active' : ''}${edge.future ? ' future' : ''}`
    let entry = graph.edgeElements.get(edge.id)
    if (!entry) {
      entry = createEdgeElement(edge)
      graph.edgeElements.set(edge.id, entry)
      graph.edgeLayer.append(entry.group)
    }
    entry.future = edge.future
    setSvgAttributes(entry.path, { d: pathData, class: pathClass, 'data-edge-id': edge.id, 'data-flow-state': edge.flowState, 'data-from': edge.from, 'data-to': edge.to, 'data-segment-count': routed.segmentCount, 'data-corner-count': routed.cornerCount, 'data-route-ink': Math.round(routed.ink || 0), 'data-entry-face': routed.entryFace, style: edge.active ? `--flow-duration:${edge.duration}ms` : null, 'aria-hidden': edge.future ? true : null, 'marker-end': edge.kind === 'link' || edge.future ? null : 'url(#graph-arrow)' })
    setSvgAttributes(entry.hit, { d: pathData, tabindex: edge.future ? null : 0, role: edge.future ? null : 'button', 'aria-label': edge.future ? null : `Inspect ${edge.label || edge.kind} flow`, 'data-edge-id': edge.id })
    entry.hit.hidden = edge.future
    if (edge.label && !edge.future) {
      const labelX = routed.labelX
      const labelYBase = routed.labelY
      const labelKey = `${Math.round(labelX / 48)}:${Math.round(labelYBase / 24)}`
      const stacked = labelStacks.get(labelKey) || 0
      labelStacks.set(labelKey, stacked + 1)
      setSvgAttributes(entry.label, { class: `graph-edge-label${edge.active ? ' active' : ''}`, x: labelX, y: labelYBase - stacked * edgeLabelStep, 'text-anchor': routed.labelAnchor })
      entry.label.textContent = edge.label.slice(0, 30)
      entry.label.toggleAttribute('hidden', false)
    } else entry.label.toggleAttribute('hidden', true)
    if (edge.active && !edge.future) {
      if (!entry.particle) {
        entry.particle = svgNode('circle', { r: 4, class: 'energy-particle', 'data-edge-id': edge.id })
        entry.motion = svgNode('animateMotion', { repeatCount: 'indefinite' })
        entry.particle.append(entry.motion)
        entry.group.append(entry.particle)
      }
      setSvgAttributes(entry.particle, { 'data-duration': edge.duration })
      setSvgAttributes(entry.motion, { dur: `${edge.duration}ms`, path: pathData })
    } else if (entry.particle) {
      entry.particle.remove()
      entry.particle = null
      entry.motion = null
    }
  }
  for (const [id, entry] of graph.edgeElements) if (!wantedEdges.has(id)) { entry.group.remove(); graph.edgeElements.delete(id) }

  const wantedNodes = new Set()
  for (const item of graphNodes) {
    wantedNodes.add(item.id)
    const selected = state.inspectorSelection?.kind === 'place' && state.inspectorSelection.id === item.id
    const flowClass = item.flowState || 'idle'
    const classes = `graph-node ${flowClass} ${item.kind}${selected ? ' selected' : ''}${item.future ? ' future' : ''}${item.visibility === 'declared' ? ' provisional' : ''}${item.visibility === 'unconfirmed' ? ' unconfirmed' : ''}${item.current ? ' current' : ''}${item.sizeTier === 'tombstone' ? ' tombstone' : ''}${territoryAllows(item) ? '' : ' filtered'}`
    const height = metrics[item.id].h
    let entry = graph.nodeElements.get(item.id)
    const created = !entry
    if (!entry) {
      entry = createNodeElement(item, nodeW, height, model)
      graph.nodeElements.set(item.id, entry)
      graph.nodeLayer.append(entry.group)
    }
    const group = entry.group
    const previous = state.nodePositions.get(item.id)
    if (previous && (previous.x !== item.x || previous.y !== item.y) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      group.querySelector('animateTransform')?.remove()
      const glide = svgNode('animateTransform', { attributeName: 'transform', type: 'translate', from: `${previous.x} ${previous.y}`, to: `${item.x} ${item.y}`, dur: '620ms', fill: 'freeze', calcMode: 'spline', keySplines: '.16 1 .3 1' })
      glide.addEventListener('endEvent', () => glide.remove(), { once: true })
      group.append(glide)
    }
    const becameVisible = entry.future && !item.future
    entry.future = item.future
    setSvgAttributes(group, { class: classes, 'data-node-kind': item.kind, 'data-node-group': item.group, 'data-territory': item.territory, 'data-parent-id': item.parentId, 'data-owner-plugin': item.ownerPlugin?.id, 'data-size-tier': item.sizeTier, 'data-flow-state': flowClass, transform: `translate(${item.x} ${item.y})`, tabindex: item.future ? null : 0, role: item.future ? null : 'button', 'aria-hidden': item.future ? true : null, 'aria-label': item.future ? null : `Inspect ${item.title}` })
    setSvgAttributes(entry.foreign, { width: nodeW, height })
    patchPlaceCard(entry.card, item, height, model)
    entry.inPort.hidden = Boolean(item.topologyRoot)
    setSvgAttributes(entry.inPort, { class: `graph-port${flowClass === 'live' ? ' live' : ''}` })
    setSvgAttributes(entry.outPort, { class: `graph-port${flowClass === 'live' ? ' live' : ''}`, cx: nodeW })
    if ((created && !item.future) || becameVisible) showNodeBirth(group)
  }
  for (const [id, entry] of graph.nodeElements) if (!wantedNodes.has(id)) { entry.group.remove(); graph.nodeElements.delete(id) }
  state.nodePositions = new Map(graphNodes.map(item => [item.id, { x: item.x, y: item.y }]))
  const cameraFrames = topologyCameraFrames({
    nodes: displayedNodes,
    edges: [...routedEdges.values()],
    lanes: layoutLanes.filter(lane => state.territoryFilter === 'all' || lane.territory === state.territoryFilter),
    metrics,
    nodeW,
  }, { aspect: window.innerWidth / Math.max(1, window.innerHeight - 48), minWidth: compact ? 390 : 720, minHeight: compact ? 720 : 420 })
  state.cameraBounds = cameraFrames.full
  if (state.fitFilteredOnRender) {
    state.camera = { ...cameraFrames.full }
    state.userMovedCamera = true
    state.fitFilteredOnRender = false
  }
  if (!state.userMovedCamera) {
    if (cameraFrames.mode === 'full') state.camera = { ...cameraFrames.full }
    else if (!state.camera || cameraFrames.focusEdge?.active) state.camera = { ...(cameraFrames.sentence || cameraFrames.full) }
  }
  updateCamera()
}

function inspectorSection(title) {
  const section = node('section', 'inspector-section')
  section.append(node('h3', '', title))
  return section
}

function factList(rows) {
  const list = node('dl', 'inspector-facts')
  for (const [label, value] of rows.filter(([, value]) => value !== undefined && value !== null && value !== '')) {
    const row = document.createElement('div')
    row.append(node('dt', '', label), node('dd', '', String(value)))
    list.append(row)
  }
  return list
}

function inspectorChanges(changes, model) {
  const section = inspectorSection('Changes')
  if (!changes.length) {
    section.append(node('p', 'inspector-empty', 'No changes are recorded for this place.'))
    return section
  }
  for (const change of [...changes].reverse()) {
    const entry = node('article', 'inspector-change')
    const head = node('div', 'inspector-change-head')
    head.append(node('strong', '', change.claim?.summary || change.confirmation?.summary || change.verb), node('time', '', formatClock(change.ts)))
    entry.append(head)
    const requestId = change.requestId
    const journey = requestId ? model.journeys?.[requestId] : null
    entry.append(factList([
      ['Claim', change.claim?.summary || 'No declared claim'],
      ['Confirmation', change.confirmation?.summary || (change.status === 'in-flight' ? 'Awaiting WordPress' : 'No confirmation')],
      ['Evidence', change.confirmations?.map(item => item.kind).join('\n')],
      ['Name at this change', change.state?.title || change.confirmation?.state?.title],
      ['Channel', displayChannel(change.channel)],
      ['Transport', change.transport || change.confirmation?.transport || change.claim?.transport],
      ['Request', requestId],
      ['Metadata', change.state?.metaKey || change.confirmation?.state?.metaKey],
      ['Latency', journey?.effectLatencyMs !== null && journey?.effectLatencyMs !== undefined ? duration(journey.effectLatencyMs) : null],
      ['Sequence', change.seq],
    ]))
    section.append(entry)
  }
  return section
}

function renderPlaceInspector(model, topology) {
  const panel = $('place-panel')
  const selection = state.inspectorSelection
  if (!selection) {
    panel.replaceChildren(node('p', 'inspector-empty', 'Select a place or flow to inspect its evidence.'))
    return
  }
  if (selection.kind === 'edge') {
    const edge = topology.edges.find(item => item.id === selection.id)
    if (!edge) {
      panel.replaceChildren(node('p', 'inspector-empty', 'This flow has not appeared at the current playhead.'))
      return
    }
    setText('inspector-title', displayChannel(edge.channel))
    setText('inspector-subtitle', 'Flow evidence')
    const facts = inspectorSection('Flow')
    facts.append(factList([
      ['Channel', displayChannel(edge.channel)],
      ['State', edge.flowState],
      ['Phase', edge.phase],
      ['Actor', typeof edge.actor === 'string' ? edge.actor : edge.actor?.login],
      ['Transports', edge.transports?.join(' · ')],
      ['Requests', edge.requests?.join('\n')],
      ['Recorded duration', duration(edge.durationMs)],
      ['Target', edge.to],
    ]))
    const place = topology.nodes.find(item => item.id === edge.to)
    panel.replaceChildren(facts, inspectorChanges(place?.changes?.filter(change => edge.requests?.includes(change.requestId)) || [], model))
    return
  }
  const place = selection.id === topology.root.id ? topology.root : topology.nodes.find(item => item.id === selection.id)
  if (!place || place.future) {
    panel.replaceChildren(node('p', 'inspector-empty', 'This place has not appeared at the current playhead.'))
    return
  }
  setText('inspector-title', place.title)
  setText('inspector-subtitle', `${titleCase(place.type)} · ${place.identity}`)
  const facts = inspectorSection('Place')
  facts.append(factList([
    ['Stable identity', place.id],
    ['Present state', place.stateLine],
    ['Territory', place.territoryLabel],
    ['Parent place', place.parentId],
    ['Owner', place.ownerPlugin?.label],
    ['Ownership evidence', place.ownerPlugin ? `${place.ownerPlugin.source} · ${place.ownerPlugin.confidence}` : null],
    ['Changes', place.changes?.length || 0],
    ['Channels', place.channels?.map(displayChannel).join(' · ')],
    ['Transports', place.transports?.join(' · ')],
    ['Plugins', place.plugins?.join(' · ')],
    ['Last sequence', place.lastSeq],
    ['System evidence', place.systemEvidence?.length || null],
  ]))
  panel.replaceChildren(facts, inspectorChanges(place.changes || [], model))
}

function renderTrailInspector() {
  const panel = $('trail-panel')
  const events = [...visibleTrailEvents()].sort((left, right) => left.seq - right.seq)
  if (!events.length) {
    panel.replaceChildren(node('p', 'inspector-empty', 'No trail rows have been recorded.'))
    return
  }
  const rows = events.map(event => {
    const row = node('div', 'trail-row')
    row.dataset.seq = String(event.seq)
    const copy = node('div', 'trail-copy')
    copy.append(node('strong', '', event.summary || summarizeEvent(event)), node('span', '', `${event.kind} · ${channel(event)}`))
    row.append(node('span', 'trail-seq', `#${event.seq}`), node('time', 'trail-time', formatClock(event.ts)), copy)
    return row
  })
  panel.replaceChildren(...rows)
}

function renderInspector(model, topology) {
  const open = Boolean(state.inspectorSelection)
  const shell = document.querySelector('.app-shell')
  shell.dataset.inspectorOpen = String(open)
  $('inspector').setAttribute('aria-hidden', String(!open))
  for (const button of document.querySelectorAll('[data-inspector-tab]')) button.setAttribute('aria-selected', String(button.dataset.inspectorTab === state.inspectorTab))
  $('place-panel').hidden = state.inspectorTab !== 'place'
  $('trail-panel').hidden = state.inspectorTab !== 'trail'
  renderPlaceInspector(model, topology)
  renderTrailInspector()
}

function openInspector(selection, model = currentProjection(), topology = currentTopology(model)) {
  state.inspectorSelection = selection
  state.inspectorTab = 'place'
  render(model)
  syncDeepLink()
  requestAnimationFrame(() => $('inspector-close').focus({ preventScroll: true }))
}

function closeInspector() {
  state.inspectorSelection = null
  document.querySelector('.app-shell').dataset.inspectorOpen = 'false'
  $('inspector').setAttribute('aria-hidden', 'true')
  document.querySelector('.graph-node.selected')?.classList.remove('selected')
  syncDeepLink()
}

function render(model = currentProjection()) {
  const event = state.mode === 'live' ? state.liveEvents.at(-1) : state.replayEvents[state.cursor]
  const clock = { context: `${state.sessionId || model.daemon?.sessionId || 'none'}:${state.mode}`, seq: event?.seq || 0 }
  state.renderDirection = state.renderClock?.context === clock.context
    ? clock.seq > state.renderClock.seq ? 'forward' : clock.seq < state.renderClock.seq ? 'backward' : 'none'
    : 'none'
  const topology = currentTopology(model)
  const shell = document.querySelector('.app-shell')
  shell.dataset.appState = 'ready'
  shell.dataset.mode = state.mode
  shell.dataset.playing = String(state.playing)
  renderHeader(model)
  renderWarnings(topology)
  renderSessions(model)
  renderOrbit(model, topology)
  renderComponents(model, topology)
  syncGraphPlaybackMotion()
  renderInspector(model, topology)
  state.renderClock = clock
}

function scheduleRender(model = currentProjection()) {
  state.pendingRenderModel = model
  if (state.renderFrame !== null) return
  state.renderFrame = requestAnimationFrame(() => {
    state.renderFrame = null
    const pending = state.pendingRenderModel
    state.pendingRenderModel = null
    render(pending)
  })
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
  const context = `${state.sessionId || 'none'}:live`
  if (state.cameraContext !== context) resetCamera(context)
  render(state.liveModel)
}

async function selectSession(sessionId, { updateUrl = true, renderNow = true } = {}) {
  stopPlayback()
  if (!sessionId) return
  if (sessionId === (state.liveModel.daemon?.sessionId || state.liveModel.session?.sessionId)) {
    state.mode = 'live'
    state.sessionId = sessionId
    state.inspectorSelection = null
    resetCamera(`${sessionId}:live`)
    syncModeButtons()
    if (renderNow) render(state.liveModel)
    if (updateUrl) syncDeepLink()
    return
  }
  state.replayEvents = playbackTrailEvents(await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/events`))
  state.replayIndex = buildReplayIndex(state.replayEvents)
  state.sessionId = sessionId
  state.mode = 'replay'
  state.cursor = Math.max(0, state.replayEvents.length - 1)
  state.inspectorSelection = null
  resetCamera(`${sessionId}:replay`)
  syncModeButtons()
  if (renderNow) render()
  if (updateUrl) syncDeepLink()
}

function syncModeButtons() {
  for (const button of document.querySelectorAll('.mode-switch button[data-mode]')) button.setAttribute('aria-selected', String(button.dataset.mode === state.mode))
}

function setMode(mode, { updateUrl = true } = {}) {
  stopPlayback()
  state.mode = mode
  state.inspectorSelection = null
  if (mode === 'live') {
    state.sessionId = state.liveModel.daemon?.sessionId
    state.cursor = Math.max(0, state.liveEvents.length - 1)
  } else {
    if (!state.replayEvents.length) {
      state.replayEvents = playbackTrailEvents(state.liveEvents)
      state.replayIndex = buildReplayIndex(state.replayEvents)
    }
    state.cursor = mode === 'timelapse' ? 0 : Math.max(0, state.replayEvents.length - 1)
  }
  resetCamera(`${state.sessionId || 'none'}:${mode}`)
  syncModeButtons()
  render()
  if (updateUrl) syncDeepLink()
  if (mode === 'timelapse' && state.replayEvents.length > 1) startPlayback()
}

async function applyDeepLink() {
  const params = new URLSearchParams(window.location.search)
  const requestedSession = params.get('session')
  const knownSession = requestedSession && state.sessions.some(session => session.id === requestedSession)
  const staleSession = Boolean(requestedSession && !knownSession)

  if (knownSession) await selectSession(requestedSession, { updateUrl: false, renderNow: false })

  if (!staleSession) {
    const requestedMode = params.get('mode')
    if (['live', 'replay', 'timelapse'].includes(requestedMode)) {
      const liveSessionId = state.liveModel.daemon?.sessionId || state.liveModel.session?.sessionId
      if (requestedMode === 'live' && (!requestedSession || requestedSession === liveSessionId)) {
        state.mode = 'live'
        state.sessionId = liveSessionId
        state.cursor = Math.max(0, state.liveEvents.length - 1)
      } else if (requestedMode !== 'live') {
        if (!state.replayEvents.length) {
          state.replayEvents = playbackTrailEvents(state.liveEvents)
          state.replayIndex = buildReplayIndex(state.replayEvents)
        }
        state.mode = requestedMode
        state.cursor = requestedMode === 'timelapse' ? 0 : Math.max(0, state.replayEvents.length - 1)
      }
    }

    if (state.mode !== 'live' && params.has('seq')) {
      const sequence = Number(params.get('seq'))
      const index = state.replayEvents.findLastIndex(event => event.seq <= sequence)
      if (index >= 0) state.cursor = index
    }

    const model = currentProjection()
    const topology = currentTopology(model)
    const placeId = params.get('place')
    const flowId = params.get('flow')
    if (placeId === topology.root.id || topology.nodes.some(place => place.id === placeId && !place.future)) state.inspectorSelection = { kind: 'place', id: placeId }
    else if (topology.edges.some(flow => flow.id === flowId && !flow.future)) state.inspectorSelection = { kind: 'edge', id: flowId }
    state.inspectorTab = state.inspectorSelection && params.get('tab') === 'trail' ? 'trail' : 'place'
  }

  state.urlReady = true
  syncModeButtons()
  render()
  syncDeepLink()
  if (state.mode === 'timelapse' && state.replayEvents.length > 1) startPlayback()
}

function stopPlayback() {
  state.playing = false
  clearTimeout(state.timer)
  state.timer = null
}

function isVisualPlaybackEvent(event) {
  return event?.kind !== 'presence.heartbeat'
}

function playbackTrailEvents(events) {
  return events.filter(isVisualPlaybackEvent)
}

function nextPlaybackCursor() {
  const last = state.replayEvents.length - 1
  let next = Math.min(last, state.cursor + 1)
  while (next < last && !isVisualPlaybackEvent(state.replayEvents[next])) next++
  return next
}

function playbackDelay(from, to) {
  const raw = Math.max(0, (state.replayEvents[to]?.ts || 0) - (state.replayEvents[from]?.ts || 0))
  if (state.mode === 'timelapse') return Math.max(STANDARD_TRANSITION_MS, Math.min(SLOW_TRANSITION_MS, raw * .035 || 420))
  return Math.max(STANDARD_TRANSITION_MS, Math.min(1200, raw || 420))
}

function schedulePlayback() {
  if (!state.playing) return
  const next = nextPlaybackCursor()
  if (next <= state.cursor || state.cursor >= state.replayEvents.length - 1) {
    stopPlayback()
    render()
    syncDeepLink()
    return
  }
  state.timer = setTimeout(() => {
    const previous = state.cursor
    state.cursor = next
    if (state.cursor >= state.replayEvents.length - 1) stopPlayback()
    render()
    syncDeepLink()
    if (state.playing) schedulePlayback(previous)
  }, playbackDelay(state.cursor, next))
}

function startPlayback() {
  if (state.playing || state.replayEvents.length < 2) return
  if (state.cursor >= state.replayEvents.length - 1) state.cursor = 0
  state.playing = true
  render()
  syncDeepLink()
  schedulePlayback()
}

function togglePlayback() {
  if (state.playing) {
    stopPlayback()
    render()
    return
  }
  startPlayback()
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
    if (item.kind === 'session.start' && item.data?.sessionId !== state.liveModel.session?.sessionId) {
      state.liveEvents = []
      state.liveModel = createProjection()
      state.sessionId = item.data.sessionId
      state.replayEvents = []
      state.replayIndex = null
      resetCamera(`${state.sessionId}:live`)
      fetchJson('/api/sessions').then(sessions => { state.sessions = sessions; scheduleRender(state.liveModel) }).catch(() => {})
    }
    if (!state.liveEvents.some(existing => existing.seq === item.seq)) state.liveEvents.push(item)
    state.liveModel = reduceEvent(state.liveModel, item)
    if (state.mode === 'live') {
      state.cursor = state.liveEvents.length - 1
      scheduleRender(state.liveModel)
    }
  })
  source.addEventListener('error', () => {
    $('connection-banner').hidden = false
    $('live-signal').dataset.status = 'offline'
    $('live-signal').querySelector('span').textContent = 'Reconnecting'
  })
}

for (const button of document.querySelectorAll('.mode-switch button[data-mode]')) button.addEventListener('click', event => {
  event.stopPropagation()
  setMode(button.dataset.mode)
})
for (const button of document.querySelectorAll('[data-inspector-tab]')) button.addEventListener('click', event => {
  event.preventDefault()
  event.stopPropagation()
  state.inspectorTab = button.dataset.inspectorTab
  renderInspector(currentProjection(), currentTopology(currentProjection()))
  syncDeepLink()
})
$('session-select').addEventListener('change', event => selectSession(event.target.value))
$('scrubber').addEventListener('input', event => {
  stopPlayback()
  state.cursor = Number(event.target.value)
  render()
  syncDeepLink()
})
$('playback').addEventListener('click', togglePlayback)
$('inspector').addEventListener('click', event => event.stopPropagation())
$('inspector-close').addEventListener('click', closeInspector)
$('inspector-scrim').addEventListener('click', closeInspector)
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.inspectorSelection) { closeInspector(); return }
  if (event.key === 'Escape' && state.playing) { stopPlayback(); render(); return }
  if (event.key === ' ' && state.mode !== 'live' && event.target === document.body) { event.preventDefault(); togglePlayback() }
})

loadLive().then(applyDeepLink).then(connectEvents).catch(error => {
  document.querySelector('.app-shell').dataset.appState = 'error'
  const empty = node('div', 'empty-board')
  empty.append(node('p', '', 'Aphelion could not open this trail.'), node('p', '', `${error.message}. Reload after the local daemon returns.`))
  $('component-flow').replaceChildren(empty)
  $('connection-banner').hidden = false
  $('connection-banner').querySelector('strong').textContent = 'Local board unavailable.'
  toast('Trail unavailable')
})
