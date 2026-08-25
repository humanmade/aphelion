# aphelion — Product & North Star

*Aphelion: the point in an orbit farthest from the sun — the vantage from which you can see the whole path.*

**aphelion is the flight recorder and live map for AI agents working on — and inside — WordPress.**

One command in any WordPress project opens a local board showing what your agents are doing right now, a trail of everything they did, a replay you can scrub through when something went wrong, and a timelapse you can render and share when something went right.

## Why this exists

AI agents now do real work on WordPress projects: they write plugin code, but they also increasingly *operate sites* — editing content, tuning landing pages, launching experiments, changing settings. Three problems follow, and no existing tool addresses them:

1. **The work is invisible while it happens.** You start an agent and stare at a terminal. Existing "LLM observability" traces tokens, latency, and cost — the plumbing, not the work.
2. **The record is unreadable after it happens.** When something breaks, the evidence is a wall of transcript. There is no way to scrub back to the moment an agent touched the thing that broke.
3. **The people most affected can't read any of it.** Site owners and clients experience agent work as things changing on their site. Diffs and transcripts mean nothing to them. Trust currently requires taking the agent's word for it.

WordPress is the right place to solve this. Its code is unusually declarative (`block.json`, `register_rest_route`, `register_post_type` say what things *are*), its runtime is fully introspectable (WP-CLI), and it powers a plurality of the web — meaning the largest population of site owners about to have agents working for them.

## The core idea: declared vs observed

Inherited from [agenttrail](https://github.com/sodiumsun/agenttrail), whose model we adapt: an agent *declares* what it intends and claims (its plan, its checkboxes), while the system *observes* what actually happened (files written, options changed, content edited). aphelion always shows both. When they agree, that agreement — visible, continuous, unfaked — is where trust comes from. When they disagree, that's exactly where you look.

We never trust the agent's own account alone, and we never grade it either. We just put the claim and the evidence side by side.

## The spine: the trail

Everything in aphelion is built on one primitive: an **append-only event log per session** — the trail. Agent hook events, file writes, runtime changes, plan updates, all timestamped and durable.

The trail is a **product-owned format that aphelion writes and stores locally itself** (`docs/trail-format.md`). It is never a view over an agent's own session folder — those are transient, undocumented, and one cleanup away from gone. Events are captured into the trail at the moment they happen, whatever their source, so the record survives even when the agent's own artifacts don't. aphelion can always bring any past session back up.

**Record once, render many.** Every surface is a projection of the trail:

| Projection | What it is | Who it serves |
|---|---|---|
| **Live board** | The head of the trail: current run, live map, streaming tool line | Anyone watching an agent work |
| **Replay** | Scrub through a past session; see the board as it was at any moment | The developer debugging "where did it go wrong" |
| **Timelapse** | A rendered video of a session's board, compressed in time | Anyone showing the work — demos, clients, social |

Because the trail is durable, a timelapse can be rendered *after the fact* from any recorded session — you never had to press record. Replay is audit-faithful; timelapse is the shareable render of the same truth. One log, no divergence between what you can share and what you can prove.

## The product in phases

Each phase is independently useful and ships on the previous one.

### Phase 1 — The WordPress repo map
Adapt the vendored agenttrail core: live file watching, agent hooks, the component map. Make it WordPress-aware: the map is derived from what WordPress code declares — blocks, REST routes, post types, admin pages, hooks — with typed components instead of freeform ones. A WP repo gets a meaningful map with near-zero setup because the code already says what it is.

### Phase 2 — Runtime signals
Half of what an agent does to a WordPress project lands in the database, not files: options, transients, rewrite rules, cron, experiment state. A sidecar (WP-CLI polling + `debug.log` tailing) streams those runtime effects into the same trail and onto the same board. This is the phase where aphelion sees things no generic file watcher can.

### Phase 3 — Site-agent observability
Shift the observed object from *repo* to *site*. Agents operating a site — editing content, optimizing pages, launching A/B tests — declare intent and leave observable effects, exactly like coding agents do. The board becomes the answer to "what is the AI doing to my site?", legible to the person who owns the site, not just the person who wrote the code.

Agents reach sites through many channels — MCP servers and the Abilities API, the REST API, WP-CLI over SSH, even a driven browser in wp-admin. aphelion's answer is to observe at **WordPress's own hook layer**, via a tiny audit mu-plugin: every channel lands in the same actions and filters, so one observer catches them all, tagged with the channel it came through. Client-side taps (agent hooks, an MCP tap) add the *declared* half — the intent behind each call. The channels and taps are detailed in `docs/observation-surfaces.md`.

This phase also makes **liveness** first-class: not just what an agent did, but that one is connected *right now* — an open MCP session, an active WP-CLI run over SSH, a burst of authenticated REST writes — surfaced as presence on the board.

Site-side signals arrive through **adapters**: the core stays agnostic to which agent and which plugins are in play. [Altis Accelerate](https://github.com/humanmade/altis-accelerate) is the first adapter — its experiments and analytics are the richest early source of "agent did something consequential to a site" events.

### Throughout — trail, replay, timelapse
The trail lands early (it's the storage layer everything needs); replay and timelapse mature across all phases. Timelapse rendering quality is a feature, not a gimmick: every shared timelapse is the marketing.

## Who it serves

Different layers serve different people — deliberately:

- **The curious**: run one command, watch your agent work. Fun is a legitimate entry point and the top of the funnel.
- **The developer**: the live map while working; replay when debugging. The "CloudTrail for my agents" experience.
- **The site owner / client**: phase 3's north star — someone who can't read code, watching declared-vs-observed agree on their own site.
- **The agency**: timelapse and replay as client-facing deliverables — "here is what the agents did this sprint," provable and watchable.

The endgame user is the site owner. The road there is paved with developers.

## Design principles

1. **Observe, never control.** aphelion never sends a prompt, never edits code or content, never blocks an agent. A pure read path — that's what makes its account trustworthy.
2. **Local by construction.** Binds to localhost. No account, no cloud, no telemetry, ever. The trail is the user's file on the user's machine.
3. **Declared vs observed, always both.** Never present the agent's claim as fact; never hide it either. The juxtaposition is the product.
4. **Record once, render many.** The trail is the single source of truth. Any new surface (a new view, a new export) is a projection of it, never a second record.
5. **Owner-readable first.** Every surface must be legible to someone who cannot read code. Engineer detail lives one click down, never on top.
6. **Zero ceremony.** `npx aphelion --open` to first value. Every additional capability is progressive enhancement, never a prerequisite.
7. **WordPress-native, agent-agnostic, plugin-agnostic core.** Deep WordPress semantics; no favorite agent; site-side integrations are adapters (Accelerate first among equals).
8. **Free and open.** MIT, no paid tier, no open-core line to defend. The return is positioning and distribution for Human Made and Accelerate.

## Non-goals

- **Not an agent runner or orchestrator.** aphelion watches work; it never dispatches it.
- **Not a project-management board.** Agents maintain the map as a side effect of working; no human ever grooms it.
- **Not LLM tracing.** Tokens, latency, and cost are someone else's dashboard. aphelion observes work, not inference.
- **Not a security or approval gate.** It makes agent work visible and auditable; it does not permit or deny anything.
- **Not a hosted service.** If a team-shared surface is ever wanted, it must not compromise the local-by-construction principles.

## What success looks like

- Developers reach for it reflexively: starting an agent in a WP repo without aphelion open starts to feel like flying blind.
- Replay earns "found it" stories — bugs located by scrubbing a session rather than rereading a transcript.
- Timelapses show up in the wild: people share agent sessions because the render is worth watching.
- An Accelerate site demo where an owner watches an agent optimize a page, live, and understands every line on the screen.
- Adoption signals (npm runs, stars) trend enough to justify the halo thesis.

## Provenance

aphelion adapts [sodiumsun/agenttrail](https://github.com/sodiumsun/agenttrail) (MIT), vendored as a snapshot in `upstream/agenttrail/` — assessment and extension points in `knowledge/agenttrail-assessment.md`. We keep its PLAN.md convention compatible where cheap, and diverge deliberately where WordPress semantics demand it.
