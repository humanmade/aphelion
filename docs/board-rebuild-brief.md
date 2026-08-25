# Work order — board rebuild: node-identity topology + monochrome design system

Status: ready for implementation · 2026-08-25
One repaint: the topology projection fix and the new design system land together. No intermediate reskin of the old board.

## Authority

Binding, in order: `PRODUCT.md` (principles) → `DESIGN.md` (tokens, art direction, topology contract, motion contract — normative for everything visual) → `docs/trail-format.md` → `docs/observation-surfaces.md`. Recent entries in `knowledge/decisions.md` record the stack change and color semantics. Where this brief and DESIGN.md disagree, DESIGN.md wins.

## Why (the defect being fixed)

The current board (`src/board/app.js:266`) mints one graph node per *journey phase* (`journey-<id>-<seq>`), so every action renders as a four-card row (declared → wp-cli open → effect → wp-cli close) and a revisited object gets a fresh row. The 10:56 QA session rendered 16 cards for what is ~5 durable things. This violates the recorded ban on horizontal status-card strips and discards upstream agenttrail's core mechanic (stable components that light up). The trail and capture layers are correct and rich (`objectType`, `objectId`, `name`, `metaKey`, `plugin` are all present) — the defect is confined to the board projection and rendering.

## Scope

### 1. Frontend scaffold (new)

- New app tree (suggest `src/board-app/`): Vite + React + TypeScript + Tailwind + shadcn/ui + ReUI, themed from DESIGN.md's exported tokens (`npx -y -p @google/design.md designmd export --format css-tailwind DESIGN.md`).
- Builds to prebuilt static assets the daemon serves as it serves files today. The daemon gains no runtime dependency; the npm package ships the built assets so `npx aphelion` needs no user-side build.
- Vendor Geist Sans + Geist Mono woff2 locally (OFL text alongside). No font/CDN requests — local by construction. Geist Pixel is NOT used in the product UI (timelapse title cards only, out of scope here).
- Retire `src/board/` (app.js, styles.css, index.html) once the new board reaches parity; `public/index.html` serves the new bundle.

### 2. Node-identity projection (the core of this work order)

Extend the shared reducer (`src/trail/reducer.mjs` contract: one browser-compatible pure reducer for live, replay, timelapse) to emit a **map model** derived by these rules:

- **Node keys are stable object identities**, resolved from event data, created on first touch only:
  - `wp:post:<objectId>` (post/page/CPT; `wp.post.*` and `wp.post_meta.*` events resolve to the post's node — meta appears as property rows under it, attributed to its `plugin`/`namespace`)
  - `wp:option:<name>` (`wp.option.updated`, `runtime.option.changed`)
  - `wp:plugin:<slug>`, `wp:term:<id>`, `wp:user:<id>` as those kinds appear
  - `repo:component:<id>` from PLAN.md components (existing behavior)
- **Revisit = relight.** Same key → same node: bump touch count, append evidence rows, update declared/observed badges, raise luminance. Never a second node. Acceptance example from the real fixture trail: the tagline edit + restore is ONE `wp:option:blogdescription` node with two touches.
- **Presence is edge state, never spatial.** One reusable edge per channel/target pair across journeys; `presence.open/ready/heartbeat/close/timeout/reconnect` drive edge/port state. Bare open/close pairs with no effect (fixture seq 32–35) render nothing spatial — channel liveness only. Heartbeats never render individually.
- **Journeys are traces, not rows.** A declared→effect correlation animates a path across existing nodes/edges and settles; the journey data model is unchanged, only its rendering moves from cards to traces.

### 3. Layout

Append-stable growth per DESIGN.md's topology contract: first touch anchors top-left, new nodes append in reading order within kind clusters (content / settings / plugins / repo components), existing positions never reshuffle. Cluster-collapse only when density makes objects unreadable (defaults below). Layout changes glide via FLIP (~500–700ms decelerating ease).

### 4. Design + motion application

Apply DESIGN.md in full. Non-negotiables restated: monochrome field, hue = state only (declared blue / observed emerald / attention amber / danger red); Geist Sans speaks, Geist Mono evidences; light-as-activity (recency = luminance, calm grey at rest); every state change a continuous transition (birth reveals, animated expand/collapse of property rows, cross-faded state, two shared easing tokens, interruptible and seek-safe); playback chrome stays compact and never competes with the map; `prefers-reduced-motion` honored.

## Out of scope

Trail format, daemon capture, sidecar, mu-plugin, correlation logic, timelapse renderer internals (it consumes the same reducer — confirm parity, don't redesign), light theme, Geist Pixel.

## Defaults taken (flag in the PR if they prove wrong; do not silently deviate)

1. **Granularity**: one node per object, cluster-collapse into a parent ("Pages", "Yoast SEO") when a kind cluster exceeds ~7 visible nodes; expand on click.
2. **Map persistence**: per-session map, deterministically rebuilt from the trail (replay of the same trail always yields the same map). A durable cross-session site map is a separate future work order — do not build it here.

## Acceptance gates

- Fixture: `~/.aphelion/trails/localhost-8081-b213ecea/20260825T035601Z-30074fe2.jsonl` renders as a handful of durable-noun nodes (site tagline option, page 464 with its meta rows, plus presence ports/edges) — not 16 phase cards. Add it (or a scrubbed copy) as a deterministic test fixture.
- Same-key reuse test: two journeys touching `blogdescription` produce one node, touch count 2.
- Presence test: connection lifecycle events produce zero nodes; heartbeats render nothing.
- Layout stability test: appending events to a fixture changes no existing node position.
- Live/replay equivalence: replaying to seq N equals a fresh projection of events 1…N on the same reducer.
- `npx impeccable detect --json <live url>` passes floors at desktop and `--viewport 390x844`; canvas controls reachable at 390px.
- Reduced-motion pass preserves state and direction with nonessential animation removed.
- Screenshot acceptance is mandatory: final frames of live, replay mid-scrub, and an expanded node, judged against DESIGN.md's art direction — "renders" is not "verified".
- Daemon `package.json` production dependency count for the shipped runtime remains zero; built assets load from disk with no outbound requests (fonts included).
