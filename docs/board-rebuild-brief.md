# Work order — board rebuild: node-identity topology + monochrome design system

Status: implemented and browser-verified against the real 10:56 WordPress trail on 2026-08-25. This document preserves the defect, contract, and acceptance basis for review; the implementation lives in `src/board/topology.mjs` and `src/board/app.js`.
One repaint: the topology projection fix and the new design system land together. No intermediate reskin of the old board.

## Authority

Binding, in order: `PRODUCT.md` (principles) → `DESIGN.md` (tokens and art direction) → `docs/topology-language.md` (places, flows, changes, card text, and playback grammar) → `docs/trail-format.md` → `docs/observation-surfaces.md`. Recent entries in `knowledge/decisions.md` record the stack change and color semantics. Where this brief disagrees with a higher authority, the higher authority wins.

## Why (the defect being fixed)

The discarded board minted one graph node per *journey phase* (`journey-<id>-<seq>`), so every action rendered as a four-card row (declared → wp-cli open → effect → wp-cli close) and a revisited object got a fresh row. The 10:56 QA session rendered 16 cards for what was two durable WordPress objects. This violated the recorded ban on horizontal status-card strips and discarded upstream agenttrail's core mechanic (stable components that light up). The trail and capture layers were already correct and rich (`objectType`, `objectId`, `name`, `metaKey`, `plugin`); the implemented fix remains confined to board projection and rendering.

## Scope

### 1. Frontend projection

- Keep the existing dependency-free HTML, CSS, and browser-ESM board in `src/board/`; no framework or build-runtime dependency is introduced.
- `scripts/build-board.mjs` produces the prebuilt `public/index.html`, while the daemon serves the pure `topology.mjs` projection locally. The npm package ships both so `npx aphelion` needs no user-side build.
- Fonts and assets remain local. The current board uses the installed system sans/mono stacks (SF Pro + SF Mono on macOS), makes no font/CDN request, and keeps Geist Pixel outside the product UI until a licensed local font asset is intentionally added.

### 2. Node-identity projection (the core of this work order)

Add one browser-compatible pure **site map projection** in `src/board/topology.mjs`. Live and replay both derive it from the same trail events; it is not a second record and it does not modify the append-only reducer contract.

- **Node keys are stable object identities**, resolved from event data, created on first touch only:
  - `wp:post:<objectId>` (post/page/CPT; `wp.post.*` and `wp.post_meta.*` events resolve to the same place — metadata changes live in its history and retain `plugin`/`namespace` attribution)
  - `wp:option:<name>` (`wp.option.updated`, `runtime.option.changed`)
  - `wp:plugin:<slug>`, `wp:term:<id>`, `wp:user:<id>` as those kinds appear
  - `repo:component:<id>` from PLAN.md components (existing behavior)
- **Revisit = relight.** Same key → same node: update the state line, append a change to history, and raise luminance. Never a second node and never another claim row on the card. Acceptance example from the real fixture trail: the tagline edit + restore is ONE `wp:option:blogdescription` place with two changes.
- **Presence is edge state, never spatial.** One reusable edge per channel/target pair across journeys; `presence.open/ready/heartbeat/close/timeout/reconnect` drive edge/port state. Bare open/close pairs with no effect (fixture seq 32–35) render nothing spatial — channel liveness only. Heartbeats never render individually.
- **Changes travel on flows, never as rows on the map.** A declaration puts one existing channel edge in flight; a WordPress confirmation lands at the existing place, updates its state and latest-change lines, and settles the edge. Claim and confirmation remain distinct inside the change history.

### 3. Layout

Append-stable growth per DESIGN.md's topology contract: first touch anchors top-left, new nodes append in reading order, and existing positions never reshuffle as time advances. Automatic clustering is deferred until a larger real-site fixture proves its threshold and interaction.

### 4. Design + motion application

Apply DESIGN.md in full. Non-negotiables restated: monochrome field, hue = state only (declared blue / observed emerald / attention amber / danger red); system sans speaks, system mono evidences; light-as-activity (recency = luminance, calm grey at rest); every state change a continuous transition (birth reveals, animated expand/collapse of property rows, cross-faded state, two shared easing tokens, interruptible and seek-safe); playback chrome stays compact and never competes with the map; `prefers-reduced-motion` honored.

## Out of scope

Trail format, daemon capture, sidecar, mu-plugin, correlation logic, timelapse renderer internals (it consumes the same reducer — confirm parity, don't redesign), light theme, Geist Pixel.

## Defaults taken (flag in the PR if they prove wrong; do not silently deviate)

1. **Granularity**: one node per object. Cluster-collapse into a parent ("Pages", "Yoast SEO") after ~7 visible nodes is a deferred follow-up, not silently included in this implementation.
2. **Map persistence**: per-session map, deterministically rebuilt from the trail (replay of the same trail always yields the same map). A durable cross-session site map is a separate future work order — do not build it here.

## Acceptance gates

- Real-trail QA: `~/.aphelion/trails/localhost-8081-b213ecea/20260825T035601Z-30074fe2.jsonl` renders as site root + page 464 + site tagline, with presence on reusable edges — not 16 phase cards. Synthetic deterministic tests cover the same identity contract without committing the local trail.
- Same-key reuse test: two journeys touching `blogdescription` produce one node, touch count 2.
- Presence test: connection lifecycle events produce zero nodes; heartbeats render nothing.
- Layout stability test: appending events to a fixture changes no existing node position.
- Live/replay equivalence: replaying to seq N equals a fresh projection of events 1…N on the same reducer.
- Desktop screenshots and cursor-by-cursor browser QA are mandatory. The Impeccable detector ran in degraded regex mode with advisory token findings only; mobile-specific finish work was explicitly deferred by the owner after the desktop acceptance surface was completed.
- Reduced-motion pass preserves state and direction with nonessential animation removed.
- Screenshot acceptance is mandatory: final frames of live, replay mid-scrub, and an expanded node, judged against DESIGN.md's art direction — "renders" is not "verified".
- Daemon `package.json` production dependency count for the shipped runtime remains zero; built assets load from disk with no outbound requests (fonts included).
