# aphelion

## Record the trail {#trail}
tech: append-only JSONL per session, spec docs/trail-format.md
files: [src/trail/**]
- [ ] Write every observed event to a durable local log {#trail-write}
  from: roadmap
- [ ] Reopen any past session from its log {#trail-read}
  from: roadmap

## Watch the repo and the agent {#observe-repo}
tech: adapt upstream daemon (watcher, Claude hooks, PLAN.md parser) into src/
needs: [trail]
files: [src/daemon/**]
- [ ] Adapt the agenttrail daemon to emit trail events {#observe-repo-adapt}
  from: roadmap
- [ ] Derive the map from WordPress declarations (block.json, register_*) {#observe-repo-wpmap}
  from: roadmap

## See the site {#observe-site}
tech: sidecar (WP-CLI poll + debug.log tail), audit mu-plugin, MCP tap — docs/observation-surfaces.md
needs: [trail]
links: [observe-repo]
files: [src/sidecar/**, src/mu-plugin/**]
- [ ] Stream runtime drift via the sidecar {#observe-site-sidecar}
  from: roadmap
- [ ] Catch every channel at the hook layer via the mu-plugin {#observe-site-muplugin}
  from: roadmap
- [ ] Show who is connected right now {#observe-site-presence}
  from: roadmap

## Show the work live {#board}
tech: adapt upstream public/index.html; split into concat-able sources
needs: [observe-repo]
files: [src/board/**]
- [ ] Serve the live board from trail projections {#board-live}
  from: roadmap

## Replay any session {#replay}
tech: scrub UI over trail; sparse snapshot index for seeking
needs: [trail, board]
files: [src/replay/**]
- [ ] Scrub through a past session on the board {#replay-scrub}
  from: roadmap

## Render the timelapse {#timelapse}
tech: render trail projection to video, re-renderable after the fact
needs: [replay]
files: [src/timelapse/**]
- [ ] Render a shareable timelapse from any trail {#timelapse-render}
  from: roadmap

## Ship it {#ship}
tech: npm package "aphelion" (name free as of 2026-08-25), npx-first
needs: [board]
files: [package.json, bin/**]
- [ ] npx aphelion --open works in any repo {#ship-npx}
  from: roadmap

## decisions
- 2026-08-25: see knowledge/decisions.md — trail is product-owned durable JSONL, never a view over agent session folders
