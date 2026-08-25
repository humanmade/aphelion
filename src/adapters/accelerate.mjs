const ACCELERATE = /(?:accelerate|altis_ab_test|experiment|variant|audience|personalization)/i

export function adaptAccelerateEvent(event) {
  const data = event?.data || {}
  const identifiers = [data.name, data.metaKey, data.route, data.postType, data.title].filter(Boolean).join(' ')
  if (!ACCELERATE.test(identifiers)) return null
  let action = 'changed'
  if (/start|running|launch/i.test(identifiers)) action = 'launched'
  else if (/pause/i.test(identifiers)) action = 'paused'
  else if (/complete|winner|conclude/i.test(identifiers)) action = 'completed'
  else if (/variant/i.test(identifiers)) action = 'updated variants for'
  const subject = data.title || data.name || data.metaKey || data.route || 'an Accelerate experiment'
  return {
    source: 'adapter',
    kind: `adapter.accelerate.${action.replaceAll(' ', '_')}`,
    data: {
      ...data,
      adapter: 'altis-accelerate',
      summary: `Accelerate ${action} ${subject}`,
      rawKind: event.kind,
      confidence: data.route?.includes('accelerate/') || /altis_ab_test|accelerate/i.test(identifiers) ? 'high' : 'likely',
    },
  }
}
