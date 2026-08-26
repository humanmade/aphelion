# Aphelion

**The local flight recorder for AI agents working on WordPress.**

[![npm version](https://img.shields.io/npm/v/aphelion.svg)](https://www.npmjs.com/package/aphelion)
[![npm downloads](https://img.shields.io/npm/dm/aphelion.svg)](https://www.npmjs.com/package/aphelion)
[![CI](https://github.com/humanmade/aphelion/actions/workflows/ci.yml/badge.svg)](https://github.com/humanmade/aphelion/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/aphelion.svg)](./LICENSE)
[![Socket Badge](https://socket.dev/api/badge/npm/package/aphelion)](https://socket.dev/npm/package/aphelion)

![A recorded agent session in the Aphelion timelapse: the site and its content, structure, plugin, and settings territories, with a WP-CLI change landing live on a plugin setting](assets/aphelion-board.jpg)

Agents already operate WordPress sites. Aphelion records every move into an append-only
trail on your machine, rendered three ways: a real-time map of the work, a replay of any
moment, and an audit trail that proves what actually changed.

What makes the record trustworthy:

- **One file is the truth.** A session is a single append-only JSONL file, flushed to
  disk on every event and readable only by you, with optional SHA-256 hash chaining
  (`--integrity`) that makes tampering detectable. The live board, replay, and
  timelapse all render this one file, so there is no second history to diverge.
- **Nothing leaves your machine.** The board binds to `127.0.0.1`, there is no account
  and no telemetry, and no recording is ever deleted for you.
- **Agents are observed, never touched.** `aphelion mcp -- <server>` passes agent
  traffic through byte for byte while recording what they declare: tool names and
  argument keys, never values, content, or credentials.
- **It speaks WordPress.** Block edits belong to their page, revisions to their post,
  plugin settings to their plugin, and every card carries a name a site owner can
  read. Idle sessions close on their own; a stale observer warns instead of quietly
  missing events.
- **Zero runtime dependencies.** Node 20 or newer is the whole install.

## Quickstart

```sh
npm install --global aphelion
cd /path/to/your-project
aphelion --open
```

The command prints the local board URL and trail path. Keep it running while an agent works.
Project-local works too: `npm install --save-dev aphelion && npx aphelion --open`.

## Record once, render many

```text
agent hooks ─┐
repo watcher ├─> append-only trail ─> live board
WordPress ───┤                     ├─> replay
WP-CLI/MCP ──┘                     └─> timelapse
```

Every surface is a projection of one JSONL trail — no view owns a second history. The board
speaks three nouns: **places** (durable WordPress objects, the only things with a position),
**flows** (channels carrying an actor's work), and **changes** (timed claim-plus-confirmation
moments in a place's history). The full contract lives in
[the topology language](docs/topology-language.md); evidence stays structural — block and
attribute *names*, never content, option values, credentials, or Ability payloads.

## Add WordPress evidence

Repository observation needs no WordPress installation. Site context is progressive:

| Level | Install cost | What becomes visible |
| --- | --- | --- |
| Repo watcher and agent hooks | None | Files, declared actions, plan progress, presence |
| Generic MCP stdio tap — `aphelion mcp -- <server command...>` | None; wraps an existing local MCP server | MCP presence, tool-call names, structural argument keys, and declared completion without values or result bodies |
| Read-only WP-CLI sidecar | A local WP-CLI / Docker / SSH command | Runtime baseline, drift fingerprints, site identity |
| Audit mu-plugin | One PHP file in `wp-content/mu-plugins/` | WordPress hook effects: posts, blocks, settings, terms, menus, users, comments, plugins |
| Plugin adapter | Optional | Product semantics beside the raw effect; Accelerate included |

```sh
cp node_modules/aphelion/src/mu-plugin/aphelion-audit.php \
  /path/to/wordpress/wp-content/mu-plugins/aphelion-audit.php

aphelion \
  --site http://localhost:8081 \
  --audit-log /path/to/wordpress/wp-content/aphelion/audit.jsonl \
  --wp-command '["docker","exec","wordpress","wp","--allow-root","--path=/var/www/html"]' \
  --open
```

The mu-plugin has no settings screen and no remote transport (PHP 7.4+; WordPress-aware
features target 6.9+). Full channel, transport, redaction, and timing contract:
[WordPress observation surfaces](docs/observation-surfaces.md).

## Run automatically — opt in

The normal command stays foreground and explicit. For a workstation or long-lived local
stack, an OS user service can start Aphelion at login — deliberately not enabled by default:
background observation should be a conscious choice. See
[Running Aphelion in the background](docs/background-service.md) for `launchd`/`systemd
--user` setup, health checks, and removal.

## CLI

| Command | When to use it |
| --- | --- |
| `aphelion [target]` | Observe a repository; defaults to the current directory. |
| `aphelion serve [target]` | The explicit form of the default command. |
| `aphelion sessions [target]` | List recorded sessions and their trail paths. |
| `aphelion timelapse <trail.jsonl>` | Render a standalone timelapse from an existing trail. |
| `aphelion hook` | Relay one agent-hook payload from stdin to the local daemon. |
| `aphelion mcp -- <server command...>` | Transparently observe an existing MCP stdio server. |

| Option | Meaning |
| --- | --- |
| `--open` | Open the loopback board after startup. |
| `--port <number>` | Preferred loopback port; falls forward if occupied. |
| `--idle-timeout <minutes>` | End a session after this much non-heartbeat inactivity (default 30). |
| `--site <url>` | Record a site target instead of a repository target. |
| `--audit-log <path>` | Tail the site-local audit mu-plugin JSONL. |
| `--debug-log <path>` | Tail a WordPress debug log with capture-boundary redaction. |
| `--wp-command <json>` | Read-only WP-CLI baseline from a JSON string array; no shell evaluation. |
| `--integrity` | Add SHA-256 `prev` links to new trail events. |
| `--no-watch` | Disable repository filesystem watching. |
| `--output <path>` | Timelapse `.html` or `.mp4` output path. |

Agent hooks pipe straight in — `printf '%s\n' "$AGENT_HOOK_JSON" | aphelion hook` — and MCP
calls stay declared requests, related to observed WordPress effects by request ID without
ever merging the records.

## Library

Aphelion is also a typed, zero-dependency ESM library:

```js
import { createTrailWriter, projectEvents, renderTimelapse, startDaemon } from 'aphelion'
```

The package exports the trail reader/writer, reducer, replay index, daemon, sidecar,
WordPress scanner, Accelerate adapter, and timelapse renderer, with type declarations.

## Trail ownership and privacy

The trail is the audit record: append-only, owned by you, and durable enough to answer
"what did the agent actually do" months after the session — replay is the forensic view
of the same file the live board projected.

| Property | Contract |
| --- | --- |
| Project trails | `<repo>/.aphelion/trail/<session>.jsonl` |
| Site trails | `~/.aphelion/trails/<site-slug>/<session>.jsonl` |
| File mode / flush | `0600`, flushed every event |
| Retention | Never deleted automatically |
| Network | Board and ingest bind to `127.0.0.1` |
| Telemetry / accounts | None |

Trails can still contain local paths, object titles, actor names, and action summaries —
treat them as operational records and review before sharing. See [Security](SECURITY.md).

## Documentation

[Documentation index](docs/README.md) · [Topology language](docs/topology-language.md) ·
[Observation surfaces](docs/observation-surfaces.md) · [Trail format](docs/trail-format.md) ·
[Background service](docs/background-service.md) · [Releasing](RELEASING.md) ·
[Changelog](CHANGELOG.md)

## Development

```sh
npm install
npm run verify
```

The verification gate builds the board, checks JS and PHP syntax, validates docs, runs the
unit and desktop/mobile browser suites, audits package exports, and installs the dry-run
tarball into a blank consumer.

Aphelion adapts the declared-versus-observed model from
[sodiumsun/agenttrail](https://github.com/sodiumsun/agenttrail) (MIT, vendored at `41454d4`);
substantially adapted files retain provenance comments.

## License

MIT. See [LICENSE](LICENSE).
