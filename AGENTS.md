# AGENTS.md — Aphelion

Source of truth for any agent working in this repo. `CLAUDE.md` points here; do not duplicate content between them.

## Before product decisions

Read `PRODUCT.md`. It defines the product, the phases, and eight design principles — the ones most often at risk in code changes: **observe never control** (no write path into the observed project or site), **local by construction** (localhost only, no telemetry, no accounts), and **record once, render many** (every new surface is a projection of the trail, never a second record). A change that violates a principle needs the principle changed first, not quietly worked around.

## Layout

| Path | What it is |
|---|---|
| `PRODUCT.md` | Product North Star — the why, the phases, the principles |
| `PLAN.md` | The living component map (agenttrail convention) — maintain it as you work |
| `docs/` | Product contracts: `trail-format.md` (the core primitive), `observation-surfaces.md` (how Aphelion sees WordPress), `topology-language.md` (places/flows/changes — binding for every topology surface) |
| `src/` | The daemon, board, trail, sidecar, mu-plugin, and timelapse code |
| `test/` | Node test suite + Playwright browser specs |
| `upstream/agenttrail/` | Vendored MIT snapshot of sodiumsun/agenttrail (commit `41454d4`) — the code we adapt |

Maintainers with access to the private companion repo check it out at `internal/` (gitignored here); if that folder exists, read `internal/AGENTS.md` as well. Its absence changes nothing about working in this repo.

## Conventions

- **`upstream/agenttrail/` is a reference snapshot — never edit it.** Adapted code is copied into `src/` and modified there; the snapshot stays pristine for diffing against upstream.
- **Zero-dependency discipline.** The daemon has no production npm dependencies and the board ships as prebuilt static assets with no runtime framework. Adding a production dependency is a deliberate, recorded decision, not a default.
- **Attribution travels.** Files substantially derived from upstream keep a one-line provenance comment; the root `LICENSE` carries the umbrella notice.
- **Owner-readable naming.** UI strings and card names are written for someone who cannot read code — engineer phrasing goes in secondary detail (the inspector), never in headlines. `docs/topology-language.md` is the binding text contract.
- **Observers alone write trails.** Never append an event by hand; obtain missing context through a new observation from an Aphelion observer.
