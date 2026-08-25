// PLAN.md convention parser substantially derived from sodiumsun/agenttrail.
const COMPONENT_RE = /^##\s+(.+?)\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/i
const TASK_RE = /^\s*[-*]\s+\[( |x|~|!)\]\s+(.+?)\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/i
const META_RE = /^\s*(tech|by|from|horizon|needs|links|files|kind):\s*(.*?)\s*$/i
const DECISIONS_RE = /^##\s+decisions\s*$/i

function list(value) {
  const match = value.match(/^\[([^\]]*)\]$/)
  return (match ? match[1] : value).split(',').map(item => item.trim()).filter(Boolean)
}

export function parsePlan(text = '') {
  const nodes = []
  const decisions = []
  let title = ''
  let component = null
  let last = null
  let inDecisions = false
  for (const raw of String(text).split('\n')) {
    const line = raw.trimEnd()
    if (!title && /^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, '').trim()
      continue
    }
    if (DECISIONS_RE.test(line)) {
      inDecisions = true
      component = null
      last = null
      continue
    }
    let match
    if ((match = line.match(COMPONENT_RE))) {
      inDecisions = false
      component = {
        id: match[2], title: match[1], level: 'component', parent: null,
        needs: [], links: [], files: [], tech: '', by: '', from: '', kind: '', status: 'pending',
      }
      nodes.push(component)
      last = component
      continue
    }
    if (inDecisions) {
      if (/^\s*[-*]\s+/.test(line)) decisions.push(line.replace(/^\s*[-*]\s+/, ''))
      continue
    }
    if ((match = line.match(TASK_RE))) {
      const status = match[1] === 'x' ? 'done' : match[1] === '~' ? 'active' : match[1] === '!' ? 'blocked' : 'pending'
      last = {
        id: match[3], title: match[2], level: 'task', parent: component?.id || null,
        needs: [], links: [], files: [], tech: '', by: '', from: '', kind: '', status,
      }
      nodes.push(last)
      continue
    }
    if ((match = line.match(META_RE)) && last) {
      const key = match[1].toLowerCase()
      const value = match[2]
      if (['needs', 'links', 'files'].includes(key)) {
        if (last.level === 'component') last[key] = list(value)
      } else if (key === 'from' || key === 'horizon') {
        last.from = value === 'now' ? 'agent' : value === 'backlog' ? 'roadmap' : value
      } else {
        last[key] = value
      }
    }
  }
  for (const current of nodes.filter(node => node.level === 'component')) {
    const children = nodes.filter(node => node.parent === current.id)
    if (children.some(child => child.status === 'blocked')) current.status = 'blocked'
    else if (children.some(child => child.status === 'active')) current.status = 'active'
    else if (children.length && children.every(child => child.status === 'done')) current.status = 'done'
  }
  return { title, nodes, decisions }
}

export function globToRegExp(glob) {
  const escaped = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*').replaceAll('?', '.')
  return new RegExp(`^${escaped}${/[?*]/.test(glob) ? '' : '(?:/|$)'}`)
}

export function matchComponents(plan, file) {
  return plan.nodes
    .filter(node => node.level === 'component' && node.files.some(glob => globToRegExp(glob).test(file)))
    .map(node => node.id)
}
