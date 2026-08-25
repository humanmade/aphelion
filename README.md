# Aphelion

**The local flight recorder for AI agents working on WordPress.**

![Aphelion replays agent work over a stable map of the WordPress objects it touched](https://cdn.jsdelivr.net/npm/aphelion@latest/assets/aphelion-board.png)

An agent says it updated a page. The filesystem shows a diff. WordPress reports a save.
Those are three fragments of one story, usually scattered across terminals, session logs,
and site logs. Aphelion records them as one append-only local trail and renders that same
record as a live topology, replay, and shareable timelapse.

| Without Aphelion | With Aphelion |
| --- | --- |
| “The agent said it finished.” | Declared intent stays beside the independently observed effect. |
| Repo changes and site changes live in different logs. | Repo, WP-CLI, REST, wp-admin, MCP, and Abilities events share one timed journey. |
| A disconnected connector looks like silence. | Ready, heartbeat, timeout, reconnect, error, and close are explicit phases. |
| A demo requires screen recording while the work happens. | Any recorded trail can be replayed or rendered afterward. |

Aphelion is deliberately an observer, not an orchestrator. It binds to loopback, has no
accounts or telemetry, and never sends commands to the agent or writes to the project or
site it watches.

## Quickstart

Requires Node 20 or newer.

```sh
npm install --global aphelion
cd /path/to/your-project
aphelion --open
```

The command prints the local board URL and trail path. Keep it running while an agent works;
press `Ctrl-C` when the session is over.

Prefer a project-local install?

```sh
npm install --save-dev aphelion
npx aphelion --open
```

## What it records

- **Declared intent:** supported agent lifecycle and tool hooks, including MCP calls.
- **Repository evidence:** file changes and project-plan progress.
- **WordPress effects:** posts, pages, blocks, settings, metadata, terms, plugins, REST writes,
  and Abilities execution observed through WordPress hooks.
- **Connection state:** source-scoped presence for agent hooks, MCP, WP-CLI, REST, wp-admin,
  and the WordPress sidecar.
- **Timing:** source event time, local receipt time, capture lag, connection duration, and
  declared-to-effect latency when a request ID joins the phases.

Block and setting evidence stays structural. A page edit can show that `core/heading.level`
changed and a nested `core/button.backgroundColor` was added without storing the block text,
attribute values, option values, credentials, or Ability inputs/results.

## The core idea: record once, render many

Every surface is a projection of one JSONL trail:

```text
agent hooks ─┐
repo watcher ├─> append-only trail ─> live board
WordPress ───┤                     ├─> replay
WP-CLI/MCP ──┘                     └─> timelapse
```

Live and replay use the same reducer. Timelapse is generated from the same events. No view
owns a second history, so a crash-ended session remains readable and a malformed line cannot
hide later valid evidence.

The board speaks three nouns: **places**, **flows**, and **changes**. A page, setting, plugin,
Ability, or site is a place with one stable node per session. A channel is a reusable flow into
that place. A change is a timed claim and WordPress confirmation preserved together in history,
never another card. Place cards show only where they are, what they are called, their current
state, their latest change, and the door to history. Replay advances light, motion, state, and
history over the same top-left layout, so a place never jumps merely because time moved forward.

Declared work is shown as `in flight`; `live` is reserved for an active presence connection.
Edge motion uses the recorded request or connection duration, falling back to 1200ms only when
no positive gap is measurable. Opening a place exposes its scrollable change history; request
IDs, transports, and raw event data remain in the inspector rather than riding the canvas. Maps are
rebuilt per session; clustering and durable cross-session site maps remain deferred.

## Add WordPress evidence

Repository observation works with no WordPress installation. Site context is progressive:

| Level | Install cost | What becomes visible |
| --- | --- | --- |
| Repo watcher and agent hooks | None | Files, declared actions, plan progress, agent presence |
| Read-only WP-CLI sidecar | A local WP-CLI, Docker, or SSH command | Runtime baseline, drift fingerprints, connector health |
| Audit mu-plugin | One PHP file in `wp-content/mu-plugins/` | WordPress hook effects, actor/channel context, block and metadata changes |
| Plugin adapter | Optional | Product semantics layered beside the raw effect; Accelerate is included |

With the project-local installation shown above, install the observer from the package:

```sh
cp node_modules/aphelion/src/mu-plugin/aphelion-audit.php \
  /path/to/wordpress/wp-content/mu-plugins/aphelion-audit.php
```

For a global installation, replace `node_modules/aphelion` with
`$(npm root --global)/aphelion`.

Then point Aphelion at the site-local log and, optionally, a read-only WP-CLI command:

```sh
aphelion \
  --site http://localhost:8081 \
  --audit-log /path/to/wordpress/wp-content/aphelion/audit.jsonl \
  --wp-command '["docker","exec","wordpress","wp","--allow-root","--path=/var/www/html"]' \
  --open
```

The mu-plugin has no settings screen and no remote transport. It supports PHP 7.4+;
WordPress-aware site features target WordPress 6.9+.

See [WordPress observation surfaces](docs/observation-surfaces.md) for the full channel,
transport, redaction, and timing contract.

## Run automatically — opt in

The normal command stays foreground and explicit. If this is a workstation or long-lived
local WordPress stack, an OS user service can start Aphelion at login and restart it after a
failure. This is intentionally not installed or enabled by default: background observation
and never-automatic retention should be a conscious choice.

Use [Running Aphelion in the background](docs/background-service.md) for macOS `launchd`,
Linux `systemd --user`, WordPress arguments, health checks, and removal. Agent hooks should
relay events to that one service—not start a fresh daemon for every tool call.

## CLI

| Command | When to use it |
| --- | --- |
| `aphelion [target]` | Observe a repository; defaults to the current directory. |
| `aphelion serve [target]` | The explicit form of the default command. |
| `aphelion sessions [target]` | List recorded sessions and their trail paths. |
| `aphelion timelapse <trail.jsonl>` | Render a standalone HTML timelapse from an existing trail. |
| `aphelion hook` | Relay one supported agent-hook payload from stdin to the local daemon. |

Common options:

| Option | Meaning |
| --- | --- |
| `--open` | Open the loopback board after startup. |
| `--port <number>` | Preferred loopback port; Aphelion falls forward if it is occupied. |
| `--site <url>` | Record a site target instead of a repository target. |
| `--audit-log <path>` | Tail the site-local audit mu-plugin JSONL. |
| `--debug-log <path>` | Tail a WordPress debug log with capture-boundary redaction. |
| `--wp-command <json>` | Run a read-only WP-CLI baseline from a JSON string array; no shell evaluation. |
| `--integrity` | Add optional SHA-256 `prev` links to new trail events. |
| `--no-watch` | Disable repository filesystem watching. |
| `--output <path>` | Choose the timelapse `.html` or `.mp4` output path. |

## Agent hooks

Pipe a supported lifecycle or tool-hook JSON payload to the relay:

```sh
printf '%s\n' "$AGENT_HOOK_JSON" | aphelion hook
```

The relay uses `APHELION_PORT` when the daemon is not on the default port. MCP calls remain
declared requests; WordPress hooks remain independent observed effects. A request or
correlation ID relates them without merging their source records.

## Library

Aphelion is also a typed ESM library with zero runtime dependencies:

```js
import {
  createTrailWriter,
  projectEvents,
  renderTimelapse,
  startDaemon,
} from 'aphelion'

const writer = createTrailWriter({ target: process.cwd() })
writer.append('hook', 'agent.action.declared', {
  summary: 'Update the landing page',
  requestId: 'request-42',
})
writer.close()
```

The package exports the trail reader/writer, reducer, replay index, daemon, sidecar,
WordPress scanner, Accelerate adapter, and timelapse renderer. Type declarations ship with
the package.

## Trail ownership and privacy

| Property | Contract |
| --- | --- |
| Project trails | `<repo>/.aphelion/trail/<session>.jsonl` |
| Site trails | `~/.aphelion/trails/<site-slug>/<session>.jsonl` |
| File mode | `0600` |
| Flush | Every event |
| Retention | Never deleted automatically |
| Reader | Skips malformed lines and continues |
| Network | Board and ingest server bind to `127.0.0.1` |
| Telemetry/accounts | None |

Trails can still contain local paths, object titles, actor names, and action summaries. Treat
them as operational records and review them before sharing. See [Security](SECURITY.md).

## Documentation

- [Documentation index](docs/README.md)
- [Running in the background](docs/background-service.md)
- [WordPress observation surfaces](docs/observation-surfaces.md)
- [Trail format v1](docs/trail-format.md)
- [Release process](RELEASING.md)
- [Changelog](CHANGELOG.md)

## Development

```sh
npm install
npm run verify
```

The verification gate builds the static board, syntax-checks JavaScript and PHP, validates
public documentation, runs unit/integration and desktop/mobile browser tests, audits package
exports and types, inspects the dry-run tarball, and installs it into a blank consumer.

Aphelion adapts the declared-versus-observed model and topology conventions from
[sodiumsun/agenttrail](https://github.com/sodiumsun/agenttrail), vendored at commit
`41454d4`. Substantially adapted files retain provenance comments.

## License

MIT. See [LICENSE](LICENSE).
