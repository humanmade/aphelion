# Observation surfaces — how aphelion sees WordPress

Files are the shallowest layer. Agents reach WordPress through several channels, and most of what they do lands in the database, not the filesystem. This doc maps every surface to the tap that observes it and the trail events it yields.

## The unifying move: observe at the hook layer

Whatever the channel — MCP, REST, WP-CLI over SSH, a driven browser in wp-admin — every consequential write lands in WordPress's own actions and filters: `save_post`, `updated_option`, `rest_after_insert_*`, `activated_plugin`, term and meta hooks. A single small **audit mu-plugin** observing that layer catches all channels in one stream, and can tag each event with the channel it arrived through (`REST_REQUEST`, `WP_CLI`, admin screen, cron). This is the ground-truth observer; everything else adds context on top.

It also maps cleanly onto declared-vs-observed: a client-side tap records what the agent *asked for*; the mu-plugin records what the site *actually did*. Correlating the two per action is the product working at its best.

## Surface map

| Surface | Tap | Yields (trail `source`/`kind`) |
|---|---|---|
| File edits in a repo | fs watcher + agent hooks (adapted from upstream) | `watcher/file.write`, `hook/tool.*` — the phase-1 baseline |
| **MCP / Abilities API** | Two taps: agent-side, Claude Code hooks already surface every `mcp__*` tool call with inputs — parse and classify WP-semantically (which ability, which post/block). Site-side, the mu-plugin sees the resulting writes. | `mcp/ability.call` (declared) + `wp/*` (observed) |
| **REST API** | mu-plugin on `rest_after_insert_*` / `rest_pre_dispatch`: authenticated write requests with user, route, object id. Application-password users give agents a stable identity to attribute to. | `wp/rest.write`, with actor identity |
| **WP-CLI over SSH** | mu-plugin sees the writes (tagged `WP_CLI`); optionally a WP-CLI logger hook records the command line itself. An active `wp` process is also a presence signal. | `cli/command` (declared) + `wp/*` (observed) |
| Admin UI (human, or agent-driven browser) | mu-plugin, tagged as admin-screen origin. This is also how *human* edits enter the trail — the board can distinguish "your agent did this" from "someone else did." | `wp/*` with channel=admin |
| Runtime drift (options, transients, rewrites, cron, experiment state) | Sidecar polling via WP-CLI + `debug.log` tail — catches what fires no clean hook, and works with zero site-side install | `wp/option.updated`, `wp/cron.*`, `wp/log.line` |
| Plugin-specific semantics | **Adapters** (Accelerate first): translate raw writes into meaningful events — "experiment X launched on page Y," "variant B is winning" | adapter-namespaced kinds |

## Liveness

Presence is first-class, not inferred after the fact: an open MCP session, an in-flight WP-CLI run, a burst of authenticated REST writes from an agent identity — each opens a `presence` interval on the trail (`presence.open` / `presence.close`) that the board shows as *an agent is connected to this site right now, via this channel*. The 60-second "Working" badge upstream uses for files is the degenerate case of this.

## Escalating fidelity, by install cost

Each step is optional; every step up makes the same board richer:

1. **Nothing installed** (works today): fs watcher + agent hooks. Repo-only vision.
2. **Sidecar** (no site-side code, needs WP-CLI/SSH access): runtime drift becomes visible.
3. **Audit mu-plugin** (one file dropped in `mu-plugins/`): every channel, every write, with actor and channel tags. The full phase-3 picture.
4. **Adapters** (per plugin): semantic events, Accelerate first.

The mu-plugin must hold to the product principles: observe-only (no write path, no settings surface), local-first (it emits to the site's own log/stream that the sidecar collects — no phoning anywhere), and no secrets in payloads.
