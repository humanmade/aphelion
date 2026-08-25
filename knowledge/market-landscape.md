# Market & platform landscape (researched 2026-08-25)

Deep-tier research: 6 angles, ~25 runner/gatherer agents, findings verified against official sources fetched on 2026-08-25 unless labeled otherwise. Decision served: is aphelion's space (durable trail + declared-vs-observed + replay/timelapse for agent activity on WordPress) actually open, and what should we adopt vs. build?

**TLDR: The combination is uncontested, but neither half is empty.** WordPress audit logging is a mature incumbent market that stops at searchable lists; generic coding-agent recording is a crowded, fast-moving OSS space that stops at interactive replay. Nobody unifies channels, nobody correlates declared-vs-observed, nobody renders timelapse, nobody treats "AI agent" as a first-class actor — and nobody is positioned across both the repo and the site. The window is real but opened recently (agent-aware logging started appearing May–July 2026); move accordingly.

## 1. WordPress audit logging (incumbents — all searchable lists, none live/replayable)

| Product | Installs | Model | Storage | Agent-aware? |
|---|---|---|---|---|
| WP Activity Log (Melapress) | 300k+ | freemium → SIEM mirroring | custom tables, 3-mo default retention | no |
| Simple History | 300k+ | freemium ($79+/yr) | custom tables, **60-day destructive purge** | **yes — agent attribution since v5.27 (May 2026); REST/WP-CLI coverage since v5.28** |
| Sucuri | 600k+ | free + paid platform | **local JSON + cloud copy** | no |
| Activity Log (Elementor) | 200k+ | free GPL | custom table, 30-day purge | tags request source **incl. Abilities API** |
| Stream (XWP) | 80k+ | free GPL, XWP services | custom tables, TTL purge | no |
| Jetpack Activity Log | — | cloud, retention-tiered | cloud | no |

Confirmed absent across all (and 7 more surveyed: MalCare, Patchstack, WP Umbrella, MainWP, Activity Log Pro, Logify, ManageWP): live boards, replay/scrubbing, timelapse, declared-vs-observed, cross-channel session correlation.

**Simple History is the closest neighbor** — agent attribution shipped, extensible logging API, REST/WP-CLI read access. Treat as potential trail *source* on sites that run it, not as a competitor to displace. Its 60-day purge default is the antithesis of the trail.

## 2. Platforms & APM (wrong layer, deliberately)

Query Monitor (per-request, zero persistence), New Relic/Datadog/Sentry (performance/errors, no content activity; Datadog closed full WP hook coverage as "not planned" — dd-trace-php#2713), WP Engine/Kinsta/Pantheon (account/infra logs only; Pantheon explicitly disclaims CMS content tracking). **No vendor has an "AI agent" actor class.**

Two pieces of prior art matter:
- **Altis Audit Log (Human Made)** — append-only, tamper-resistant cloud storage, indefinite retention, who/what/when over CMS entities, built on Stream (docs.altis-dxp.com/security/audit-log/). The nearest architecture to the trail, in-house. Compare schemas before finalizing trail-format v1.
- **WordPress VIP Audit Log** — immutable, lifetime retention, actor types incl. "Platform Bot", permalink-per-event view. Enterprise pattern validation.

## 3. Agent access to WordPress (the channels, verified)

- **Official rails**: Abilities API in core since WP 6.9 (Nov 2025); `WordPress/mcp-adapter` is canonical (v0.6.1 Aug 2026, active; Automattic's wordpress-mcp is archived and redirects to it). WP 7.0 (Apr 2026) put MCP in core; public discourse immediately flagged the oversight gap.
- **Tap points that exist today**:
  - `wp_ability_invoked` action (WP 7.1, Jul 2026) — fires at start of every ability execution, explicitly intended for auditing. Caution from core: raw input may contain sensitive data — redact.
  - mcp-adapter's `McpObservabilityHandlerInterface` — pluggable handlers receive who/which-ability/params/duration/failure-reason per `mcp.request`; injected via `mcp_adapter_default_server_config` filter. **aphelion's site-side MCP tap should be a registered handler, not a log-scraper.**
  - AI plugin 1.0.0 (May 2026) ships a "Request Logging" experiment for AI calls.
- **Real traffic today is in third-party MCP plugins**, not the official adapter: AI Engine 100k+, Royal MCP 10k+, WPVibe 10k+, Easy MCP AI 8k+. Four of these already ship MCP audit logs (miniOrange Secure MCP markets agent oversight as the product, Jul 2026). Logging *their own channel* is becoming table stakes; none correlate with observed writes or cover other channels.
- **Identity**: agents authenticate as WP users (application passwords/JWT) → attribution rides existing capability checks.
- **WP-CLI over SSH**: real in practice, documented by no host as an agent channel — only hook-layer observation ever sees it.
- Commercial builders (10Web, Elementor AI, Jetpack AI, CodeWP) are walled gardens — neither competitors nor observable targets.
- *Coverage gap: browser-driven wp-admin agents (computer-use) were not separately researched.*

## 4. Generic coding-agent recording (crowded; adopt patterns, don't compete head-on)

- **claude-replay** (818★, MIT, active) — the flagship replayer: interactive HTML player with scrubbing over agent transcripts. **Reads agents' native session folders** — the fragility our trail exists to avoid. No video export (deliberate choice).
- **agentsview** (5.2k★, MIT) — multi-agent session browser, SQLite local-first.
- **Agent-Blackbox** (72★, MIT) — NDJSON local logs + scrub-to-any-moment dashboard; closest to trail+replay.
- **agentmetry** (12★, Apache) — hash-chained JSONL audit trail, committed hours before research; **hash-chaining is worth stealing for trail integrity**.
- Also: AgTrace (59★), retrace (deterministic replay, `.flight` files), sandbase-harness (633★, resumable SSE replay), Campfire (X launch, orchestrator with replay), disler's claude-code-hooks observability (1.5k★). Enterprise proprietary: Vorlon, Honeycomb Agent Timeline. A tail of one-shot HN "flight recorder" launches (1–4 pts) could not be re-verified — no staying power.
- **Confirmed by three independent lanes (GitHub, HN, Firecrawl web): no tool combines durable trail + replay UI + shareable timelapse video.** Timelapse is uncontested everywhere.

## 5. What this changes for aphelion

1. **Lead with WordPress-native + site observability.** The generic recorder race is crowded and days-fresh; our defensible ground is the site as observed object, hook-layer ground truth, declared-vs-observed across channels, owner-readable surfaces. Generic mechanics get adopted (formats, hash-chaining, asciicast for terminal), not fought over.
2. **The MCP tap is an integration, not a build**: register an observability handler with mcp-adapter; hook `wp_ability_invoked` in the mu-plugin. Both official, both shipped.
3. **Simple History and Altis Audit Log are neighbors to interoperate with**, not displace — potential trail sources; Altis is in-house schema prior art.
4. **Timelapse is the differentiator nobody has** — claude-replay's author explicitly chose not to build video. Every lane confirmed the gap.
5. **Timing**: agent-aware logging on WP went from zero to four products between May and July 2026. The window is open and closing at plugin-ecosystem speed.

## Could not verify / caveats

- Logify (named in one 2026 roundup) — no product URL found.
- Hindcast, Lightbox, Agnys (HN launches) — repos/sites not re-locatable; treated as dead one-shots.
- WP Activity Log DB schema — not publicly documented.
- Simple History agent-attribution details — single-source (its own changelog).
- Browser-driven wp-admin agents — not researched (open angle).
- One early gatherer returned seven empty Brave responses and drew "confirmed absent" conclusions — discarded as a tool failure; its lane was re-run on Firecrawl and is reflected above.

*Tier: deep · ~25 agents · sources fetched live 2026-08-25 · credits: low hundreds (Firecrawl), within guardrails*
