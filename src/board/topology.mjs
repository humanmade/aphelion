// Site-entity projection: trail events resolve onto durable WordPress nouns.
import { recordedTopologyVersion } from '../trail/topology-version.mjs'
import { containmentFor, observedParentRelation, TERRITORY_LABELS, TERRITORY_ORDER } from '../wordpress/containment.mjs'

export const FULL_FIT_PLACE_LIMIT = 24
export const OVERVIEW_IDLE_EDGE_LIMIT = 24
export const DEFAULT_DESKTOP_CONTENT_COLUMNS = 3
export const LEGACY_DESKTOP_CONTENT_COLUMNS = 4

export function desktopContentColumnsForTopology(topologyVersion) {
  return Number(topologyVersion) >= 3 ? DEFAULT_DESKTOP_CONTENT_COLUMNS : LEGACY_DESKTOP_CONTENT_COLUMNS
}
// DEC-010 provisional limit: a generic MCP claim may match an observed place only in this trail-time window.
export const INFERRED_CONFIRMATION_WINDOW_MS = 30_000

const TERMINAL_PHASES = new Set(['close', 'disconnect', 'error', 'timeout'])
const DECLARED_KINDS = /(?:\.call|\.declared)$/
const CORE_OPTIONS = {
  blogdescription: 'Site tagline',
  blogname: 'Site title',
  page_for_posts: 'Posts page',
  page_on_front: 'Homepage',
  show_on_front: 'Homepage display',
}
const BOOKKEEPING_OPTIONS = new Set([
  'cron',
  'category_children',
  'rewrite_rules',
  'recently_edited',
  'user_count',
  'db_version',
  'initial_db_version',
  'finished_splitting_shared_terms',
])

const text = value => String(value ?? '').trim()
const isBookkeepingOption = value => {
  const name = text(value)
  return name.startsWith('_transient_') || name.startsWith('_site_transient_') || BOOKKEEPING_OPTIONS.has(name)
}
const isBookkeepingEvent = event => {
  const data = event?.data || {}
  const rawType = text(data.objectType || data.type).toLowerCase().replaceAll('_', '-')
  const optionName = data.option || (rawType === 'option' ? data.name ?? data.id : null)
  return optionName !== undefined && optionName !== null && isBookkeepingOption(optionName)
}
const titleCase = value => text(value)
  .replace(/^_+/, '')
  .replace(/^yoast_wpseo_/, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[-_./]+/g, ' ')
  .replace(/\b\w/g, character => character.toUpperCase())
  .replace(/\b(?:Seo|Wp|Cli|Mcp)\b/g, word => ({ Seo: 'SEO', Wp: 'WP', Cli: 'CLI', Mcp: 'MCP' })[word])

const isRevisionEvent = event => {
  const data = event?.data || {}
  const objectType = text(data.objectType || data.type).toLowerCase().replaceAll('_', '-')
  const postType = text(data.postType).toLowerCase().replaceAll('_', '-')
  return ['post', 'post-meta', 'postmeta'].includes(objectType) && ['revision', 'autosave'].includes(postType)
}

const revisionParentId = data => data.post_parent ?? data.postParent ?? data.parentId ?? data.parent

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
  if (type === 'user') return text(data.displayName || data.title) || `User #${identity}`
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

  if (isRevisionEvent(event)) {
    const parentId = revisionParentId(data)
    if (parentId === undefined || parentId === null || parentId === '' || Number(parentId) === 0) return null
    const type = text(data.parentPostType).toLowerCase() === 'page' ? 'page' : 'content'
    return {
      key: `wp:post:${parentId}`,
      identity: String(parentId),
      type,
      category: 'content',
      title: entityLabel(type, parentId, { ...data, title: null }),
      plugin: data.plugin || null,
    }
  }

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

  if (rawType === 'comment') {
    const postId = data.postId ?? data.commentPostId ?? data.comment_post_ID
    const postType = text(data.postType).toLowerCase()
    if (postId === undefined || postId === null || postId === '' || Number(postId) === 0 || !postType) return null
    const type = postType === 'page' ? 'page' : 'post'
    const postTitle = text(data.postTitle)
    return {
      key: `wp:post:${postId}`,
      identity: String(postId),
      type,
      category: 'content',
      title: postTitle || `Untitled ${type}`,
      plugin: data.plugin || null,
    }
  }

  if (rawType === 'term' && objectId !== undefined && objectId !== null) {
    const type = text(data.taxonomy).toLowerCase() === 'nav_menu' ? 'menu' : 'term'
    return {
      key: `wp:term:${objectId}`,
      identity: String(objectId),
      type,
      category: 'objects',
      title: entityLabel(type, objectId, data),
      plugin: data.plugin || null,
    }
  }

  if (rawType === 'user' && objectId !== undefined && objectId !== null) {
    return {
      key: `wp:user:${objectId}`,
      identity: String(objectId),
      type: 'user',
      category: 'objects',
      title: entityLabel('user', objectId, data),
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
  if (isRevisionEvent(event)) return `Revision ${event.kind.split('.').at(-1)}`
  if (event.kind.startsWith('wp.post_meta.')) return `${data.plugin ? `${titleCase(data.plugin)} ` : ''}metadata ${event.kind.split('.').at(-1)}`
  if (event.kind.startsWith('wp.post.')) return `${data.postType === 'page' ? 'Page' : 'Post'} ${event.kind.split('.').at(-1)}`
  if (event.kind.startsWith('wp.option.')) return `Setting ${event.kind.split('.').at(-1)}`
  if (event.kind === 'wp.user.created') return 'Created'
  if (event.kind === 'wp.user.role_changed') return `Role changed to ${titleCase(data.role || data.roles?.[0] || 'new role')}`
  if (event.kind === 'wp.user.deleted') return 'Deleted'
  if (event.kind === 'wp.comment.created') return 'Comment added'
  if (event.kind === 'wp.comment.deleted') return 'Comment removed'
  if (event.kind === 'wp.comment.status_changed') {
    const status = text(data.commentStatus || data.status).toLowerCase()
    if (['approve', 'approved', '1'].includes(status)) return 'Comment approved'
    if (['trash', 'deleted', 'delete'].includes(status)) return 'Comment removed'
    if (['hold', 'unapproved', '0'].includes(status)) return 'Comment held for review'
    if (status === 'spam') return 'Comment marked as spam'
    return 'Comment status changed'
  }
  if (event.kind.startsWith('wp.ability.')) return `Ability ${event.kind.split('.').at(-1)}`
  return event.kind.replaceAll('.', ' ')
}

function observedVerb(event) {
  if (isTitleOrNameChange(event)) return 'Renamed'
  if (event.kind === 'wp.user.role_changed') return `Role changed to ${titleCase(event.state?.role || event.data?.role || event.state?.roles?.[0] || 'new role')}`
  if (event.kind === 'wp.comment.created') return 'Comment added'
  if (event.kind === 'wp.comment.deleted') return 'Comment removed'
  if (event.kind === 'wp.comment.status_changed') {
    const status = text(event.state?.commentStatus || event.data?.commentStatus || event.data?.status).toLowerCase()
    if (['approve', 'approved', '1'].includes(status)) return 'Comment approved'
    if (['trash', 'deleted', 'delete'].includes(status)) return 'Comment removed'
    if (['hold', 'unapproved', '0'].includes(status)) return 'Comment held for review'
    if (status === 'spam') return 'Comment marked as spam'
    return 'Comment status changed'
  }
  const action = event.kind.split('.').at(-1)
  return ({
    created: 'Created',
    deleted: 'Deleted',
    executed: 'Executed',
    restored: 'Restored',
    trashed: 'Trashed',
    updated: 'Updated',
    changed: 'Changed',
    role_changed: 'Changed',
    status_changed: 'Changed',
  })[action] || titleCase(action)
}

function claimedVerb(event) {
  if (isTitleOrNameChange(event)) return 'Renaming…'
  if (event.kind.endsWith('.call')) return 'Calling…'
  const first = eventSummary(event).split(/\s+/)[0]?.toLowerCase()
  return ({
    change: 'Changing…',
    create: 'Creating…',
    delete: 'Deleting…',
    edit: 'Editing…',
    inspect: 'Inspecting…',
    restore: 'Restoring…',
    rename: 'Renaming…',
    set: 'Setting…',
    trash: 'Trashing…',
    update: 'Updating…',
  })[first] || 'Changing…'
}

function isTitleOrNameChange(event) {
  const properties = event?.data?.changedProperties || event?.state?.changedProperties
  if (!Array.isArray(properties) || !properties.length) return false
  return properties.every(property => ['title', 'name'].includes(text(property).toLowerCase()))
}

function stateData(event) {
  const data = event.data || {}
  const memberDetail = event.kind.startsWith('wp.comment.')
    ? 'comment'
    : event.kind.startsWith('wp.post_meta.')
      ? 'metadata'
      : isRevisionEvent(event)
        ? 'revision'
        : null
  return {
    title: text(data.title || data.displayName || data.objectName) || null,
    status: data.status || null,
    blockCount: Number.isFinite(data.blockCount) ? data.blockCount : null,
    restored: data.restored === true,
    beforeType: data.beforeType || null,
    afterType: data.afterType || data.valueType || null,
    metaKey: data.metaKey || null,
    changedProperties: Array.isArray(data.changedProperties) ? data.changedProperties : [],
    role: data.role || null,
    roles: Array.isArray(data.roles) ? data.roles : [],
    commentStatus: data.commentStatus || data.status || null,
    objectType: data.objectType || data.type || null,
    objectId: data.objectId ?? data.id ?? null,
    name: data.name ?? null,
    objectHintKeys: Array.isArray(data.objectHintKeys) ? data.objectHintKeys : [],
    memberDetail,
  }
}

function bareNameHint(event) {
  const data = event?.data || {}
  if (!text(data.name) || text(data.objectType || data.type)) return null
  if (data.objectId !== undefined || data.id !== undefined) return null
  if (!Array.isArray(data.objectHintKeys) || data.objectHintKeys.length !== 1) return null
  const hintKey = text(data.objectHintKeys[0]).split('.').at(-1)?.replace(/\[\]$/, '').toLowerCase()
  if (!['name', 'key'].includes(hintKey)) return null
  return text(data.name)
}

export function confirmationMatchLabel(value) {
  return ({
    'inferred-object-time': 'Matched by object and time, not request ID',
    'inferred-name-time': 'Matched by name and time, not request ID',
    'ambiguous-name': 'Name matched multiple existing places; no declared claim was paired',
  })[value] || null
}

function memberFamily(item) {
  if (item?.kind?.startsWith('wp.comment.')) return 'comment'
  if (item?.kind?.startsWith('wp.user.')) return 'user'
  return null
}

function memberPriority(item) {
  if (item?.kind?.endsWith('.deleted')) return 4
  if (item?.kind?.endsWith('.role_changed') || item?.kind?.endsWith('.status_changed')) return 3
  if (item?.kind?.endsWith('.created')) return 2
  return 1
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
        confirmations: [],
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
      rawKind: item.rawKind,
      adapter: item.adapter,
    }
    const memberCausal = [...changes].reverse().find(change => {
      if (!change.confirmation || !item.requestId || change.requestId !== item.requestId) return false
      if (Math.abs(item.ts - change.ts) > 1_000) return false
      const evidence = change.confirmations?.length ? change.confirmations : [change.confirmation]
      const previous = evidence.at(-1)
      return memberFamily(item) && memberFamily(item) === memberFamily(previous)
        && text(item.state?.objectId) && text(item.state?.objectId) === text(previous.state?.objectId)
    })
    if (memberCausal) {
      memberCausal.confirmations = [...(memberCausal.confirmations?.length ? memberCausal.confirmations : [memberCausal.confirmation]), confirmation]
      if (memberPriority(item) >= memberPriority(memberCausal.confirmation)) {
        Object.assign(memberCausal, {
          confirmation,
          verb: observedVerb(item),
          seq: item.seq,
          ts: item.ts,
          channel: item.channel || memberCausal.channel,
          actor: item.actor || memberCausal.actor,
          transport: item.transport || memberCausal.transport,
          state: item.state,
        })
      }
      continue
    }
    const causal = [...changes].reverse().find(change => {
      if (!change.confirmation || !item.requestId || change.requestId !== item.requestId) return false
      if (Math.abs(item.ts - change.ts) > 1_000) return false
      const evidence = change.confirmations?.length ? change.confirmations : [change.confirmation]
      return item.kind.startsWith('adapter.')
        ? evidence.some(entry => entry.kind === item.rawKind)
        : evidence.some(entry => entry.rawKind === item.kind)
    })
    if (causal) {
      causal.confirmations = [...(causal.confirmations?.length ? causal.confirmations : [causal.confirmation]), confirmation]
      if (item.kind.startsWith('adapter.')) {
        Object.assign(causal, {
          confirmation,
          verb: observedVerb(item),
          seq: item.seq,
          ts: item.ts,
          channel: item.channel || causal.channel,
          actor: item.actor || causal.actor,
          transport: item.transport || causal.transport,
          state: item.state,
        })
      }
      continue
    }
    if (open && !open.confirmation) {
      Object.assign(open, {
        confirmation,
        confirmations: [confirmation],
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
      // DEC-010: this is deliberately weaker than the exact request-ID branch above.
      // History is already scoped to one resolved place; the bounded forward time check
      // makes that visible relationship an inferred confirmation rather than a fact.
      const inferred = [...changes].reverse().find(change => !change.confirmation
        && change.state?.objectHintKeys?.length
        && item.ts >= change.ts
        && item.ts - change.ts <= INFERRED_CONFIRMATION_WINDOW_MS)
      if (inferred) {
        Object.assign(inferred, {
          confirmation,
          confirmations: [confirmation],
          confirmationMatch: inferred.state?.name && !inferred.state?.objectType && inferred.state?.objectId === null
            ? 'inferred-name-time'
            : 'inferred-object-time',
          verb: observedVerb(item),
          status: 'confirmed',
          seq: item.seq,
          ts: item.ts,
          channel: item.channel || inferred.channel,
          actor: item.actor || inferred.actor,
          transport: item.transport || inferred.transport,
          state: item.state,
        })
        continue
      }
      changes.push({
        id: `change:${id}:effect:${item.seq}`,
        requestId: item.requestId,
        claim,
        confirmation,
        confirmations: [confirmation],
        confirmationMatch: item.pairingAmbiguity ? 'ambiguous-name' : undefined,
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
  const placeConfirmations = confirmations.filter(change => !change.state?.memberDetail)
  const latest = placeConfirmations.at(-1)
  const relevant = placeConfirmations.map(change => change.state).filter(Boolean)
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
  if (entity.type === 'user') {
    const latestKind = latest?.confirmation?.kind || ''
    if (latestKind.endsWith('.deleted')) return 'Deleted'
    const role = [...relevant].reverse().find(state => state.role || state.roles?.length)
    return titleCase(role?.role || role?.roles?.[0] || (latestKind.endsWith('.created') ? 'Active' : 'User'))
  }
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
  if (isBookkeepingEvent(event)) return []
  const direct = resolveTopologyEntity(event)
  if (direct) return [direct.key]
  if (isRevisionEvent(event)) return []
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

function analyze(events, requestTargets, topologyVersion = 1) {
  const entities = new Map()
  const entityOrder = []
  const edges = new Map()
  const requestStates = new Map()
  const ambiguousNameClaims = []
  let currentTargets = []
  let currentEdgeKey = null

  const ensureEntity = (key, event) => {
    const direct = resolveTopologyEntity(event)
    const previous = entities.get(key)
    const fallback = direct || provisionalEntity(key, event) || { key, identity: key.split(':').at(-1), type: 'object', category: 'objects', title: titleCase(key.split(':').at(-1)), plugin: null }
    const containment = topologyVersion > 1 ? containmentFor(fallback, event) : null
    if (!previous) {
      entityOrder.push(key)
      entities.set(key, {
        ...fallback,
        ...(containment || {}),
        ...(topologyVersion > 1 ? { topologyVersion, parentId: null, parentHistory: [] } : {}),
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
    const nameHint = classification === 'declared' ? bareNameHint(event) : null
    const nameMatches = nameHint ? [...entities.values()].filter(entity => entity.identity === nameHint) : []
    const objectlessTapClaim = classification === 'declared'
      && Array.isArray(event.data?.objectHintKeys)
      && !resolveTopologyEntity(event)
    if (nameMatches.length > 1) ambiguousNameClaims.push({ name: nameHint, seq: event.seq, ts: event.ts, candidateCount: nameMatches.length })
    const eventTargets = nameMatches.length === 1
      ? [nameMatches[0].key]
      : objectlessTapClaim ? ['wp:site'] : targetsForEvent(event, requestTargets)
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
        if (key === 'wp:site') continue
        const entity = ensureEntity(key, event)
        entity.lastSeq = event.seq
        entity.lastAt = event.ts
        const resolved = resolveTopologyEntity(event)
        const merged = mergeEntity(entity, resolved || provisionalEntity(key, event) || entity)
        entity.identity = merged.identity
        entity.title = merged.title
        const observedTitle = classification === 'observed' && !isRevisionEvent(event) ? text(event.data?.title || event.data?.displayName || event.data?.objectName) : ''
        if (observedTitle) entity.title = observedTitle
        entity.type = merged.type
        entity.category = merged.category
        entity.provisionalIdentity = merged.provisionalIdentity
        if (topologyVersion > 1) {
          const containment = containmentFor(entity, event)
          entity.territory = containment.territory
          entity.ownerPlugin = containment.ownerPlugin || entity.ownerPlugin || null
          if (classification === 'observed') {
            const relation = observedParentRelation(event, entity)
            if (relation.present) {
              entity.parentId = relation.parentId
              entity.parentHistory.push({ seq: event.seq, ts: event.ts, parentId: relation.parentId })
            }
          }
        }
        entity.summary = eventSummary(event)
        const pairingAmbiguity = classification === 'observed' ? [...ambiguousNameClaims].reverse().find(claim => claim.name === entity.identity
          && event.ts >= claim.ts
          && event.ts - claim.ts <= INFERRED_CONFIRMATION_WINDOW_MS) : null
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
          state: {
            ...stateData(event),
            ...(topologyVersion > 1 ? { parentId: entity.parentId, territory: entity.territory, ownerPlugin: entity.ownerPlugin } : {}),
          },
          rawKind: event.data?.rawKind || null,
          adapter: event.data?.adapter || null,
          pairingAmbiguity,
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
  const containment = entity.topologyVersion > 1 ? {
    territory: entity.territory || 'general',
    territoryLabel: TERRITORY_LABELS[entity.territory] || TERRITORY_LABELS.general,
    parentId: entity.parentId || null,
    parentHistory: entity.parentHistory || [],
    ownerPlugin: entity.ownerPlugin || null,
  } : {}
  const changes = seen ? changeRecords(entity.history, sessionEnded) : []
  const latestChange = changes.at(-1) || null
  const stateChangeId = [...changes].reverse().find(change => change.confirmation && !change.state?.memberDetail)?.id || null
  if (visibility === 'blueprint-future') return {
    id: entity.key,
    ...containment,
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
    stateChangeId,
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
    ...containment,
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
    stateChangeId,
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
  const topologyVersion = recordedTopologyVersion(blueprintEvents)
  const blueprintRequestTargets = buildRequestTargets(blueprintEvents)
  const visibleRequestTargets = buildRequestTargets(visibleEvents)
  for (const event of visibleEvents) {
    const classification = topologyEventClass(event)
    const id = requestId(event)
    const targets = blueprintRequestTargets.get(id)
    // Presence may relight a place that already exists at the playhead using
    // the request's later observed target. analyze() still refuses to create
    // a place from presence alone, so future nouns remain future.
    if (classification === 'presence') {
      if (id && targets?.length) visibleRequestTargets.set(id, [...targets])
      continue
    }
    if (classification !== 'declared' || resolveTopologyEntity(event) || Array.isArray(event.data?.objectHintKeys)) continue
    if (id && targets?.some(key => provisionalEntity(key, event))) visibleRequestTargets.set(id, [...targets])
  }
  const blueprint = analyze(blueprintEvents, blueprintRequestTargets, topologyVersion)
  const visible = analyze(visibleEvents, visibleRequestTargets, topologyVersion)
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
  let nodes = blueprint.entityOrder.map((key, order) => {
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
  const systemEvidence = visibleEvents.filter(isBookkeepingEvent).map(event => ({
    seq: event.seq,
    ts: event.ts,
    kind: event.kind,
    summary: eventSummary(event),
    channel: channel(event),
    transport: transport(event),
    state: stateData(event),
  }))
  const observerReport = [...visibleEvents].reverse().find(event => event.kind === 'runtime.observer.version')?.data || null
  const warnings = observerReport && observerReport.status !== 'current' ? [{
    id: 'observer-version',
    message: 'Observer out of date — some activity may not be recorded',
    expectedVersion: observerReport.expectedVersion || null,
    reportedVersion: observerReport.reportedVersion || null,
  }] : []
  const focusEdge = visibleFlows.find(edge => edge.current) || null
  const focusChange = focusEdge
    ? [...allChanges].reverse().find(change => change.placeId === focusEdge.to && (!focusEdge.lastRequestId || change.requestId === focusEdge.lastRequestId)) || null
    : null
  const visibleNodeIds = new Set(nodes.filter(node => !node.future).map(node => node.id))
  const containments = topologyVersion > 1 ? nodes
    .filter(node => !node.future && node.parentId && visibleNodeIds.has(node.parentId))
    .map(node => ({ id: `containment:${node.id}:${node.parentId}`, childId: node.id, parentId: node.parentId })) : []
  if (topologyVersion > 1) {
    const parents = new Set(containments.map(relation => relation.parentId))
    nodes = nodes.map(node => ({
      ...node,
      sizeTier: !node.future
        && !parents.has(node.id)
        && /^(?:Deleted|Trash)(?:\s|·|$)/.test(text(node.stateLine))
        && !node.active
        && (sessionEnded || !node.current)
        ? 'tombstone'
        : 'standard',
    }))
  }
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
      history: systemEvidence,
      systemEvidence,
      changes: allChanges,
      stateLine: `${visibleNodes.length} ${visibleNodes.length === 1 ? 'place' : 'places'} touched${rootFlow ? ` · ${displayChannel(rootFlow.channel)} ${rootFlow.connected ? 'live' : rootFlow.active ? 'in flight' : 'idle'}` : ''}`,
      stateChangeId: allChanges.at(-1)?.id || (visibleEvents.at(-1)?.seq !== undefined ? `event:${visibleEvents.at(-1).seq}` : null),
      lastChange: allChanges.at(-1) || null,
      properties: [],
    },
    nodes,
    edges,
    currentTargets: visible.currentTargets,
    changes: allChanges,
    warnings,
    focus: focusChange && focusEdge ? { change: focusChange, edge: focusEdge, place: nodes.find(node => node.id === focusEdge.to) || null } : null,
    ...(topologyVersion > 1 ? {
      topologyVersion,
      territories: TERRITORY_ORDER.map(id => ({ id, label: TERRITORY_LABELS[id] })),
      containments,
    } : {}),
  }
}

const topologyChangeKey = change => change.confirmation?.kind || (change.status === 'in-flight' ? 'in-flight' : change.verb || 'change')

export function groupTopologyChanges(changes = []) {
  const groups = []
  for (const change of changes.filter(change => !/^_?wp_trash_meta(?:_|$)/i.test(text(change.state?.metaKey || change.confirmation?.state?.metaKey)))) {
    const previous = groups.at(-1)
    const sameKind = previous && topologyChangeKey(previous.at(-1)) === topologyChangeKey(change)
    const bothConfirmed = previous && previous.at(-1).status === 'confirmed' && change.status === 'confirmed'
    const sameRequest = previous?.at(-1).requestId && previous.at(-1).requestId === change.requestId
    if (sameKind && (bothConfirmed || sameRequest)) previous.push(change)
    else groups.push([change])
  }
  return groups
}

function runSemantic(change) {
  const kind = change.confirmation?.kind || ''
  const properties = change.state?.changedProperties || change.confirmation?.state?.changedProperties || []
  if (kind === 'wp.post.updated' && properties.length && properties.every(property => ['title', 'name'].includes(text(property).toLowerCase()))) return 'rename'
  if (kind === 'wp.post.updated' && properties.includes('content')) return 'block-edit'
  if (kind.startsWith('wp.post_meta.')) return `metadata-${kind.split('.').at(-1)}`
  const verb = text(change.verb).replace(/…$/, '').toLowerCase()
  return ({ renamed: 'rename', updated: 'update', restored: 'restore', created: 'create', deleted: 'delete', trashed: 'trash', executed: 'execute', changed: 'change' })[verb] || verb || 'change'
}

export function topologyRunLabel(group = []) {
  const semantics = [...new Set(group.map(runSemantic))]
  if (semantics.length === 1) return ({
    rename: 'renames',
    'block-edit': 'block edits',
    update: 'updates',
    restore: 'restorations',
    create: 'creations',
    delete: 'deletions',
    trash: 'trash actions',
    execute: 'executions',
    change: 'changes',
    'metadata-updated': 'metadata updates',
    'metadata-created': 'metadata creations',
    'metadata-deleted': 'metadata deletions',
  })[semantics[0]] || `${semantics[0].replaceAll('-', ' ')} changes`
  const kind = group.at(-1)?.confirmation?.kind || ''
  if (kind.startsWith('wp.post_meta.')) return 'metadata changes'
  if (kind === 'wp.post.updated') return 'updates'
  return 'changes'
}

export function siteCardHeight(item, options = {}) {
  if (item?.sizeTier === 'tombstone') return 58
  const groups = groupTopologyChanges(item?.changes || [])
  const stateLine = text(item?.stateLine)
  const base = 30 + (stateLine && stateLine !== 'No state recorded' && !item?.future ? 74 : 52)
  if (!groups.length) return base
  const visibleRows = options.expanded ? Math.min(groups.length, 8) : Math.min(groups.length, 3)
  return base + visibleRows * 29 + (groups.length > 3 ? 29 : 0)
}

export function buildSiteFrame(events, options = {}) {
  const topology = buildSiteTopology(events, options)
  const nodeHeights = {
    [topology.root.id]: siteCardHeight({ ...topology.root, changes: [] }),
    ...Object.fromEntries(topology.nodes.map(node => [node.id, siteCardHeight(node)])),
  }
  const layout = layoutSiteTopology(topology, { ...options, nodeHeights: options.nodeHeights || nodeHeights })
  return { topology, layout, nodeHeights: options.nodeHeights || nodeHeights }
}

function consecutiveGroups(values) {
  const groups = []
  for (const value of [...new Set(values)].toSorted((left, right) => left - right)) {
    if (groups.at(-1)?.at(-1) === value - 1) groups.at(-1).push(value)
    else groups.push([value])
  }
  return groups
}

function layoutContainmentTopology(topology, options = {}) {
  const compact = Boolean(options.compact)
  const padX = options.padX ?? (compact ? 24 : 42)
  const padY = options.padY ?? (compact ? 56 : 44)
  const nodeW = options.nodeW ?? 320
  const nodeH = options.nodeH ?? (compact ? 238 : 220)
  const gapX = options.gapX ?? (compact ? 38 : 112)
  const gapY = options.gapY ?? (compact ? 28 : 24)
  const columns = compact ? 1 : Math.max(1, Number(options.layoutSeed?.desktopWrapColumns || desktopContentColumnsForTopology(topology.topologyVersion)))
  const nodeHeights = options.nodeHeights || {}
  const columnStep = nodeW + gapX
  const rowStep = nodeH + Math.max(gapY, 68)
  const placed = [{ ...topology.root, x: padX, y: padY, depth: 0 }]
  const slots = new Map()
  const orderedNodes = [...topology.nodes].toSorted((left, right) => {
    const leftRank = TERRITORY_ORDER.indexOf(left.territory || 'general')
    const rightRank = TERRITORY_ORDER.indexOf(right.territory || 'general')
    return leftRank - rightRank || left.order - right.order
  })
  const territoryNodes = new Map(TERRITORY_ORDER.map(territory => [territory, orderedNodes.filter(node => (node.territory || 'general') === territory)]))
  const placeAt = (node, territory, row, column, x) => {
    placed.push({ ...node, x, y: padY + row * rowStep, depth: TERRITORY_ORDER.indexOf(territory) + 1 })
    slots.set(node.id, { territory, row, column })
  }

  if (compact) {
    let row = 1
    for (const territory of TERRITORY_ORDER) for (const node of territoryNodes.get(territory) || []) placeAt(node, territory, row++, 0, padX)
  } else {
    const content = territoryNodes.get('content') || []
    const worldColumns = columns + 1
    content.forEach((node, index) => {
      if (index < columns) placeAt(node, 'content', 0, index + 1, padX + (index + 1) * columnStep)
      else {
        const overflow = index - columns
        placeAt(node, 'content', 1 + Math.floor(overflow / worldColumns), overflow % worldColumns, padX + (overflow % worldColumns) * columnStep)
      }
    })
    let nextRow = content.length <= columns ? 1 : 2 + Math.floor((content.length - columns - 1) / worldColumns)
    const occupied = TERRITORY_ORDER.slice(1).filter(territory => (territoryNodes.get(territory) || []).length)
    let shelfColumn = 0
    for (const territory of occupied) {
      const nodes = territoryNodes.get(territory)
      if (nodes.length <= 2) {
        if (shelfColumn + nodes.length > columns) { nextRow++; shelfColumn = 0 }
        nodes.forEach((node, nodeIndex) => placeAt(node, territory, nextRow, shelfColumn + nodeIndex, padX + (shelfColumn + nodeIndex) * columnStep))
        shelfColumn += nodes.length
        if (shelfColumn === columns) { nextRow++; shelfColumn = 0 }
        continue
      }
      if (shelfColumn) { nextRow++; shelfColumn = 0 }
      nodes.forEach((node, nodeIndex) => placeAt(node, territory, nextRow + Math.floor(nodeIndex / columns), nodeIndex % columns, padX + (nodeIndex % columns) * columnStep))
      nextRow += Math.max(1, Math.ceil(nodes.length / columns))
    }
  }

  const visible = placed.filter(node => node.id === 'wp:site' || !node.future)
  const regions = []
  for (const territory of TERRITORY_ORDER) {
    const territoryNodes = visible.filter(node => node.id !== 'wp:site' && slots.get(node.id)?.territory === territory)
    if (!territoryNodes.length) continue
    const rows = territoryNodes.map(node => slots.get(node.id).row)
    consecutiveGroups(rows).forEach((rowGroup, fragmentIndex) => {
      const fragmentNodes = territoryNodes.filter(node => rowGroup.includes(slots.get(node.id).row))
      const left = Math.min(...fragmentNodes.map(node => node.x)) - 24
      const territoryTopPadding = territory === 'plugins' ? 64 : 24
      const top = Math.min(...fragmentNodes.map(node => node.y)) - territoryTopPadding
      const right = Math.max(...fragmentNodes.map(node => node.x + nodeW)) + 24
      const bottom = Math.max(...fragmentNodes.map(node => node.y + (nodeHeights[node.id] || nodeH))) + 24
      regions.push({
        id: `territory:${territory}:${fragmentIndex}`,
        kind: 'territory',
        territory,
        category: territory,
        label: TERRITORY_LABELS[territory] || TERRITORY_LABELS.general,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        labelX: left + 12,
        labelY: top + 16,
      })
    })
  }

  const pluginGroups = new Map()
  for (const node of visible.filter(node => node.id !== 'wp:site' && node.ownerPlugin && slots.get(node.id)?.territory === 'plugins')) {
    const key = node.ownerPlugin.id
    if (!pluginGroups.has(key)) pluginGroups.set(key, { plugin: node.ownerPlugin, nodes: [] })
    pluginGroups.get(key).nodes.push(node)
  }
  for (const { plugin, nodes } of pluginGroups.values()) {
    const left = Math.min(...nodes.map(node => node.x)) - 10
    const top = Math.min(...nodes.map(node => node.y)) - 34
    const right = Math.max(...nodes.map(node => node.x + nodeW)) + 10
    const bottom = Math.max(...nodes.map(node => node.y + (nodeHeights[node.id] || nodeH))) + 10
    regions.push({ id: `plugin-region:${plugin.id}`, kind: 'plugin', territory: 'plugins', category: 'plugins', plugin, label: plugin.label, x: left, y: top, width: right - left, height: bottom - top, labelX: left + 10, labelY: top + 16 })
  }

  const maxX = Math.max(...placed.map(node => node.x + nodeW), padX + nodeW)
  const maxY = Math.max(...placed.map(node => node.y + nodeH), padY + nodeH)
  return { nodes: placed, lanes: regions, regions, slots: Object.fromEntries(slots), edges: topology.edges, width: maxX + padX, height: maxY + padY, nodeW, nodeH }
}

export function layoutSiteTopology(topology, options = {}) {
  if (topology.topologyVersion > 1) return layoutContainmentTopology(topology, options)
  const compact = Boolean(options.compact)
  const padX = options.padX ?? (compact ? 24 : 52)
  const padY = options.padY ?? (compact ? 132 : 72)
  const nodeW = options.nodeW ?? (compact ? 316 : 360)
  const nodeH = options.nodeH ?? 164
  const gapX = options.gapX ?? (compact ? 38 : 112)
  const gapY = options.gapY ?? (compact ? 28 : 40)
  const categoryOrder = options.categoryOrder || ['content', 'settings', 'abilities', 'interfaces', 'objects', 'plugins']
  const categoryRank = new Map(categoryOrder.map((category, index) => [category, index]))
  // A session-stable logical seed, not viewport width or current place count,
  // owns wrapping. Recorded projection versions retain their original seed.
  const desktopWrapColumns = Math.max(1, Number(options.layoutSeed?.desktopWrapColumns || desktopContentColumnsForTopology(topology.topologyVersion)))
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
      const firstY = padY + nodeH + gapY + compactIndex * (nodeH + gapY)
      if (!empty) lanes.push({
        id: `lane:${category}`,
        category,
        compact: true,
        empty: false,
        x: padX,
        y: firstY - 16,
        width: nodeW,
        height: 0,
        labelX: padX,
        labelY: firstY - 10,
      })
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

export function routeSiteTopologyEdges(nodes, edges, options = {}) {
  const compact = Boolean(options.compact)
  const nodeW = options.nodeW ?? 320
  const metrics = options.metrics || {}
  const regions = options.regions || []
  const heightOf = id => metrics[id]?.h || metrics[id] || 104
  const byId = Object.fromEntries(nodes.map(node => [node.id, node]))
  const edgeGroups = new Map()
  for (const edge of edges) (edgeGroups.get(edge.to) || edgeGroups.set(edge.to, []).get(edge.to)).push(edge)
  const laneOffsets = new Map()
  for (const list of edgeGroups.values()) list.forEach((edge, index) => laneOffsets.set(edge.id, (index - (list.length - 1) / 2) * 12))

  const normalizePoints = points => {
    const unique = points.filter((point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1])
    const result = []
    for (const point of unique) {
      const previous = result.at(-1)
      const before = result.at(-2)
      if (before && previous && ((before[0] === previous[0] && previous[0] === point[0]) || (before[1] === previous[1] && previous[1] === point[1]))) result[result.length - 1] = point
      else result.push(point)
    }
    return result
  }
  const pathFromPoints = points => points.slice(1).reduce((path, point, index) => {
    const previous = points[index]
    return `${path}${previous[1] === point[1] ? 'H' : 'V'}${previous[1] === point[1] ? point[0] : point[1]}`
  }, `M${points[0][0]} ${points[0][1]}`)
  const routeInk = points => points.slice(1).reduce((total, point, index) => total + Math.abs(point[0] - points[index][0]) + Math.abs(point[1] - points[index][1]), 0)
  const segmentBlocked = (start, end, ignoredIds) => nodes.some(node => {
    if (ignoredIds.has(node.id) || node.future) return false
    const left = node.x
    const right = node.x + nodeW
    const top = node.y
    const bottom = node.y + heightOf(node.id)
    if (start[1] === end[1]) {
      const y = start[1]
      return y > top && y < bottom && Math.max(Math.min(start[0], end[0]), left) < Math.min(Math.max(start[0], end[0]), right)
    }
    const x = start[0]
    return x > left && x < right && Math.max(Math.min(start[1], end[1]), top) < Math.min(Math.max(start[1], end[1]), bottom)
  })
  const rowGutterY = target => {
    // Each wrapped row owns the clear strip immediately above it. Using the
    // territory's top for every row makes later branches descend through the
    // cards in earlier rows.
    if (compact) return target.y - 36
    const territory = regions.find(region => region.kind === 'territory'
      && region.territory === target.territory
      && target.x >= region.x && target.x <= region.x + region.width
      && target.y >= region.y && target.y <= region.y + region.height)
    // A first-row territory shares the real gap after the preceding enclosure
    // so its branch cannot run through either territory band. Wrapped rows use
    // their local inter-row strip to avoid every card above them.
    if (territory && target.y - territory.y <= 70) {
      const sharedRow = regions.filter(region => region.kind === 'territory'
        && target.y >= region.y && target.y <= region.y + region.height)
      const rowTop = Math.min(...sharedRow.map(region => region.y), territory.y)
      const previousBottom = Math.max(rowTop - 24, ...regions.filter(region => region.kind === 'territory'
        && region.y + region.height <= rowTop).map(region => region.y + region.height))
      return previousBottom + (rowTop - previousBottom) / 2
    }
    return target.y - 12
  }
  const regionSegmentBlocked = (start, end, targetTerritory) => regions.some(region => {
    if (region.kind !== 'territory' || region.territory === targetTerritory) return false
    if (start[1] === end[1]) {
      const y = start[1]
      return y > region.y && y < region.y + region.height && Math.max(Math.min(start[0], end[0]), region.x) < Math.min(Math.max(start[0], end[0]), region.x + region.width)
    }
    const x = start[0]
    return x > region.x && x < region.x + region.width && Math.max(Math.min(start[1], end[1]), region.y) < Math.min(Math.max(start[1], end[1]), region.y + region.height)
  })

  return edges.map(edge => {
    const from = byId[edge.from]
    const to = byId[edge.to]
    if (!from || !to) return { ...edge, path: null }
    const laneOffset = laneOffsets.get(edge.id) || 0
    const ignored = new Set([from.id, to.id])
    const fromHeight = heightOf(from.id)
    const toHeight = heightOf(to.id)
    const sameRow = Math.abs(from.y - to.y) < 1
    const forward = to.x >= from.x
    let pathPoints
    let entryFace
    if (sameRow) {
      const directStart = [from.x + (forward ? nodeW : 0), from.y + 15 + laneOffset]
      const directEnd = [to.x + (forward ? 0 : nodeW), to.y + 15 + laneOffset]
      if (!segmentBlocked(directStart, directEnd, ignored)) {
        pathPoints = [directStart, directEnd]
        entryFace = forward ? 'left' : 'right'
      } else {
        const gutterY = rowGutterY(to)
        pathPoints = [[from.x + nodeW / 2 + laneOffset, from.y], [from.x + nodeW / 2 + laneOffset, gutterY], [to.x + nodeW / 2 + laneOffset, gutterY], [to.x + nodeW / 2 + laneOffset, to.y]]
        entryFace = 'top'
      }
    } else if (to.y > from.y) {
      const directStart = [from.x + nodeW / 2 + laneOffset, from.y + fromHeight]
      const directEnd = [to.x + nodeW / 2 + laneOffset, to.y]
      if (Math.abs(directStart[0] - directEnd[0]) < 1 && !segmentBlocked(directStart, directEnd, ignored)) {
        pathPoints = [directStart, directEnd]
      } else {
        const gutterY = rowGutterY(to)
        const nearRight = from.x + nodeW + 24
        const nearLeft = from.x - 24
        const regionLeft = Math.min(...regions.filter(region => region.kind === 'territory').map(region => region.x), from.x) - 12
        const regionRight = Math.max(...regions.filter(region => region.kind === 'territory').map(region => region.x + region.width), from.x + nodeW) + 12
        const candidates = [to.x >= from.x ? nearRight : nearLeft, regionLeft, regionRight]
          .filter((value, index, list) => list.indexOf(value) === index)
          .filter(value => !regionSegmentBlocked([value, from.y + 15 + laneOffset], [value, gutterY], to.territory))
          .toSorted((left, right) => Math.abs((from.x + nodeW / 2) - left) + Math.abs((to.x + nodeW / 2) - left) - (Math.abs((from.x + nodeW / 2) - right) + Math.abs((to.x + nodeW / 2) - right)))
        const gutterX = candidates[0] ?? regionLeft
        const routeRight = gutterX >= from.x + nodeW / 2
        pathPoints = [[from.x + (routeRight ? nodeW : 0), from.y + 15 + laneOffset], [gutterX, from.y + 15 + laneOffset], [gutterX, gutterY], [to.x + nodeW / 2 + laneOffset, gutterY], [to.x + nodeW / 2 + laneOffset, to.y]]
      }
      entryFace = 'top'
    } else {
      const gutterY = Math.max(...regions.filter(region => region.kind === 'territory' && to.y >= region.y && to.y <= region.y + region.height).map(region => region.y + region.height), to.y + toHeight) + 12
      pathPoints = [[from.x + nodeW / 2 + laneOffset, from.y], [from.x + nodeW / 2 + laneOffset, gutterY], [to.x + nodeW / 2 + laneOffset, gutterY], [to.x + nodeW / 2 + laneOffset, to.y + toHeight]]
      entryFace = 'bottom'
    }
    pathPoints = normalizePoints(pathPoints)
    const path = pathFromPoints(pathPoints)
    // Camera framing owns the local landing sentence, not every corridor the
    // route needed to traverse a large map. The target, label, and final
    // ingress segment are sufficient to keep the spoken subject whole.
    const sentencePoints = pathPoints.slice(-2)
    const resting = edge.kind === 'channel' && !edge.active && !edge.current
    const vertical = entryFace === 'top' || entryFace === 'bottom' || compact
    const xs = pathPoints.map(point => point[0])
    const ys = pathPoints.map(point => point[1])
    const sentenceXs = sentencePoints.map(point => point[0])
    const sentenceYs = sentencePoints.map(point => point[1])
    return {
      ...edge,
      laneOffset,
      path,
      segmentCount: Math.max(0, pathPoints.length - 1),
      cornerCount: Math.max(0, pathPoints.length - 2),
      ink: routeInk(pathPoints),
      entryFace,
      labelX: resting ? from.x + nodeW + 8 : vertical ? to.x + nodeW / 2 + laneOffset : forward ? to.x - 18 : to.x + nodeW + 18,
      labelY: resting ? from.y + 19 + (edge.channelLabelIndex || 0) * (options.edgeLabelStep || 17) : vertical ? to.y - 12 : to.y - 10,
      labelAnchor: resting ? 'start' : vertical ? 'middle' : forward ? 'end' : 'start',
      bounds: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
      sentenceBounds: { x: Math.min(...sentenceXs), y: Math.min(...sentenceYs), width: Math.max(...sentenceXs) - Math.min(...sentenceXs), height: Math.max(...sentenceYs) - Math.min(...sentenceYs) },
    }
  })
}

export function routeContainmentElbows(nodes, containments, options = {}) {
  const nodeW = options.nodeW ?? 320
  const metrics = options.metrics || {}
  const heightOf = id => metrics[id]?.h || metrics[id] || 104
  const byId = Object.fromEntries(nodes.map(node => [node.id, node]))
  return containments.map(relation => {
    const parent = byId[relation.parentId]
    const child = byId[relation.childId]
    if (!parent || !child) return { ...relation, path: null }
    const parentCenterY = parent.y + heightOf(parent.id) / 2
    const childCenterY = child.y + heightOf(child.id) / 2
    const forward = child.x >= parent.x
    const fromX = parent.x + (forward ? nodeW : 0)
    const toX = child.x + (forward ? 0 : nodeW)
    const elbowX = fromX + (toX - fromX) / 2
    return { ...relation, path: `M${fromX} ${parentCenterY}H${elbowX}V${childCenterY}H${toX}` }
  })
}

export function visibleTopologyEdges(edges = [], placeCount = 0, options = {}) {
  const limit = Math.max(1, Number(options.limit || OVERVIEW_IDLE_EDGE_LIMIT))
  if (placeCount <= (options.fullFitLimit || FULL_FIT_PLACE_LIMIT) || edges.length <= limit) return [...edges]
  return [...edges]
    .toSorted((left, right) => Number(Boolean(right.active || right.current)) - Number(Boolean(left.active || left.current)) || (right.lastSeq || 0) - (left.lastSeq || 0))
    .slice(0, limit)
    .toSorted((left, right) => (left.lastSeq || 0) - (right.lastSeq || 0))
}

function unionBounds(bounds) {
  const valid = bounds.filter(item => item && [item.x, item.y, item.width, item.height].every(Number.isFinite))
  if (!valid.length) return { x: 0, y: 0, width: 1, height: 1 }
  const left = Math.min(...valid.map(item => item.x))
  const top = Math.min(...valid.map(item => item.y))
  const right = Math.max(...valid.map(item => item.x + item.width))
  const bottom = Math.max(...valid.map(item => item.y + item.height))
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

function paddedAspectBounds(bounds, aspect, padding) {
  let x = bounds.x - padding
  let y = bounds.y - padding
  let width = bounds.width + padding * 2
  let height = bounds.height + padding * 2
  const targetAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9
  if (width / height > targetAspect) {
    const nextHeight = width / targetAspect
    y -= (nextHeight - height) / 2
    height = nextHeight
  } else {
    const nextWidth = height * targetAspect
    x -= (nextWidth - width) / 2
    width = nextWidth
  }
  return { x, y, width, height }
}

function minimumAspectBounds(bounds, aspect, minWidth, minHeight) {
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const targetAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9
  let width = Math.max(bounds.width, minWidth || 0)
  let height = Math.max(bounds.height, minHeight || 0)
  if (width / height > targetAspect) height = width / targetAspect
  else width = height * targetAspect
  return { x: centerX - width / 2, y: centerY - height / 2, width, height }
}

function edgeLabelBounds(edge) {
  if (!edge?.label || !Number.isFinite(edge.labelX) || !Number.isFinite(edge.labelY)) return null
  const width = Math.max(36, text(edge.label).length * 7.4)
  const x = edge.labelAnchor === 'start' ? edge.labelX : edge.labelAnchor === 'end' ? edge.labelX - width : edge.labelX - width / 2
  return { x, y: edge.labelY - 13, width, height: 17 }
}

export function topologyCameraFrames(input = {}, options = {}) {
  const nodes = (input.nodes || []).filter(node => !node.future && !node.filtered)
  const edges = (input.edges || []).filter(edge => !edge.future && edge.path)
  const lanes = (input.lanes || []).filter(lane => !lane.hidden)
  const metrics = input.metrics || {}
  const nodeW = options.nodeW || input.nodeW || 320
  const heightOf = id => metrics[id]?.h || metrics[id] || nodes.find(node => node.id === id)?.height || 104
  const aspect = options.aspect || 16 / 9
  const fullContent = unionBounds([
    ...nodes.map(node => ({ x: node.x, y: node.y, width: nodeW, height: heightOf(node.id) })),
    ...lanes.map(lane => ({ x: lane.x, y: lane.y, width: lane.width, height: lane.height })),
    ...edges.map(edgeLabelBounds),
  ])
  const full = minimumAspectBounds(paddedAspectBounds(fullContent, aspect, options.fullPadding ?? 32), aspect, options.minWidth ?? 720, options.minHeight ?? 420)
  const focusEdge = edges.find(edge => edge.current) || edges.find(edge => edge.active) || null
  const target = focusEdge ? nodes.find(node => node.id === focusEdge.to) : null
  const sentenceContent = target ? unionBounds([
    focusEdge.sentenceBounds || focusEdge.bounds,
    edgeLabelBounds(focusEdge),
    { x: target.x, y: target.y, width: nodeW, height: heightOf(target.id) },
  ]) : null
  const sentence = sentenceContent ? minimumAspectBounds(paddedAspectBounds(sentenceContent, aspect, options.sentencePadding ?? 56), aspect, options.minWidth ?? 720, options.minHeight ?? 420) : null
  const placeCount = nodes.filter(node => node.id !== 'wp:site').length
  return { full, sentence, focusEdge, target, placeCount, mode: placeCount > (options.fullFitLimit || FULL_FIT_PLACE_LIMIT) && sentence ? 'sentence' : 'full' }
}
