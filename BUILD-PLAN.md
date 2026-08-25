# aphelion — Build Plan

Status: draft execution PRD for evaluation  
Last updated: 2026-08-25

This document defines how aphelion gets built and how each stage proves that it
works. It complements, rather than replaces, the existing sources of truth:

- `PRODUCT.md` defines the product, users, principles, phases, and non-goals.
- `BUILD-PLAN.md` defines delivery order, implementation boundaries, and gates.
- `PLAN.md` is the live component/status map maintained while work is underway.
- `knowledge/decisions.md` records durable product and architecture decisions.

If this document conflicts with `PRODUCT.md`, the product document wins. If an
implementation choice changes a product principle or architecture boundary, the
decision is recorded before code is written.

## 1. Outcome

Build a local, zero-ceremony flight recorder and live map for agents working on
WordPress repositories and sites. A user should be able to run:

```sh
npx aphelion --open
```

and see the agent's declared intent beside independently observed work, retain a
durable trail across crashes and restarts, replay any session, and render a
shareable timelapse from the same evidence after the fact.

The finished system proves one continuous path:

```text
repo / agent / WordPress observers
                |
                v
      append-only session trail
                |
        +-------+--------+
        |       |        |
        v       v        v
    live board  replay  timelapse
```

## 2. Non-negotiable product contracts

Every milestone must preserve these constraints:

1. **Observe, never control.** No production code sends prompts, edits the
   observed repo or site, approves actions, or blocks an agent.
2. **Local by construction.** Bind to loopback only. No account, cloud service,
   analytics, telemetry, or implicit outbound network call.
3. **One durable record.** The trail is the only source of historical truth.
   Live state, replay indices, rendered frames, and UI models are regenerable
   projections or caches.
4. **Declared and observed stay distinct.** Correlation happens in a projection;
   capture never rewrites the two signals into one claim.
5. **Owner-readable first.** Primary labels explain the work to a site owner;
   paths, hook names, and engineering detail remain available one level down.
6. **WordPress-native, integration-agnostic.** Core semantics understand
   WordPress, while agents and plugins enter through adapters.
7. **Zero-dependency runtime by default.** The daemon remains dependency-free and
   the board remains build-free unless a recorded decision proves otherwise.
   Development-only test tooling is evaluated separately from shipped runtime
   dependencies.
8. **Upstream stays pristine.** `upstream/agenttrail/` is never edited. Adapted
   files move into `src/` and retain a one-line provenance comment.

## 3. Release ladder

The project should ship useful, bounded releases instead of holding everything
for one large launch.

| Release | User-visible promise | Included milestones |
|---|---|---|
| `0.1` | Flight recorder for a local WordPress repo | M0–M3 |
| `0.2` | Reopen and scrub past sessions | M4 |
| `0.3` | Render a shareable timelapse from any repo trail | M5 |
| `0.4` | See runtime/site changes beside repo work | M6 |
| `0.5` | See site-operating agents, channels, and presence | M7 |
| `1.0` | Hardened end-to-end product with a stable trail contract | M8 |

Version numbers are sequencing labels, not promises of calendar dates. A release
advances only when its acceptance gate passes.

The first `0.1` vertical slice should be demoable in days, not after the plan has
been ceremonially exhausted. M0–M2 gates protect the few invariants that would be
expensive to repair later; they are not permission to delay the first working
trail, watcher event, and board projection. Keep the slice running as each layer
is replaced with its production implementation.

## 4. Delivery map

```text
M0 contracts and skeleton
        |
        v
M1 trail kernel
        |
        v
M2 repo + agent observation
        |
        v
M3 live board
        |
        v
M4 replay
        |
        v
M5 timelapse
        |
        v
M6 site runtime
        |
        v
M7 site-agent observation
        |
        v
M8 release hardening
```

M1 is the load-bearing milestone. No later surface may invent a second record or
skip the trail because a direct implementation is easier.

M6 does not technically depend on M5. It follows M5 in delivery order because a
repo-only timelapse already proves the product's uncontested differentiator and
creates the marketing loop before site integration expands the surface area.

## 5. Milestones

### M0 — Set the contracts and create the skeleton

Goal: make the first code change with the minimum contracts needed to protect the
trail and distribution path. Timebox this milestone; do not design later site
correlation or transport before real events exist.

Deliverables:

- Review Altis Audit Log's event schema and agentmetry-style hash chaining before
  promoting trail format v0 to v1.
- Keep plain append-only JSONL as the default and reserve an optional `prev` hash
  field for integrity-sensitive deployments; readers accept its absence.
- Define only the session identity, target identity, redaction rules, and
  forward-compatibility behavior needed by the trail envelope. Cross-channel
  correlation waits for M7 and real declared/observed fixtures.
- Create the root Node package, `bin/`, `src/`, and `test/` skeletons while
  preserving Node 20+ and a dependency-free shipped runtime.
- Add the complete npm pre-deploy scaffold described in section 6, following the
  proven Block Runner/Wesper package shape while preserving aphelion's
  dependency-free shipped runtime and build-free board.
- Establish source seams matching `PLAN.md`: `src/trail/`, `src/daemon/`,
  `src/board/`, `src/replay/`, `src/sidecar/`, `src/mu-plugin/`, and
  `src/timelapse/`.
- Document the local WordPress fixture commands, test modes, and reset boundary.
- Add focused test commands before adding implementation volume.

Acceptance gate:

- Package and CLI skeletons execute without observing or mutating a target.
- Test commands run from a clean checkout.
- No production dependency has been added without a recorded decision.
- The optional `prev` field and plain-default integrity behavior are recorded.
- Package verification passes locally and in CI while the accidental-publish
  guard remains active; no npm registry state is changed.

### M1 — Build the trail kernel

Goal: reliably record and reopen the evidence on which every surface depends.

Deliverables:

- Append-only JSONL writer with schema version, per-session sequence number,
  flush-per-event semantics, and a `session.start` first event.
- Project-target and site-target storage paths from `docs/trail-format.md`.
- Tolerant streaming reader that skips malformed lines and preserves unknown
  fields.
- Session discovery by directory listing, with no mutable global index.
- Explicit source/kind registry and payload redaction at capture boundaries.
- Optional `prev` hash emission that can be disabled without changing reader or
  projection behavior.
- Projection interface that consumes events in one forward pass.
- Derived sparse replay index that can be deleted and rebuilt.

Acceptance gate:

- Concurrent source events retain a deterministic per-session order.
- A process killed before `session.end` leaves a readable session.
- A malformed middle line does not prevent later events from rendering.
- Unknown fields survive a read/project/write compatibility fixture.
- Secret-shaped fixture values never appear in trail output.
- Deleting every derived cache leaves the trail and all history intact.

### M2 — Observe the repo and the agent

Goal: deliver the phase-1 WordPress repo map using adapted agenttrail behavior.

Deliverables:

- Copy and adapt the upstream daemon into `src/daemon/`, retaining provenance.
- File watcher with existing filters, throttling, Linux fallback, and loopback
  server behavior.
- PLAN.md parser and plan observer preserving stable IDs, `needs`, `links`, file
  ownership, task status, and owner-readable labels.
- Agent-hook adapters for supported tools, beginning with the upstream Claude
  hook shape and adding Codex/other adapters without changing the trail core.
- WordPress declaration scanner for, at minimum, `block.json`, block
  registration, REST routes, post types, admin pages, and hooks.
- Typed WordPress components joined to observed file activity.
- Every captured watcher, plan, and hook signal written to the trail before it
  reaches a UI model.

Acceptance gate:

- A plain repo works with file activity even when no PLAN.md or agent hook exists.
- A WordPress plugin repo produces a meaningful typed map with no configuration.
- Declared plan state and observed file activity appear as separate events.
- Hook relay failures cannot block or materially slow the observed agent.
- The observed target repo is byte-identical before and after aphelion runs,
  except for its documented local `.aphelion/` record directory.

### M3 — Project the live board

Goal: make current work legible without creating a second live-state model.

Deliverables:

- Split upstream's single HTML file into a few maintainable, concatenated source
  files while continuing to ship one static page with no framework build.
- A single reducer/projection that converts the trail head into the board model.
- SSE transport with full-model and throttled partial-update shapes.
- Typed WordPress map, current runs, file activity, declared/observed state, and
  owner-readable event summaries.
- Empty, degraded, disconnected, corrupt-line, and large-repo states.
- Accessible keyboard, focus, reduced-motion, and contrast behavior.

Acceptance gate:

- Reloading the board from the trail yields the same state as the live session.
- UI code never reads an agent transcript, repo watcher, or site observer
  directly.
- Loopback binding and absence of outbound telemetry are verified in tests.
- Desktop and narrow/mobile browser checks pass against deterministic fixtures.
- A non-developer can distinguish what the agent claimed from what happened.

### M4 — Replay any session

Goal: reconstruct the board exactly as it was at an arbitrary trail position.

Deliverables:

- Session picker and metadata summary.
- Time/sequence scrubber over the same projection used by the live board.
- Sparse snapshot index for bounded seeks, always rebuildable from JSONL.
- Clear treatment of missing `session.end`, malformed events, clock jumps, and
  late events.
- Stable shareable local URLs or CLI arguments for reopening a session.

Acceptance gate:

- Replaying to sequence N equals a fresh projection of events 1…N.
- Live and replay surfaces use the same reducer and presentation semantics.
- Removing the replay index changes performance, not output.
- A crash-ended session remains fully replayable.

### M5 — Render the timelapse

Goal: create a polished, shareable video from any completed or partial trail.

Deliverables:

- Deterministic frame/scene projection from trail time.
- Render CLI with explicit output, dimensions, duration/compression, and theme.
- Pacing rules that compress inactivity while preserving significant work.
- Owner-readable event emphasis and declared/observed moments.
- Re-render support after the original session and target have disappeared.
- Recorded dependency decision for browser capture, FFmpeg, or another renderer;
  keep heavy rendering machinery outside the daemon runtime.

Acceptance gate:

- The same trail plus render options produces materially deterministic output.
- Rendering requires no live agent, WordPress site, or native agent transcript.
- A partial/crash-ended session renders with an honest ending.
- The video never claims an event that is not present in the trail.
- Output quality meets a human review gate; correctness alone is insufficient.
- A repo-only session produces a public-demo-quality render without any
  WordPress runtime or site-observation dependency.

### M6 — Observe WordPress runtime state

Goal: add database and runtime effects without requiring site-side code.

Deliverables:

- Sidecar that can use local WP-CLI or an explicitly configured remote/SSH
  transport.
- Bounded polling/diff strategies for options, cron, rewrites, transients, and
  selected runtime state.
- `debug.log` tailing with rotation/truncation handling and redaction.
- Baseline-versus-change semantics so startup inventory is not misrepresented as
  agent activity.
- Adapter interface for plugin-specific meaning; Accelerate is the first
  implementation, not a special case inside core.
- Presence signals for active CLI/runtime channels where they can be observed.
- Site-feature baseline of WordPress 6.9+; repo-only features remain governed by
  the Node 20+ runtime rather than a WordPress version.

Acceptance gate:

- Starting the sidecar produces an inventory/baseline, not a false burst of
  changes.
- A controlled external WordPress action produces the expected trail event once.
- Polling stays bounded on a representative site and handles an unavailable DB,
  CLI, SSH connection, or log without corrupting the trail.
- Removing the sidecar leaves M0–M5 fully functional.

### M7 — Observe agents operating the site

Goal: correlate what an agent requested with what WordPress actually changed.

Deliverables:

- Minimal PHP 7.4+ audit mu-plugin covering consequential post, option, meta,
  term, plugin, REST, and relevant Abilities API hooks.
- Site-local audit log collected by the sidecar. A loopback or remote stream is a
  later transport option, not part of this milestone's core path.
- Channel and actor attribution for REST, WP-CLI, admin, cron, MCP, and unknown
  origins without pretending uncertain identity is known.
- Preserve action channel separately from transport: for example, `wp-cli` over
  `docker-exec` is not mislabeled as SSH, and `wp-cli` over SSH retains both
  facts. MCP transport and Abilities invocation are likewise separately visible.
- Official MCP Adapter observability-handler integration where available.
- Compatibility path for the local WordPress 7.0 fixture when newer hooks such as
  `wp_ability_invoked` are unavailable.
- Correlation IDs/timing strategy designed from captured declared and observed
  fixtures, joining events only in projections and never at write time.
- Connection lifecycle events for open, ready, heartbeat, clean close, error,
  timeout, disconnect, and reconnect where the channel exposes enough signal.
- WordPress-aware context for affected object type/ID/title/status, option or
  setting name, taxonomy, plugin/theme, REST route, ability, WP-CLI command
  family, hook, site, and confidence/provenance—redacted before trail emission.
- Accelerate adapter translating raw effects into owner-readable experiment and
  analytics events.

Acceptance gate:

- MCP/Abilities, REST, WP-CLI, and wp-admin fixture actions land in the same trail
  with accurate or explicitly unknown channels.
- Declared and observed events can correlate but remain separately inspectable.
- Payloads exclude credentials, raw sensitive request bodies, and unnecessary
  content.
- Disabling the mu-plugin removes fidelity without breaking the sidecar or repo
  observer.
- The mu-plugin exposes no settings or write/control surface.
- Live board, replay, and timelapse show the same channel, transport, lifecycle,
  and WordPress context from the same trail events.

### M8 — Package and harden the whole product

Goal: make the complete path trustworthy outside the development machine.

Deliverables:

- `npx aphelion --open`, explicit target/site modes, help, diagnostics, and clean
  shutdown.
- macOS, Linux, and Windows path/watcher/port behavior where supported.
- License/provenance audit for every adapted upstream file.
- Resource bounds for tree size, SSE payloads, trail growth warnings, polling,
  replay indexing, and render work.
- Security/privacy review of loopback HTTP, hook endpoints, path handling,
  redaction, site transport, and HTML escaping.
- Upgrade/migration policy for trail schema versions.
- User documentation, fixture recipes, troubleshooting, and demonstration trail.
- A publish-ready npm tarball, npm listing copy, release checklist, and inert
  Trusted Publishing workflow design. The actual registry publish remains a
  separately authorized release action.

Acceptance gate:

- Clean-machine install and first-value walkthrough pass.
- No feature requires an account or external service.
- Runtime tests, integration tests, browser tests, and packaging smoke tests pass.
- The defining 1.0 demo captures an Accelerate experiment action end to end:
  declared request, observed WordPress effect, live board, replay, and
  after-the-fact timelapse from one trail. The coding-agent repo story also
  passes as the baseline path.
- Release evidence distinguishes source checks, local integration, browser proof,
  package proof, and any still-unverified platform claim.
- A clean consumer can install the packed artifact, run the CLI, and import the
  library without any registry mutation.

## 6. npm package pre-deploy contract

Aphelion is an npm-distributed CLI and importable library. Its package scaffold
should reuse the mechanics already proven in `dev/block-runner` and `dev/wesper`
without inheriting dependencies or build machinery that this product does not
need.

Boundary: **publish-ready, not published.** This plan does not authorize
`npm publish`, dist-tag mutation, package-owner changes, Trusted Publisher
registration, or any other registry or launch action.

### Package shape

- Use the public package name `aphelion`, but keep an accidental-publish guard
  (`"private": true`) active until an explicitly authorized release change
  removes it.
- Ship ESM for Node 20+ with distinct CLI and library contracts:
  `bin.aphelion` points to an executable entry point and `exports["."]` points to
  the importable API.
- Put types first and the runtime/default target last in conditional exports;
  expose `./package.json` for tooling.
- Complete `types`, `repository`, `homepage`, `bugs`, `license`, `author`,
  `keywords`, and owner-readable `description` metadata before release handoff.
- Use a positive `files` allowlist. Exclude tests, local trails, credentials,
  Docker fixtures, private notes, and development-only artifacts from the
  tarball.
- Require the CLI shebang and executable mode, stable `--help` and `--version`
  output, and non-zero exit status for invalid invocation.
- Add no `preinstall`, `install`, or `postinstall` scripts. Limit lifecycle work
  to deterministic prepack verification.
- Preserve zero production dependencies unless a recorded decision changes that
  constraint. Commit a lockfile and use `npm ci` in CI.
- Prefer direct ESM and JSDoc/types over automatically adding TypeScript or a
  bundler. If a source transform becomes necessary, record the decision first;
  it must not create a runtime dependency or a build requirement for the static
  board.

### Verification scaffold

Provide one `npm run verify` entry point that includes:

- unit and integration tests plus type/JSDoc checks where applicable;
- deterministic assembly checks for any generated runtime or static-board
  artifact;
- package-contract checks for required files, CLI shebang/mode, `--help`,
  `--version`, library import, and shipped static assets;
- `publint` and, when a typed public API exists, `@arethetypeswrong/cli`;
- `npm pack --dry-run --ignore-scripts` plus an exact allowlist and a scan for
  private paths, fixture credentials, and undeclared local dependencies;
- a clean temporary-consumer smoke test that installs the generated tarball,
  runs the CLI, imports the library, and opens a fixture trail without relying on
  the source checkout.

CI runs those checks from a clean checkout on Node 20, 22, and 24. It may not
depend on globally installed tools or files outside the repository.

### Listing and release preparation

- Structure the npm-facing README as: one-line promise, visual proof, install,
  first-value quickstart, differentiation, CLI/library reference, local/privacy
  trust contract, contributing, and license.
- Choose keywords that describe actual search intent and shipped capability, not
  aspirational categories.
- Add `RELEASING.md` covering versioning, changelog, prerelease/dist-tag policy,
  rollback/deprecation, verification evidence, and the exact human-authorized
  release handoff.
- Design a provenance-enabled npm Trusted Publishing/OIDC workflow with no
  long-lived npm token, but keep its publish job absent or inert until a separate
  release change is authorized.
- Recheck registry name and security state immediately before release. The
  read-only `E404` observed for `aphelion` on 2026-08-25 is a snapshot, not a
  reservation.

### Pre-deploy acceptance gate

- `npm ci` and `npm run verify` pass from a clean checkout.
- `publint`, the applicable types check, and the dry pack inspection pass.
- The generated tarball contains exactly the intended public files and passes in
  a clean temporary consumer.
- CLI help/version and library import work only from the installed tarball.
- Package metadata, README/listing copy, license, and provenance are complete.
- CI proves package verification on the supported Node matrix.
- Release documentation and the inert OIDC/provenance design are reviewable.
- `"private": true` remains active and no registry state has changed.

## 7. Local WordPress integration target

### Verified snapshot — 2026-08-25

| Property | Observed value |
|---|---|
| Site | `http://localhost:8081` |
| Admin | Unauthenticated requests redirect to login; authenticated dashboard access succeeds |
| Browser title | `Dashboard ‹ Accelerate Demo — WordPress` |
| WordPress runtime | `7.0.4` |
| PHP image | `wordpress:6.7-php8.1` with the local WordPress tree bind-mounted |
| Compose project | `accelerate` |
| Compose files | `/Users/noeltock/dev/altis-accelerate/docker-compose.yml` and override |
| Services | WordPress, MariaDB, ClickHouse, Accelerate tracker |
| Active plugin | `altis-accelerate/plugin.php` |
| Debugging | `WP_DEBUG` and `WP_DEBUG_LOG` enabled |
| Browser auth | Authenticated wp-admin dashboard and Accelerate menu access confirmed |
| Container access | Read-only PHP/WordPress checks confirmed via Docker exec |

This is a development integration target, not aphelion-owned infrastructure.
Current state is recorded at the start of every test run because container image
tags, mounted WordPress core, plugins, data, and authentication may drift.

### Test modes

1. **Network smoke — read-only.** Check HTTP reachability, redirect behavior,
   loopback binding, and service health.
2. **Container/WordPress smoke — read-only.** Load WordPress inside the container
   and inspect version, plugin availability, hooks, and log reachability.
3. **Public browser smoke — read-only.** Exercise visible public pages and login
   boundary in the in-app browser.
4. **Authenticated admin smoke — read-only.** Exercise wp-admin through an
   explicitly authenticated testing session. Credentials are never stored in
   aphelion, the repository, or its trail.
5. **Observation integration — controlled writes.** A separate test driver acts
   as the external agent/user through WP-CLI, REST, MCP, or wp-admin. aphelion only
   observes. Every test uses namespaced fixtures and asserts the emitted trail.
6. **Mutating end-to-end — limited and reversible.** Small fixture actions are
   authorized on this local stack once the runner can prove per-action cleanup or
   snapshot/restore. Broad settings changes, plugin/theme lifecycle changes,
   user changes, bulk content changes, and volume/database resets remain out of
   scope unless separately approved.

### Cross-channel QA matrix

Each campaign uses a shared run ID but independent driver sessions. Actions are
small enough to understand from the WordPress UI and specific enough to verify in
the trail, live board, replay, and timelapse.

| Channel | External driver | Representative fixture action | Lifecycle evidence |
|---|---|---|---|
| wp-admin | Authenticated browser | Create and edit an `aphelion-test-*` draft; change and restore one low-impact field | Browser session start/end plus accurately attributed admin effects |
| REST | Authenticated test client | Create or update a namespaced draft or term | Connect/auth outcome, requests, error/timeout, close |
| WP-CLI | Real WP-CLI process via Docker exec or SSH when available | Inspect state, then create/update a namespaced fixture | Process/transport open, command family, exit, disconnect |
| MCP / Abilities | Official MCP client/adapter path | Invoke safe read abilities and a controlled fixture mutation when exposed | Client connect, ready/heartbeat, invocation, timeout/error, reconnect, close |

Docker exec proves a local container transport, not SSH. SSH is claimed only
when an actual SSH transport is configured and exercised. A missing channel is
reported as a coverage gap rather than simulated under another label.

#### WordPress content and integration campaigns

The channel matrix is crossed with the following behavior cases. These are
product acceptance cases because they determine whether the WordPress context is
useful, not merely whether an event was captured.

| Case | Controlled action | Required WordPress context | Safety/cleanup |
|---|---|---|---|
| Block content | Update a namespaced draft with paragraph, heading, image/cover, nested group, and plugin blocks where available | Post/page type, object ID/title/status, block names and count; never block text or attributes containing content | Restore or delete only the namespaced draft |
| Pages and revisions | Create, edit, autosave/revise, trash, and restore a namespaced page | Distinguish canonical save from revision/autosave noise; retain lifecycle and actor | Exact fixture ID tracked; cleanup independently verified |
| WordPress settings | Change and restore one low-impact namespaced or presentation setting | Option name and changed/no-op outcome, never the option value | Capture prior value and prove restoration |
| Plugin-owned metadata | Set and restore Yoast-style `_yoast_wpseo_*` keys and Accelerate experiment metadata on a fixture | Meta key, owning plugin namespace, post ID, semantic adapter event where available; never metadata value | Remove only exact test keys from exact fixture |
| Connector transports | Exercise local process, Docker exec, REST/HTTP, wp-admin browser, MCP HTTP/stdio when installed, and real SSH only when configured | Action channel and transport remain separate; open/ready/heartbeat/error/timeout/disconnect/reconnect/close are reconstructable | Restore any temporarily activated connector plugin to its starting state |
| WordPress AI | Invoke core read Abilities and a request-scoped fixture Ability through the official MCP adapter or Abilities API | MCP declaration, Ability name/outcome, official `wp_after_execute_ability` observation, correlated WordPress effects | Request-scoped registration; mutation limited to namespaced fixture |

Accelerate supplies realistic block, experiment, and adapter fixtures, but the
WordPress AI acceptance case is intentionally generic. The product must work
with core or third-party Abilities and the official WordPress MCP Adapter without
making Accelerate a dependency.

For every action, QA verifies four views of the same evidence:

1. the resulting WordPress state is correct and visible through an independent
   read path;
2. the raw trail preserves declared action, observed effect, channel, transport,
   actor/source, lifecycle, and WordPress context without inventing certainty;
3. the live board renders an owner-readable explanation with technical detail
   available one level down; and
4. replay and timelapse reconstruct the same facts without consulting WordPress.

Timing is part of each assertion. Source event time, local capture time, phase
gaps, declared-to-first-effect latency, connection duration, and cleanup duration
are retained at millisecond precision when observable. Remote clock skew is
reported rather than silently normalized. Presentation may apply a documented
idle-time compression curve, but it must preserve event order and relative
within-journey pacing. Active glow/energy motion is driven only by a genuinely
open phase; completed journeys render as completed rather than looping an
activity signal forever.

### Fixture safety contract

- Never treat the running stack as disposable unless its owner explicitly says
  so for that run.
- Default to read-only checks.
- Keep test-driver code outside production observer code.
- Prefix synthetic entities with `aphelion-test-` and attach a run ID.
- Capture a pre-test state marker and prove cleanup/restore afterward.
- Prefer new namespaced drafts/terms over editing meaningful existing content.
- When a setting must be exercised, capture its exact prior value, change only a
  low-impact setting, restore it in the same run, and verify the restoration.
- Never reset volumes, delete content, change users, or rotate credentials as an
  implicit test step.
- Do not substitute container/PHP proof for authenticated browser proof, or vice
  versa; report each layer separately.

## 8. Test strategy

### QA cadence

Build enough product to make each QA campaign meaningful; do not repeatedly
exercise the Docker site against placeholder surfaces. Focused unit and contract
tests still run continuously while implementation is underway.

1. **After M3:** test the first complete repo trail -> live-board vertical slice
   with deterministic fixtures and desktop/narrow rendering evidence.
2. **After M5:** run a concentrated replay/timelapse campaign and prove all three
   projections agree on the same sessions.
3. **After M6 and M7 form one coherent site slice:** run the broad local WordPress
   campaign across wp-admin, REST, WP-CLI/Docker, real SSH when available, and
   MCP/Abilities. Include success, no-op, failure, timeout, disconnect, and
   reconnect cases.
4. **During M8:** convert important exploratory flows into deterministic
   regression tests, repeat the entire matrix, and retain release evidence.

Every campaign writes a compact `QA_REPORT.md` and artifact manifest with the
commit/environment, exact steps, run IDs, viewports, before/after screenshots,
trail excerpts, browser trace or scripted step log, console/network failures,
cleanup result, findings, and explicit coverage gaps. A screenshot alone is not
proof; rendering evidence is correlated with trail and WordPress state.

### Unit and contract tests

- Use Node's built-in test runner where practical.
- Golden JSONL fixtures cover each source/kind and schema version.
- Property-style cases cover malformed lines, unknown fields, clock jumps,
  ordering, redaction, rotations, and partial writes.
- Parser fixtures cover PLAN.md and representative WordPress declarations.
- Projection fixtures prove live/replay equivalence.

### Isolated integration tests

- Temporary repositories exercise watchers, hook relays, PLAN changes, ignored
  files, large trees, and crash recovery.
- No test depends on the developer's current repo or native agent transcript.
- Port collision, loopback binding, disconnected clients, and daemon restart are
  explicit cases.

### Docker WordPress tests

- Versioned fixture expectations are checked before assertions run.
- Test the lowest-cost observation surface first and escalate only when needed.
- Site writes are made only by the external test driver.
- Tests assert trail events and projections, not just log lines or HTTP success.
- Site features target WordPress 6.9+ and the mu-plugin targets PHP 7.4+.
  WordPress 7.0 compatibility is proven locally; newer hooks require a separately
  identified fixture or a guarded compatibility test.

### Browser tests

- Verify desktop and narrow viewports for the live board, replay, and timelapse.
- Use deterministic trails for visual/interaction tests.
- Test the live Docker site only for flows that require actual WordPress state.
- Authenticated wp-admin access is proven for the current local browser session;
  future automation must not persist credentials in source or trail data.
- Capture pre-action and post-action state, then verify owner-readable summaries,
  expandable WordPress detail, channel/lifecycle badges, ordering, empty/error
  states, live updates, replay scrubbing, and narrow-layout overflow.
- Convert any release-critical agentic discovery into a deterministic browser or
  trail-fixture regression test.

### Portability and release tests

- Node 20+ package smoke on supported operating systems.
- Linux recursive-watcher fallback and Windows path behavior.
- Clean `npx` install with no undeclared local files.
- License/provenance and package-content inspection.

## 9. Pull-request sequence

Keep each PR independently reviewable and tied to one acceptance gate:

1. Minimal trail-v1 contracts, npm package pre-deploy scaffold, package/test
   skeleton, and fixture documentation.
2. Trail writer, reader, discovery, and corruption/redaction tests.
3. Adapted daemon and watcher/PLAN/hook events written into the trail.
4. WordPress declaration scanner and typed repo map.
5. Live board projection and maintainable static source split.
6. Replay reducer, index, and scrub UI.
7. Timelapse projection, renderer, and repo-only shareable demo.
8. Runtime sidecar and local Docker read-only integration.
9. Audit mu-plugin, site-local log, channel attribution, and controlled-write
   harness.
10. Official MCP/Abilities tap, correlation, presence, and Accelerate adapter.
11. Cross-channel WordPress QA campaign, rendering/replay/timelapse parity, and
    deterministic regressions for discovered failures.
12. Packaging, portability, security/privacy review, and release evidence.

A PR may be split further when reviewability demands it. It should not span two
milestones merely to make the roadmap appear faster.

Each implementation PR must:

- mark the relevant `PLAN.md` task active before work and complete afterward;
- add or update the focused test proving its contract;
- record any architecture/product decision before implementation;
- retain provenance on substantially adapted upstream files;
- report source, integration, browser, and release proof separately;
- leave unrelated dirty work untouched.

## 10. Decision queue

These questions are intentionally deferred to the milestone that needs them:

| Decision | Required before | Default until decided |
|---|---|---|
| Development dependencies versus zero-dependency shipped runtime | M0 | Built-ins only |
| Final npm release authority and package-name reservation | Release handoff | Keep the package private and publishing disabled; make no registry mutation |
| Timelapse renderer and external binary policy | M5 | No daemon dependency |
| Polling scope and retention/size warnings | M6 | Minimal opt-in surface |
| Cross-channel correlation IDs and timing | M7 | Design from real fixtures; no implicit identity merging |
| WordPress 7.1+ ability-hook support versus 7.0 fallback | M7 | Feature-detect from the 6.9+ baseline |
| Docker `mysqldump` snapshot/restore command | First broad or multi-step mutating campaign | Only namespaced actions with proven per-action cleanup until restore is proven |
| Browser authentication lifecycle for repeatable wp-admin tests | First automated admin test | Manual session sign-in; never store credentials |
| Remote site transport and authentication | Post-0.5 remote-site support | Site-local log collected by the sidecar |
| Supported operating systems beyond the Node 20+ baseline | M8 | Prove each platform before claiming it |

## 11. Principal risks and controls

| Risk | Control |
|---|---|
| A live surface becomes a second source of truth | Require every surface to rebuild from the trail |
| Observation changes the thing being observed | Test byte/state identity; isolate all test writes in an external driver |
| Sensitive WordPress or agent data reaches the trail | Redact at source; fixture secret-pattern tests; never capture credentials or raw bodies by default |
| Correlation overstates causality | Preserve separate events and show unknown/likely correlation honestly |
| Polling creates noise or load | Baseline first, bounded polling, targeted adapters, measured budgets |
| Upstream adaptation becomes an unmaintainable fork | Preserve snapshot, provenance, small modules, and deliberate upstream diffs |
| UI growth destroys the zero-build advantage | Concatenate a few static sources; record any toolchain change |
| Timelapse becomes cosmetic but unauditable | Render only trail events; correctness gate before taste gate |
| The local Docker stack drifts | Preflight versions/services/plugins and label proof with the observed snapshot |
| Tests damage a useful demo site | Namespaced low-impact fixtures; capture prior values; per-action cleanup or proven restore; no broad mutation without separate approval |
| One access method is mislabeled as another | Record channel and transport separately; claim SSH only from a real SSH connection |
| The UI looks plausible but loses audit truth | Correlate screenshots with WordPress state and raw trail; require live/replay/timelapse parity |

## 12. Project-wide definition of done

The project is complete for 1.0 when all of the following are true:

- A clean consumer can install the packed artifact and run
  `npx aphelion --open` to reach a useful local board in a WordPress repo with no
  account and near-zero setup. Registry deployment is separately authorized.
- The durable trail survives restart, corruption, missing session-end events, and
  deletion of every derived cache.
- Repo files, agent declarations, runtime changes, and site-side effects are
  captured as source-identified events without giving aphelion a write path.
- The board shows declared and observed work in language a site owner can follow.
- Replay reconstructs the same board from the same reducer.
- A timelapse can be rendered after the session and observed target are gone.
- The Accelerate Docker demonstration proves an experiment action across declared
  request, observed WordPress effect, live board, replay, and timelapse. The
  coding-agent repo story passes alongside it as the baseline case.
- The local WordPress QA matrix proves wp-admin, REST, WP-CLI, and MCP/Abilities
  where available, including lifecycle/failure cases and honest coverage gaps.
- Each consequential WordPress action carries enough redacted site context to be
  understandable in the live board and identical when replayed or rendered.
- No outbound telemetry, hosted account, hidden retention policy, or silent data
  deletion exists.
- Supported-platform, security/privacy, provenance, and package checks pass with
  evidence that distinguishes local, browser, integration, and release proof.

## 13. Assumptions, deferred scope, and settled evaluation answers

### Assumptions

- `(stated)` The Docker WordPress site at `localhost:8081` is intended as an
  integration-test target during development.
- `(stated)` The Accelerate stack is resettable and has a synthetic-data testbed;
  the canonical `mysqldump` snapshot/restore procedure is defined only when the
  first broad or multi-step mutating campaign needs it. Small namespaced actions
  may run earlier when their exact prior state and cleanup are proven.
- `(repo)` `PRODUCT.md` remains the product authority and the eight principles are
  unchanged.
- `(repo)` Zero dependencies applies to the shipped runtime; a dev-only tool may
  still be approved by a recorded decision.
- `(assumed)` Delivery is gate-driven rather than tied to a fixed launch date.

### Out of scope for this plan

- Turning aphelion into an agent runner, approval gate, hosted service, or general
  LLM cost/tracing platform.
- Redesigning or owning the Accelerate Docker stack.
- Adding product write operations merely to make end-to-end tests easier.
- Choosing final visual design before the live/replay information architecture is
  proven against real trails.

### Settled evaluation answers

1. Timelapse follows replay and ships in `0.3`, before site observability.
2. The Accelerate fixture uses a `mysqldump` snapshot/restore contract introduced
   with the first broad or multi-step mutating campaign. Earlier writes stay
   small, namespaced, reversible, and independently verified.
3. Hash chaining is optional. Trail v1 reserves an optional `prev` hash field and
   keeps plain append-only JSONL as the default.
4. Repo features support environments where Node 20 runs. Site features baseline
   WordPress 6.9+; the mu-plugin baselines PHP 7.4+.
5. The mu-plugin writes a site-local log collected by the sidecar. Streaming is a
   later transport option.
6. The defining 1.0 story is an Accelerate experiment action end to end. The
   coding-agent repo story remains required baseline functionality.
7. QA runs in substantial campaigns after meaningful vertical slices, with broad
   cross-channel WordPress coverage after M6+M7. Every important result must agree
   across WordPress state, raw trail, live board, replay, and timelapse.
