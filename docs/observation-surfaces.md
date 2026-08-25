# Observation surfaces — how Aphelion sees WordPress

Files are the shallowest layer. Agents reach WordPress through several channels, and most of what they do lands in the database, not the filesystem. This doc maps every surface to the tap that observes it and the trail events it yields.

## The unifying move: observe at the hook layer

Whatever the channel — MCP, REST, WP-CLI over SSH, or a driven browser in wp-admin — writes made through standard WordPress APIs pass through actions and filters such as `save_post`, `updated_option`, `rest_request_after_callbacks`, `activated_plugin`, and term/meta hooks. Ability execution is observed through the official `wp_after_execute_ability` hook, with `wp_ability_invoked` retained as a compatibility tap. A small **audit mu-plugin** observes those supported hooks in one stream and tags each event with the channel WordPress saw (`REST_REQUEST`, `WP_CLI`, admin screen, cron). Direct database writes and unhooked plugin internals remain coverage gaps rather than inferred effects.

It also maps cleanly onto declared-vs-observed: a client-side tap records what the agent *asked for*; the mu-plugin records what the site *actually did*. Correlating the two per action is the product working at its best.

## Surface map

| Surface | Tap | Yields (trail `source`/`kind`) |
|---|---|---|
| File edits in a repo | Filesystem watcher + agent hooks (adapted from upstream) | `file.write`, `tool.pre`, `tool.post` |
| **MCP / Abilities API** | Agent-side hooks declare supported MCP/Ability calls; site-side WordPress hooks record invocation, execution, and resulting supported writes. | `mcp.ability.call` (declared) + `wp.ability.*` / `wp.*` (observed) |
| **REST API** | The mu-plugin records completed mutating requests through `rest_request_after_callbacks`; object hooks carry post/meta detail. Application-password users can provide a stable actor. | `wp.rest.write`, plus object-specific `wp.*` effects |
| **WP-CLI over SSH** | The mu-plugin sees supported writes tagged `WP_CLI`; an agent hook or external driver supplies the declared command family. | `cli.command.declared` + `wp.*` effects |
| Admin UI (human, or agent-driven browser) | mu-plugin, tagged as admin-screen origin. Gutenberg's actual save is a REST request and is labeled `rest`; wp-admin heartbeat remains a separate presence channel. | `wp.*` with channel=`wp-admin` or `rest` |
| Runtime baseline and selected option drift | Read-only sidecar polling via WP-CLI, with optional `debug.log` tailing | `runtime.baseline`, `runtime.option.changed`, `wp.log.line` |
| Plugin-specific semantics | **Adapters** (Accelerate first): translate raw writes into meaningful events — "experiment X launched on page Y," "variant B is winning" | adapter-namespaced kinds |

## Liveness

Presence is first-class, not inferred after the fact: an open MCP session, an in-flight WP-CLI run, a burst of authenticated REST writes from an agent identity — each opens a `presence` interval on the trail (`presence.open` / `presence.close`) that the board shows as *an agent is connected to this site right now, via this channel*. WordPress heartbeat requests are coalesced to a bounded `presence.heartbeat`; missing heartbeats yield `presence.timeout`, and a returning connection yields `presence.reconnect`. Channel and transport stay separate fields.

The sidecar tails from the audit file's current end when a session starts, so old site history is not duplicated into a new trail. Runtime inventory is one asynchronous, read-only WP-CLI baseline. It never blocks the board's event loop and does not misclassify baseline reads as changes.

## Escalating fidelity, by install cost

Each step is optional; every step up makes the same board richer:

1. **Nothing installed** (works today): fs watcher + agent hooks. Repo-only vision.
2. **Sidecar** (no site-side code, needs WP-CLI/SSH access): runtime drift becomes visible.
3. **Audit mu-plugin** (one file dropped in `mu-plugins/`): supported WordPress hooks across channels, with actor and channel tags.
4. **Adapters** (per plugin): semantic events, Accelerate first.

The mu-plugin must hold to the product principles: observe-only (no write path, no settings surface), local-first (it emits to the site's own log/stream that the sidecar collects — no phoning anywhere), and no secrets in payloads.

## Journey contracts

The observer is evaluated on journeys, not isolated hooks. A journey starts with
an external declaration or connector phase and ends when the observed effect
and connector lifecycle are known. The driver that performs a test action lives
outside Aphelion; Aphelion only tails the audit stream, polls read-only state,
or receives an agent-side declaration.

The repository's deterministic WordPress journey catalogue is the contract used by the
focused tests. It deliberately uses `aphelion-test-*` objects and keeps the following cases
separate:

| Journey | Declared signal | Observed signal | Details that must survive |
|---|---|---|---|
| Block/page edit | MCP ability or REST action | `wp.post.created` / `wp.post.updated` | post type, object ID, title/status, block names/count, nested block path, `added`/`removed`/`replaced`/`updated`, changed property names; never block text or attribute values |
| Settings change/restore | WP-CLI command family | `wp.option.updated` or `runtime.option.changed` | option name, changed/no-op, value type or opaque fingerprint, before/after and restoration; never the option value |
| Plugin metadata | REST/admin save | `wp.post_meta.*` | post ID, metadata key, plugin/namespace/family (`yoast`/`seo`, for example), value type; never the metadata value |
| Connector recovery | open/ready/heartbeat | error, disconnect, reconnect, close | channel and transport as separate fields, connection ID, actor confidence, phase times and duration |
| WordPress AI | MCP `mcp.ability.call` | `wp.ability.invoked` plus official `wp.ability.executed` | ability name, request ID, outcome, declared-to-effect latency; compatibility invocation remains distinct from execution |
| WP-CLI | command declaration | WordPress hook effect | command family, `wp-cli` channel, `docker-exec`/`ssh` transport, process exit/lifecycle; Docker exec must never be called SSH |

### Timing contract

Every fixture event uses `ts` for the source-observed time. When capture is
delayed or happens through another process, `receivedAt` is also retained. A
projection may derive, but never fabricate:

- capture lag: `receivedAt - ts` for an event with both clocks;
- declared-to-first-observed-effect latency, keyed by `requestId` or
  `correlationId`;
- connection duration: final lifecycle time minus `presence.open` time;
- phase gaps between ready, heartbeat, error, reconnect, and close.

Remote clock skew is reported as an evidence limitation. Presentation may
compress idle gaps for a board or timelapse, but it must preserve event order and
the within-journey relative timings. An open/glowing connector is justified only
while its last observed phase is active; an error, timeout, disconnect, or close
must terminate that active state.

### Connector attribution

`channel` answers “which WordPress-facing action or protocol was involved?”
(`mcp`, `rest`, `wp-cli`, `wp-admin`, `cron`, or `unknown`). `transport` answers
“how did the observer reach it?” (`stdio`, `http`, `docker-exec`, `ssh`,
`filesystem`, or `unknown`). They are never collapsed into one label. A local
request hint may improve attribution, but it is marked as `channelSource:
request-hint`; WordPress runtime context remains the stronger evidence.

The sidecar emits its own `presence.open` on startup, `presence.ready` after a
successful read-only WP-CLI baseline, heartbeats coalesced to at most one every 30 seconds,
and `presence.error`/`presence.reconnect` around a temporary failure. Its WP-CLI probes are
marked and suppressed at the mu-plugin boundary so the observer does not record itself.
It retries after failure rather than turning one unavailable CLI or SSH process
into a permanently dead observer. Runtime baselines contain option names,
types, and opaque fingerprints only; they do not become a second content log.

### WordPress context without content leakage

The mu-plugin derives block property changes by comparing the old and new post
in memory before emission. It records a structural path and changed attribute
names, not values. Post fields are represented by names such as `title`,
`slug`, `status`, `excerpt`, and `content`. Metadata uses the key and plugin
namespace, while options use the name and value types. Requests carry a bounded
request/correlation ID when supplied by the connector, but credentials,
authorization headers, request bodies, block text, option values, and metadata
values never enter the trail.

The observer hooks both `wp_after_execute_ability` and the older
`wp_ability_invoked` compatibility path. The former emits execution outcome;
the latter records invocation. If a WordPress/plugin version does not expose an
ability hook, the missing phase is shown as a coverage gap rather than inferred
from a generic REST write.
