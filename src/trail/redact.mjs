const SECRET_KEY = /(?:pass(?:word)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|client[-_]?secret)/i
const BEARER = /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/gi
const APP_PASSWORD = /\b[a-z0-9]{4}(?:\s+[a-z0-9]{4}){5}\b/gi
const MAX_STRING = 2_000

function redactString(value) {
  const clean = value.replace(BEARER, '[redacted authorization]').replace(APP_PASSWORD, '[redacted application password]')
  return clean.length > MAX_STRING ? `${clean.slice(0, MAX_STRING)}…` : clean
}

export function redactPayload(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.slice(0, 200).map(item => redactPayload(item, seen))
  const output = {}
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    output[key] = SECRET_KEY.test(key) ? '[redacted]' : redactPayload(item, seen)
  }
  return output
}
