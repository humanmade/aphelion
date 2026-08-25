export const CURRENT_TOPOLOGY_VERSION = 2

export function normalizeTopologyVersion(value) {
  const version = Number(value)
  return Number.isInteger(version) && version > 0 ? version : 1
}

export function recordedTopologyVersion(events) {
  const start = Array.from(events || []).find(event => event?.kind === 'session.start')
  return normalizeTopologyVersion(start?.data?.topologyVersion)
}
