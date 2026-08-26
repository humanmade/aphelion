# Changelog

All notable changes to Aphelion are documented here.

## 0.3.1 - 2026-08-26

Documentation release: the README carries the audit-and-governance positioning and
the new board hero, the CI test invocation works on the Node 20 floor, and the
license badge reads npm's metadata. No runtime changes.

## 0.3.0 - 2026-08-26

The motion and declared-half release: the board earns its flight-recorder name —
real agent claims land beside WordPress confirmations, and playback moves like an
instrument instead of a slideshow. Every change gated by a recorded video eval.

- Add the generic MCP tap: `aphelion mcp -- <server command>` transparently
  observes any stdio MCP server — presence with actor identity from the
  initialize handshake, each tool call as a declared claim (tool name and
  argument key names only, never values), byte-identical passthrough, fail-open
  when the daemon is down. Claims pair with observed effects by object or name
  within a bounded window, always labeled as inferred; exact request-id pairing
  wins when present.
- Add light mode: a complete paper token set switched by `data-theme`, following
  the system preference with a persisting chrome toggle; state hues re-tuned to
  hold 4.5:1 on light surfaces, enforced by computed-contrast specs.
- Rework playback continuity: evidence rows keep their identity across ticks
  (no more re-animating history), landings ease and overlap ticks, tombstone
  compaction glides reversibly, ambient energy pauses with the clock and
  resumes with playback, and presence relights places so claimed/live motion
  renders during replay.
- Add the anticipatory camera: the board opens anchored top-left at a legible
  settled scale and never rescales per arrival — growth runs right and down
  into runway; compact viewports pin a fixed column width and scroll. Desktop
  sessions seed three content columns (topology v3); earlier recordings keep
  their original geometry.
- Fix replay truthfulness regressions: presence events no longer reveal future
  places, and deep-linked moments resolve to the nearest real moment.

## 0.2.0 - 2026-08-26

The containment release: the board goes from a stack of equal tiles to a WordPress-shaped
map that stays truthful under replay, verified across seven live QA journeys.

- Add the WordPress containment model: territory regions (Content, Design, Structure,
  Plugins, Settings, People), plugin sub-regions, parent containment elbows, and
  owner-readable nouns; block, meta, and revision events fold into their parent place.
- Add `topologyVersion` to recorded sessions — old trails replay under the semantics they
  were recorded with, never silently reinterpreted.
- Add declared-claim ghost places: a claim reserves a visible provisional card, promoted in
  place on confirmation, persisting grey when a session ends unconfirmed.
- Add user and comment lifecycle observation (People territory; comments as evidence on
  their post) and an observer version handshake with a board-visible drift warning.
- Add session lifecycle: 30-minute idle cutoff with rotation, observer-shutdown session end,
  heartbeat-free replay denominators, and per-session site identity.
- Rework rendering: keyed patch renderer (no rebuild flicker), in-place birth reveals,
  cross-fading state transitions, persistent camera with full-fit/sentence framing,
  orthogonal shortest-path edge routing, full-canvas grid, tombstone compaction, and
  homogeneous change runs ("2 renames").
- Unify the timelapse renderer with the board projection — live, replay, and timelapse
  render identical geometry from one trail.
- Fix replay truthfulness: state, tombstones, and deep-link cursors are strictly
  playhead-derived; future events can no longer leak into earlier moments.

## 0.1.0 - 2026-08-25

- Add the append-only JSONL trail and shared live/replay reducer.
- Add the local dark-mode journey board and standalone HTML timelapse.
- Add repository, WordPress, WP-CLI, MCP, and Abilities API observation surfaces.
- Add the privacy-minimizing WordPress mu-plugin and Docker-friendly sidecar flow.
- Add an unscoped, zero-runtime-dependency npm package with CLI and typed ESM API.
- Add opt-in macOS and Linux background-service guidance; foreground execution remains the default.
- Add a public documentation index, expanded security model, and package-listing screenshot.
