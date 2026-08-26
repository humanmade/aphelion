import { normalizeTopologyVersion } from './topology-version.mjs'

const RECENT_LIMIT = 160

export function createProjection() {
  return {
    v: 1,
    cursor: 0,
    now: 0,
    session: null,
    topologyVersion: 1,
    status: 'idle',
    plan: { title: '', nodes: [], decisions: [] },
    repository: { target: '', files: [], declarations: [], truncated: false },
    activity: [],
    connections: {},
    wordpress: { actions: [], objects: {}, baseline: null },
    journeys: {},
    counts: { total: 0, declared: 0, observed: 0, errors: 0 },
    recent: [],
  }
}

function cloneProjection(state) {
  return {
    ...state,
    plan: { ...state.plan, nodes: [...state.plan.nodes], decisions: [...state.plan.decisions] },
    repository: { ...state.repository, files: [...state.repository.files], declarations: [...state.repository.declarations] },
    activity: [...state.activity],
    connections: { ...state.connections },
    wordpress: { ...state.wordpress, actions: [...state.wordpress.actions], objects: { ...state.wordpress.objects } },
    journeys: { ...(state.journeys || {}) },
    counts: { ...state.counts },
    recent: [...state.recent],
  }
}

function sourceClass(event) {
  if (event.kind.startsWith('tool.') || event.kind.includes('.call') || event.kind.endsWith('.declared') || event.kind.startsWith('plan.')) return 'declared'
  if (event.kind.startsWith('file.') || event.kind.startsWith('wp.') || event.kind.startsWith('adapter.') || event.kind.startsWith('runtime.')) return 'observed'
  return null
}

function connectionKey(event) {
  const identity = event.data.connectionId || event.data.sessionId || `${event.data.channel || event.source}:${event.data.actor || 'unknown'}`
  return `${event.source}:${String(identity)}`
}

function objectKey(data) {
  return `${data.objectType || data.type || 'object'}:${data.objectId || data.id || data.name || 'unknown'}`
}

function updateJourney(state, event, classification) {
  const id = event.data?.requestId || event.data?.correlationId
  if (!id) return
  const previous = state.journeys[id] || { id, phases: [], startedAt: event.ts, declaredAt: null, observedAt: null, lastAt: event.ts }
  const phase = {
    seq: event.seq,
    ts: event.ts,
    receivedAt: event.receivedAt || event.ts,
    kind: event.kind,
    source: event.source,
    class: event.kind.startsWith('presence.') ? 'presence' : classification || 'record',
    summary: summarizeEvent(event),
    channel: event.data?.channel || null,
    transport: event.data?.transport || null,
  }
  const declaredAt = previous.declaredAt ?? (classification === 'declared' ? event.ts : null)
  const observedAt = previous.observedAt ?? (classification === 'observed' ? event.ts : null)
  state.journeys[id] = {
    ...previous,
    summary: previous.summary || (classification === 'declared' ? phase.summary : null),
    channel: previous.channel || phase.channel || null,
    transport: previous.transport || phase.transport || null,
    phases: [...previous.phases, phase],
    startedAt: Math.min(previous.startedAt, event.ts),
    lastAt: event.ts,
    declaredAt,
    observedAt,
    effectLatencyMs: declaredAt !== null && observedAt !== null ? Math.max(0, observedAt - declaredAt) : null,
    captureLagMs: event.receivedAt ? Math.max(0, event.receivedAt - event.ts) : previous.captureLagMs ?? null,
    status: observedAt !== null ? 'observed' : /(?:error|timeout)$/.test(event.kind) ? 'error' : 'active',
  }
}

export function summarizeEvent(event) {
  const data = event.data || {}
  if (data.summary) return String(data.summary)
  if (event.kind === 'session.start') return `Started observing ${data.target || 'the target'}`
  if (event.kind === 'session.end') return 'Observation session ended'
  if (event.kind === 'plan.snapshot') return `Mapped ${data.nodes?.filter?.(node => node.level === 'component').length || 0} parts of the project`
  if (event.kind === 'file.write') return `Updated ${data.file || 'a project file'}`
  if (event.kind === 'tool.pre') return `Started ${data.tool || 'an agent action'}`
  if (event.kind === 'tool.post') return `Finished ${data.tool || 'an agent action'}`
  if (event.kind === 'mcp.ability.call') return `Requested ${data.ability || data.tool || 'a WordPress ability'}`
  if (event.kind.startsWith('presence.')) {
    const rawChannel = String(data.channel || (typeof data.actor === 'string' ? data.actor : data.actor?.login) || 'Connection')
    const connection = ({ 'wp-cli': 'WP-CLI', mcp: 'MCP', rest: 'REST', 'wp-admin': 'wp-admin', runtime: 'Runtime' })[rawChannel.toLowerCase()] || rawChannel
    const phase = event.kind.slice(9)
    const phrase = ({ open: 'connected', ready: 'ready', heartbeat: 'active', reconnect: 'reconnected', close: 'disconnected', disconnect: 'disconnected', timeout: 'timed out', error: 'connection error' })[phase] || phase.replaceAll('.', ' ')
    return `${connection} ${phrase}`
  }
  if (event.kind.startsWith('wp.post.')) return data.label || `WordPress ${data.postType === 'page' ? 'page' : 'post'} ${event.kind.slice('wp.post.'.length).replaceAll('.', ' ')}`
  if (event.kind.startsWith('wp.post_meta.')) return data.label || `${data.plugin ? `${data.plugin} ` : 'WordPress '}metadata ${event.kind.slice('wp.post_meta.'.length).replaceAll('.', ' ')}`
  if (event.kind.startsWith('wp.option.')) return data.label || `${data.name || data.option || 'WordPress setting'} ${event.kind.slice('wp.option.'.length).replaceAll('.', ' ')}`
  if (event.kind === 'runtime.observer.version') return data.status === 'current' ? 'Observer version current' : 'Observer out of date'
  if (event.kind.startsWith('wp.')) return data.label || `WordPress ${event.kind.slice(3).replaceAll('.', ' ')}`
  return event.kind.replaceAll('.', ' ')
}

export function reduceEvent(input, event) {
  const state = cloneProjection(input || createProjection())
  state.cursor = event.seq
  state.now = event.ts
  state.counts.total++
  const classification = sourceClass(event)
  if (classification) state.counts[classification]++
  if (event.kind.includes('error') || event.data?.error) state.counts.errors++
  updateJourney(state, event, classification)

  if (event.kind === 'session.start') {
    state.topologyVersion = normalizeTopologyVersion(event.data?.topologyVersion)
    state.session = { ...event.data, topologyVersion: state.topologyVersion, startedAt: event.ts }
    state.status = 'live'
  } else if (event.kind === 'session.end') {
    state.status = 'ended'
    state.session = state.session ? { ...state.session, endedAt: event.ts, end: event.data } : null
  } else if (event.kind === 'plan.snapshot') {
    state.plan = {
      title: event.data.title || '',
      nodes: Array.isArray(event.data.nodes) ? event.data.nodes : [],
      decisions: Array.isArray(event.data.decisions) ? event.data.decisions : [],
    }
  } else if (event.kind === 'repo.snapshot') {
    state.repository = {
      target: event.data.target || '',
      files: Array.isArray(event.data.files) ? event.data.files : [],
      declarations: Array.isArray(event.data.declarations) ? event.data.declarations : [],
      truncated: Boolean(event.data.truncated),
      capturedAt: event.ts,
    }
  } else if (event.kind.startsWith('presence.')) {
    const key = connectionKey(event)
    const phase = event.kind.slice('presence.'.length)
    const previous = state.connections[key] || {}
    state.connections[key] = {
      ...previous,
      ...event.data,
      id: key,
      phase,
      openedAt: previous.openedAt || event.ts,
      lastSeenAt: event.ts,
      active: !['close', 'timeout', 'error', 'disconnect'].includes(phase),
    }
  }

  if (event.kind === 'file.write' || event.kind.startsWith('tool.') || event.kind.startsWith('mcp.') || event.kind.endsWith('.declared')) {
    state.activity.unshift({ seq: event.seq, ts: event.ts, source: event.source, kind: event.kind, summary: summarizeEvent(event), ...event.data })
    state.activity.length = Math.min(state.activity.length, RECENT_LIMIT)
  }

  if (event.kind.startsWith('wp.') || event.kind.startsWith('adapter.') || event.kind.startsWith('runtime.')) {
    const action = { seq: event.seq, ts: event.ts, source: event.source, kind: event.kind, summary: summarizeEvent(event), ...event.data }
    state.wordpress.actions.unshift(action)
    state.wordpress.actions.length = Math.min(state.wordpress.actions.length, RECENT_LIMIT)
    if (event.data && (event.data.objectId || event.data.id || event.data.name)) {
      state.wordpress.objects[objectKey(event.data)] = action
    }
    if (event.kind === 'runtime.baseline') state.wordpress.baseline = event.data
  }

  state.recent.unshift({ seq: event.seq, ts: event.ts, source: event.source, kind: event.kind, summary: summarizeEvent(event), data: event.data })
  state.recent.length = Math.min(state.recent.length, RECENT_LIMIT)
  return state
}

export function projectEvents(events, initial = createProjection()) {
  let state = initial
  for (const event of events) state = reduceEvent(state, event)
  return state
}
