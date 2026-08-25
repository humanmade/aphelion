export const TERRITORY_ORDER = ['content', 'design', 'structure', 'plugins', 'settings', 'people', 'general']

export const TERRITORY_LABELS = {
  content: 'Content',
  design: 'Design',
  structure: 'Structure',
  plugins: 'Plugins',
  settings: 'Settings',
  people: 'People',
  general: 'General',
}

const PLUGIN_ALIASES = {
  accelerate: ['altis-accelerate', 'Altis Accelerate'],
  'altis-accelerate': ['altis-accelerate', 'Altis Accelerate'],
  yoast: ['yoast-seo', 'Yoast SEO'],
  'yoast-seo': ['yoast-seo', 'Yoast SEO'],
  'wordpress-seo': ['yoast-seo', 'Yoast SEO'],
}

const titleCase = value => String(value || '').replace(/^_+/, '').replace(/[-_./]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())

function pluginRecord(value, source, confidence) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  const [id, label] = PLUGIN_ALIASES[raw] || [raw, titleCase(raw)]
  return { id, label, source, confidence }
}

export function pluginOwnership(data = {}) {
  const explicit = data.ownerPlugin || data.plugin
  if (explicit) return pluginRecord(explicit, 'event', 'high')
  const identity = String(data.name || data.option || data.metaKey || '').toLowerCase()
  if (/^accelerate_/.test(identity)) return pluginRecord('altis-accelerate', 'prefix', 'medium')
  if (/^(?:_yoast_|wpseo_|_yoast_wpseo_)/.test(identity)) return pluginRecord('yoast-seo', 'prefix', 'medium')
  return null
}

export function containmentFor(entity, event) {
  const ownerPlugin = pluginOwnership(event?.data)
  const type = String(entity?.type || '').toLowerCase()
  let territory = 'general'
  if (['page', 'post', 'content', 'attachment', 'media', 'revision'].includes(type)) territory = 'content'
  else if (['template', 'template-part', 'theme', 'global-style', 'pattern'].includes(type)) territory = 'design'
  else if (['menu', 'navigation', 'term', 'taxonomy', 'post-type', 'route', 'ability', 'interface'].includes(type)) territory = 'structure'
  else if (type === 'plugin' || (type === 'option' && ownerPlugin)) territory = 'plugins'
  else if (type === 'option') territory = 'settings'
  else if (['user', 'role', 'person'].includes(type)) territory = 'people'
  return { territory, ownerPlugin }
}

export function observedParentRelation(event, entity) {
  const data = event?.data || {}
  const keys = ['parentId', 'postParent', 'post_parent', 'parent']
  const key = keys.find(candidate => Object.hasOwn(data, candidate))
  if (!key) return { present: false, parentId: null }
  const value = data[key]
  if (value === null || value === '' || Number(value) === 0) return { present: true, parentId: null }
  const type = String(entity?.type || data.objectType || '').toLowerCase()
  if (['page', 'post', 'content', 'attachment', 'media'].includes(type)) return { present: true, parentId: `wp:post:${value}` }
  if (type === 'term') return { present: true, parentId: `wp:term:${value}` }
  const parentType = String(data.parentObjectType || data.parentType || '').trim().toLowerCase().replaceAll('_', '-')
  return parentType ? { present: true, parentId: `wp:${parentType}:${value}` } : { present: false, parentId: null }
}
