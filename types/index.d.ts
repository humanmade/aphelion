export type TrailSource = 'session' | 'watcher' | 'hook' | 'plan' | 'cli' | 'mcp' | 'wp' | 'sidecar' | 'adapter' | string

export interface TrailEvent<T = Record<string, unknown>> {
  v: number
  ts: number
  seq: number
  source: TrailSource
  kind: string
  data: T
  receivedAt?: number
  prev?: string
}

export interface TrailWriterOptions {
  target?: string
  targetType?: 'project' | 'site'
  sessionId?: string
  trailDirectory?: string
  agent?: string | null
  version?: string
  hostname?: string
  integrity?: boolean
  clock?: () => number
}

export class TrailWriter {
  constructor(options?: TrailWriterOptions)
  readonly sessionId: string
  readonly path: string
  readonly closed: boolean
  append(source: TrailSource, kind: string, data?: Record<string, unknown>, options?: { ts?: number }): TrailEvent
  close(data?: Record<string, unknown>): void
}

export function createTrailWriter(options?: TrailWriterOptions): TrailWriter
export function iterateTrail(filePath: string, options?: { onMalformed?: (details: { line: number; text: string; error: Error }) => void }): AsyncGenerator<TrailEvent>
export function readTrail(filePath: string, options?: { onMalformed?: (details: { line: number; text: string; error: Error }) => void }): Promise<TrailEvent[]>
export function discoverSessions(target: string, options?: { targetType?: 'project' | 'site'; trailDirectory?: string }): Promise<Array<{ id: string; path: string; size: number; mtimeMs: number; start: TrailEvent | null }>>
export function createProjection(): Record<string, unknown>
export function reduceEvent(state: Record<string, unknown>, event: TrailEvent): Record<string, unknown>
export function projectEvents(events: Iterable<TrailEvent>, initial?: Record<string, unknown>): Record<string, unknown>
export function summarizeEvent(event: TrailEvent): string
export interface ReplayIndex {
  stride: number
  length: number
  lastSeq: number | null
  snapshots: Array<{ cursor: number; projection: Record<string, unknown> }>
}
export function buildReplayIndex(events: Iterable<TrailEvent>, options?: { stride?: number }): ReplayIndex
export function projectReplay(events: Iterable<TrailEvent>, cursor: number, index?: ReplayIndex | null): Record<string, unknown>
export function createSessionId(date?: Date): string
export function resolveTrailDirectory(target: string, options?: { targetType?: 'project' | 'site'; homeDirectory?: string }): string
export function resolveTrailPath(target: string, sessionId: string, options?: { targetType?: 'project' | 'site'; homeDirectory?: string }): string
export function slugifyTarget(target: string): string
export function redactPayload(value: unknown): unknown

export interface PlanNode {
  id: string
  title: string
  level: 'component' | 'task'
  parent: string | null
  status: 'pending' | 'active' | 'blocked' | 'done'
  needs: string[]
  links: string[]
  files: string[]
  tech: string
  by: string
  from: string
  kind: string
}

export interface PlanProjection {
  title: string
  nodes: PlanNode[]
  decisions: string[]
}

export interface DaemonOptions extends TrailWriterOptions {
  port?: number
  watch?: boolean
  auditLog?: string
  debugLog?: string
  wpCommand?: string[]
  sidecarInterval?: number
}

export interface AphelionDaemon {
  target: string
  targetType: 'project' | 'site'
  url: string
  port: number
  trailPath: string
  sessionId: string
  readonly projection: Record<string, unknown>
  emit(source: TrailSource, kind: string, data?: Record<string, unknown>, options?: { ts?: number }): TrailEvent
  close(reason?: string): Promise<void>
}

export function parsePlan(text?: string): PlanProjection
export function matchComponents(plan: PlanProjection, file: string): PlanNode[]
export function classifyHookEvent(event?: Record<string, unknown>): Array<{ source: string; kind: string; data: Record<string, unknown> }>
export function watchRepository(root: string, onChange: (file: string, at: number) => void): () => void
export function startDaemon(options?: DaemonOptions): Promise<AphelionDaemon>
export function relayHook(raw: string, options?: { port?: number | string }): Promise<void>
export function scanWordPress(root: string, options?: { maxFiles?: number }): { target: string; files: string[]; declarations: Array<Record<string, unknown>>; truncated: boolean }
export function startSidecar(options: { emit: (source: string, kind: string, data: Record<string, unknown>, options?: { ts?: number }) => TrailEvent; auditLog?: string; debugLog?: string; wpCommand?: string[]; intervalMs?: number; transport?: string }): () => void
export function adaptAccelerateEvent(event: TrailEvent): { source: string; kind: string; data: Record<string, unknown> } | null
export function renderFrameSvg(projection: Record<string, unknown>, event: TrailEvent, options?: { width?: number; height?: number; progress?: number }): string
export function renderTimelapse(input: string | TrailEvent[], output: string, options?: { maxFrames?: number; width?: number; height?: number; fps?: number }): Promise<{ output: string; frames: number }>
