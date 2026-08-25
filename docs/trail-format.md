# The trail — format v0

The trail is aphelion's core primitive: one append-only event log per session, owned and written by aphelion itself. Every surface (live board, replay, timelapse) is a projection of it. This spec is what a builder implements first.

## Storage

- **Project targets** (a repo aphelion is watching): `.aphelion/trail/<session-id>.jsonl` inside the project, gitignored. The trail lives with the work it describes.
- **Site targets** (phase 3, no local repo): `~/.aphelion/trails/<target-slug>/<session-id>.jsonl`, where the target slug is derived from the site URL.
- Sessions are discovered by listing the directory — no index file to corrupt. Each file's first event carries the session metadata.
- **Nothing auto-deletes.** The trail is the user's data; retention is their call. The daemon may warn about size, never prune silently.
- Upstream agenttrail's rolling state file (`~/.agenttrail/<hash>.json`) becomes a derived cache in aphelion, never the record.

## Why not the agent's own session folder

Claude Code transcripts, Codex session dirs, and similar are transient, undocumented formats subject to cleanup, rotation, and format drift. aphelion captures events **at emission time** — from hooks, the file watcher, and site-side observers — and writes them to its own log immediately. If the agent's artifacts vanish afterward, the trail is unaffected.

## Envelope

One JSON object per line (JSONL), UTF-8, flushed per write:

```json
{"v":1,"ts":1756100000000,"seq":42,"source":"hook","kind":"tool.post","data":{...}}
```

| Field | Meaning |
|---|---|
| `v` | Envelope schema version (integer). Bump only on breaking change. |
| `ts` | Event time, ms epoch, as observed by the daemon |
| `seq` | Monotonic per-session counter — total order even if the clock jumps |
| `source` | Where the event was observed: `watcher` \| `hook` \| `mcp` \| `wp` \| `cli` \| `plan` \| `session` |
| `kind` | Event type, namespaced by source (e.g. `file.write`, `tool.pre`, `wp.option.updated`, `presence.open`) |
| `data` | Kind-specific payload. Unknown fields must be preserved by readers. |

First event of every file is `kind: "session.start"` with `data` carrying target (repo path or site URL), agent identity if known, aphelion version, and hostname. Sessions end with `session.end` when observed; readers must tolerate its absence (crashes happen).

## Rules

- **Append-only.** Never rewrite a line. Corrections and late information are new events.
- **Streamable.** Projections must be computable in one forward pass without holding the whole log in memory; replay scrubbing may build a sparse snapshot index (derived, cache, regenerable).
- **Tolerant readers.** Skip lines that fail to parse; never abort a render over one bad line.
- **No secrets.** Payloads carry paths, identifiers, and summaries — never credentials, tokens, or request bodies known to contain them. Site-side observers redact at the source.
- **Declared and observed are distinct events**, correlated by projections (by time, path, or explicit correlation ids in `data`) — never merged at write time. The juxtaposition is the product; the log keeps both raw.
