import { createProjection, reduceEvent } from '../trail/reducer.mjs'

export function buildReplayIndex(events, options = {}) {
  const list = Array.from(events || [])
  const stride = Math.max(1, Math.trunc(options.stride || 100))
  const snapshots = [{ cursor: -1, projection: createProjection() }]
  let projection = snapshots[0].projection

  for (let cursor = 0; cursor < list.length; cursor++) {
    projection = reduceEvent(projection, list[cursor])
    if ((cursor + 1) % stride === 0 || cursor === list.length - 1) snapshots.push({ cursor, projection })
  }

  return { stride, length: list.length, lastSeq: list.at(-1)?.seq ?? null, snapshots }
}

export function projectReplay(events, cursor, index = null) {
  const list = Array.from(events || [])
  const target = Math.min(list.length - 1, Math.max(-1, Math.trunc(cursor)))
  if (target < 0) return createProjection()
  const usable = index && index.length === list.length && index.lastSeq === (list.at(-1)?.seq ?? null)
    ? index
    : buildReplayIndex(list, { stride: index?.stride })
  let snapshot = usable.snapshots[0]
  for (const candidate of usable.snapshots) {
    if (candidate.cursor > target) break
    snapshot = candidate
  }
  let projection = snapshot.projection
  for (let position = snapshot.cursor + 1; position <= target; position++) projection = reduceEvent(projection, list[position])
  return projection
}
