# AGENTS.md — aphelion

Source of truth for any agent working in this repo. `CLAUDE.md` points here; do not duplicate content between them.

## Before product decisions

Read `PRODUCT.md`. It defines the product, the phases, and eight design principles — the ones most often at risk in code changes: **observe never control** (no write path into the observed project), **local by construction** (localhost only, no telemetry, no accounts), and **record once, render many** (every new surface is a projection of the trail, never a second record). A change that violates a principle needs the principle changed first, not quietly worked around.

## Layout

| Path | What it is |
|---|---|
| `PRODUCT.md` | PRD / North Star — the why and what |
| `BUILD-PLAN.md` | Execution PRD — delivery sequence, acceptance gates, and test strategy |
| `HYPERFRAMES.md` | On-demand handoff for projecting truthful Aphelion trails into HyperFrames videos |
| `DESIGN.md` | Design tokens + locked art direction + topology/motion contracts — binding for all UI work |
| `PLAN.md` | The living component map (agenttrail convention) — maintain it as you work |
| `docs/` | Build-level specs: `trail-format.md` (the core primitive), `observation-surfaces.md` (how we see WordPress) |
| `upstream/agenttrail/` | Vendored MIT snapshot of sodiumsun/agenttrail (commit `41454d4`) — the code we adapt |
| `knowledge/` | Working notes; `agenttrail-assessment.md` has the upstream code review and extension points |
| `src/` | aphelion's own code (does not exist yet — first real build item) |

## Conventions

- **`upstream/agenttrail/` is a reference snapshot — never edit it.** Adapted code is copied into `src/` and modified there; the snapshot stays pristine for diffing against upstream.
- **Zero-dependency discipline.** Upstream's daemon has no npm dependencies and the UI has no build step. Keep that property unless a phase genuinely cannot ship without a dependency; adding one is a decision to record, not a default.
- **Attribution travels.** Files substantially derived from upstream keep a one-line provenance comment; the root `LICENSE` already carries the umbrella notice.
- **Owner-readable naming.** UI strings and component names are written for someone who cannot read code (see PRODUCT.md principle 5) — engineer phrasing goes in secondary detail, not headlines.

## Decisions

Record product- or architecture-shaping decisions in `knowledge/decisions.md` (date, decision, why) before implementing them.
