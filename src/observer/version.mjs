export const SHIPPED_OBSERVER_VERSION = '0.1.0'

export function observerVersionStatus(reported, expected = SHIPPED_OBSERVER_VERSION) {
  const reportedVersion = String(reported || '').trim()
  const expectedVersion = String(expected || SHIPPED_OBSERVER_VERSION).trim()
  return {
    reportedVersion: reportedVersion || null,
    expectedVersion,
    status: reportedVersion === expectedVersion ? 'current' : reportedVersion ? 'outdated' : 'missing',
  }
}
