# aphelion

## Record the trail {#trail}
tech: append-only JSONL per session, spec docs/trail-format.md
files: [src/trail/**]
- [x] Write every observed event to a durable local log {#trail-write}
  by: codex
  from: roadmap
- [x] Reopen any past session from its log {#trail-read}
  from: roadmap

## Watch the repo and the agent {#observe-repo}
tech: adapt upstream daemon (watcher, Claude hooks, PLAN.md parser) into src/
needs: [trail]
files: [src/daemon/**]
- [x] Adapt the agenttrail daemon to emit trail events {#observe-repo-adapt}
  from: roadmap
- [x] Derive the map from WordPress declarations (block.json, register_*) {#observe-repo-wpmap}
  from: roadmap
- [x] End idle sessions and rotate the next real action into a fresh trail {#observe-repo-session-rollover}
  from: post-0.1 QA

## See the site {#observe-site}
tech: sidecar (WP-CLI poll + debug.log tail), audit mu-plugin, MCP tap — docs/observation-surfaces.md
needs: [trail]
links: [observe-repo]
files: [src/sidecar/**, src/mu-plugin/**]
- [x] Stream runtime drift via the sidecar {#observe-site-sidecar}
  from: roadmap
- [x] Catch every channel at the hook layer via the mu-plugin {#observe-site-muplugin}
  from: roadmap
- [x] Show who is connected right now {#observe-site-presence}
  from: roadmap
- [x] Observe user lifecycle and record comment lifecycle as evidence on its post {#observe-site-people-comments}
  from: layman QA
- [x] Record comment parent identity and report deployed observer-version drift {#observe-site-member-context}
  from: member-evidence QA

## Show the work live {#board}
tech: adapt upstream public/index.html; split into concat-able sources
needs: [observe-repo]
files: [src/board/**]
- [x] Serve the live board from trail projections {#board-live}
  from: roadmap
- [x] Patch durable place and flow elements without rebuilding the canvas {#board-keyed-render}
  from: post-0.1 QA
- [x] Reveal declared places, preserve the camera, and group places into stable lanes {#board-live-language}
  from: post-0.1 QA
- [x] Refresh observed place names and wrap desktop lanes with a stable layout seed {#board-place-refresh-wrap}
  from: post-0.1 QA
- [x] Version topology projections and render WordPress territories without changing place identity {#board-topology-v2}
  from: containment model
- [x] Draw observed parent relations as static containment guides {#board-containment-guides}
  from: containment model
- [x] Collapse repeated change runs, compact dead leaves, and bound large-map flow density {#board-scale-relief}
  from: containment model
- [x] Contain the active sentence, retain homogeneous run verbs, and fix territory order {#board-framing-language}
  from: live QA
- [x] Fold revision evidence, deduplicate semantic confirmations, preserve rotated site identity, and compose small maps {#board-wide-run-correctness}
  from: wide-run QA
- [x] Route flows by the shortest honest path and keep the grid continuous through camera movement {#board-layman-canvas}
  from: layman QA
- [x] Translate WordPress nouns for owners and fold system bookkeeping into root evidence {#board-owner-nouns}
  from: layman QA
- [x] Render comment member verbs, deduplicate lifecycle hooks, and retain user history in the inspector {#board-member-evidence}
  from: member-evidence QA

## Replay any session {#replay}
tech: scrub UI over trail; sparse snapshot index for seeking
needs: [trail, board]
files: [src/replay/**]
- [x] Scrub through a past session on the board {#replay-scrub}
  from: roadmap
- [x] Make replay position explicit and auto-play timelapse over visual events {#replay-liveness}
- [x] Keep replay state and deep links scoped to the playhead clock {#replay-one-clock}
  from: post-0.1 QA

## Render the timelapse {#timelapse}
tech: render trail projection to video, re-renderable after the fact
needs: [replay]
files: [src/timelapse/**]
- [x] Render a shareable timelapse from any trail {#timelapse-render}
  from: roadmap
- [x] Render exported frames from the same topology and geometry as the browser board {#timelapse-parity}
  from: containment model

## Ship it {#ship}
tech: npm package "aphelion" (name free as of 2026-08-25), npx-first
needs: [board]
files: [package.json, bin/**]
- [x] Prepare the npx package through the final predeploy gate {#ship-npx}
  from: roadmap

## decisions
- 2026-08-25: trail is product-owned durable JSONL (docs/trail-format.md), never a view over agent session folders
