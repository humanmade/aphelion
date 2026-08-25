# agenttrail code assessment (2026-08-25)

Snapshot reviewed: commit `41454d4` (2026-08-23). Verdict feeding the adopt-vs-rebuild decision: **adapt, don't rewrite**.

## Size

Real code is ~100KB total: `bin/agenttrail.mjs` (467 lines, zero dependencies) and `public/index.html` (80KB dense; ~1,970 lines CSS + ~840 lines JS when prettier-formatted). Everything else in the repo is logos, docs, and its own PLAN.md.

## Quality — daemon (read in full)

Careful, idiomatic, deliberate. Notables:

- Graceful degradation everywhere: recursive-`fs.watch` fallback for older Linux, port fallback on `EADDRINUSE`, hook relay capped at 400ms with silent failure so it can never block the agent.
- SSE with two message shapes: full model, and throttled "partial" activity ticks so the (potentially 600KB) tree isn't rebroadcast on every write. Tree refresh capped at 1/10s, ticks at 1/1s, hook ticks at ~3/s.
- Observed-state persistence under `~/.agenttrail/<repo-hash>.json` — survives daemon restarts, never touches the repo.
- Multi-repo: port-scan discovery (5330–5344) of sibling boards, `/whoami` handshake.
- Hook install is additive and idempotent into `.claude/settings.local.json`.
- Binds 127.0.0.1 only. No auth on the HTTP surface (fine for localhost posture; revisit if that posture ever changes).

## Quality — UI (sampled, ~250 of 840 JS lines)

Competent hand-rolled vanilla: single `M` model fed by EventSource, partial-tick merge, keyed re-render of the graph (renders only when a content hash changes), HTML escaping on interpolation, per-agent SVG icons/colors. No framework, no build step.

Weak points to watch as we extend:

- One 80KB single-line-ish HTML file will strain under feature growth (timelapse, WP panels). First real feature addition should split it into a few source files with a trivial concat step — keep the ship-one-file property, lose the edit-one-file pain.
- Plan parsing is line-regex based; fine for the convention, but the convention IS the API. Extending metadata (WP concepts) means extending the regex set carefully or versioning the convention.
- Component matching is glob→regex, per-write linear scan — fine at this scale.

## Extension points that matter for aphelion

- `/hook` accepts arbitrary POSTed JSON events → the level-2 WP sidecar (WP-CLI poll + debug.log tail) can feed the daemon without touching its core.
- The backfill prompt (in `init()`) is where WP-awareness enters at level 1 — a WP-flavored prompt that derives components from `block.json` / `register_*` declarations is a prompt change, not a code change.
- `PLAN.md` convention v2 parser: `files:` globs are the declared↔observed join. WP metadata would add typed component kinds (block, rest-route, cpt, admin-page).

## Provenance / license

MIT, single author (sodiumsun), 170 stars, current shape ~2 days old at review time — moving fast, no stable API. Vendored as a snapshot rather than tracked as a fork for that reason; diff against upstream deliberately, not automatically.
