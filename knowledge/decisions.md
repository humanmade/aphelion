# Decisions

- 2026-08-25: Adapt agenttrail rather than rewrite (code review verdict in `agenttrail-assessment.md`); vendored as a pristine snapshot in `upstream/`, adapted code goes to `src/`.
- 2026-08-25: The trail (append-only per-session event log) is the core primitive; live board, replay, and timelapse are all projections of it — record once, render many.
- 2026-08-25: Timelapse is audit-faithful first (rendered from the trail, re-renderable after the fact), shareable render second — both wanted, one log.
- 2026-08-25: Core is agent- and plugin-agnostic; site-side signals arrive via adapters, Altis Accelerate first.
- 2026-08-25: Free OSS (MIT) permanently, no paid tier — return is positioning/distribution halo for Human Made and Accelerate.
- 2026-08-25: Trail is a product-owned durable format (JSONL, docs/trail-format.md) written at event time — never a view over an agent's own session folders, which are transient and cleanup-prone.
- 2026-08-25: Site observation happens at WordPress's hook layer via an audit mu-plugin, so MCP, REST, WP-CLI/SSH, and admin all land in one channel-tagged stream; client-side taps supply the declared half. Liveness/presence is first-class.
