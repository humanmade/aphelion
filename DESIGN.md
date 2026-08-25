---
version: alpha
name: aphelion
description: Monochrome instrument board for observing AI agents on WordPress — dark-first system type, light-as-activity.
colors:
  background: "oklch(0.145 0 0)"
  surface: "oklch(0.185 0 0)"
  surface-raised: "oklch(0.225 0 0)"
  border: "oklch(0.28 0 0)"
  border-strong: "oklch(0.38 0 0)"
  primary: "oklch(0.985 0 0)"
  on-primary: "oklch(0.145 0 0)"
  text: "oklch(0.985 0 0)"
  text-secondary: "oklch(0.74 0 0)"
  text-tertiary: "oklch(0.58 0 0)"
  live: "oklch(0.77 0.15 162)"
  declared: "oklch(0.66 0.16 255)"
  attention: "oklch(0.8 0.14 85)"
  danger: "oklch(0.64 0.19 25)"
typography:
  heading:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.01em
  body:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0em
  node-title:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 16px
    fontWeight: 590
    lineHeight: 1.35
    letterSpacing: -0.005em
  evidence:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0em
  label:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.06em
  brand:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 16px
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: -0.03em
  display:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 36px
    fontWeight: 650
    lineHeight: 1.05
    letterSpacing: -0.03em
  metric:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 24px
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: -0.03em
rounded:
  xs: 2px
  sm: 5px
  md: 7px
  lg: 10px
  xl: 12px
  detail: 14px
  full: 9999px
spacing:
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "6": 24px
  "8": 32px
components:
  node-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.node-title}"
    rounded: "{rounded.xl}"
    padding: 16px
  badge:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: 4px
  button:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px
x_design:
  art_direction:
    lane: engineering-instrument monochrome (Vercel/v0 register, deliberately chosen against the Grafana-rainbow observability reflex)
    benchmark: Vercel dashboard — deployment details / logs surfaces
    palette_strategy: restrained — pure neutral greys, zero tint; hue reserved for state, never exceeding ~10% of any surface
    anti_reference: not the multi-color observability dashboard; not a generic shadcn admin of same-size cards; not the previous cool-ink amber/blue skin
    signature: the topology map — a monochrome field where the only light is activity (recency as luminance, live edges as motion)
  floors:
    body_min_px: 14
    data_text_min_px: 12
    contrast_min_body: 4.5
    contrast_min_large: 3
    type_scale_ratio_min: 1.25
  stack: dependency-free HTML, CSS, and browser ESM, shipped as one prebuilt static board; the Node daemon remains dependency-free
  fonts: The shipped board uses the local system sans stack (SF Pro on macOS) plus the local system mono stack; no font request or CDN. Geist Pixel remains reserved for timelapse title cards only if it is later vendored with its license.
  theme: dark-first; light theme deferred until tokens are proven
  provenance:
    - knowledge/decisions.md
    - src/board/styles.css (superseded skin)
---

# Aphelion design

## Overview

Aphelion's board is a **local flight instrument, not a dashboard of status cards**. The user is watching an agent work (Operate), scrubbing back through evidence (Operate), or rendering proof to share (Experience). Its primary visual is a directed topology derived from the same trail used by live, replay, and timelapse; the visual treatment can evolve, but the graph contract may not be replaced by a second UI-only model.

The direction is **engineering-instrument monochrome** in the Vercel/v0 register: pure neutral surfaces, local system type, quiet chrome — chosen deliberately against the observability-category reflex (dark panels with a dozen series colors). What keeps it from being a generic shadcn dashboard: **the topology map is the signature element and owns the visual hierarchy.** Everything else recedes to near-invisible chrome so the only spectacle on screen is work happening.

**Light is activity.** On a monochrome field, recency is luminance: a node just touched glows, history cools toward the background, live connections carry moving energy along edges. When nothing is happening the board is calm and grey — that calm is a feature, not a gap to decorate.

Visual hierarchy, in order: session rail (target, live/replay state) → compact playback controls (a conventional linear range control, never a decorative chart) → the topology canvas → the owner-readable current-event summary → the evidence ledger/inspector with paths, hooks, and sequence IDs on demand. The default view answers "what is happening and where is it going?" before any implementation detail.

## Colors

Monochrome baseline: pure neutral OKLCH greys, zero hue tint — no warm papers, no cool inks. Hue exists only as **state**, each with exactly one meaning:

- `live` (emerald) — independently observed effects, confirmed work, active presence. The dominant accent, still ≤10% of any surface.
- `declared` (blue) — the agent's claim: declared intent, in-flight requests, not yet confirmed.
- `attention` (amber) — energy currently moving over a live connection, or work that needs a look.
- `danger` (red) — errors, disconnects, refuted claims.

Declared-vs-observed is legible as blue-vs-emerald before a single label is read. Text labels and icons always accompany signal color. Color never decorates: no gradient fills, no colored panel backgrounds, no colored icons at rest; charts are grey with one accent series. (This supersedes the earlier electric-blue/amber/green mapping.)

## Typography

Two voices, one family:

- **System sans speaks** — titles, node names, owner-readable summaries. Weighted hierarchy (590/600 vs 400), tight leading on headings; headlines stay technical and compact rather than editorial.
- **System mono evidences** — timestamps, durations, sequence numbers, IDs, option names, paths, block names. Anything that is *data from the trail* is mono; anything that *explains* is sans. The split is the typographic expression of declared-vs-observed rigor.

Labels (the only uppercase, the only tracked type) are short mono strings ≥12px. Geist Pixel appears in timelapse title cards only — never in product UI. The current board resolves entirely to installed local fonts; no font CDN or remote request, per local-by-construction.

## Layout

Map-first: the topology canvas is the page; panels dock at the edges and collapse fully. 4px-base spacing, generous padding inside nodes, tight rhythm between data rows. Desktop repository graphs flow by dependency depth; site nouns append from a fixed top-left root. Compact viewports use a vertical directed graph and scroll rather than shrinking labels below readability. No page-level horizontal overflow. Canvas controls stay reachable at 390 CSS pixels.

## Topology contract

The ontology and text contract for the map — what counts as a place, what text a card may carry, how flows and changes render, and the playback grammar — live in `docs/topology-language.md` and are binding. The rules below are the structural summary.

- Nodes are durable nouns, never events. Repository components use PLAN identity; WordPress nodes use stable site identity such as `wp:post:464`, `wp:option:blogdescription`, or `wp:ability:core/get-site-info`.
- Declared intent and independently observed effects resolve onto the same noun. A revisit relights that node and appends evidence, touch counts, and property rows; it never mints a duplicate node for the new request or sequence.
- Presence open, ready, heartbeat, close, timeout, and reconnect are edge state. A channel/target pair owns one reusable edge, even across multiple journeys; bare connection activity with no target creates nothing spatial. Declared work shown as `in flight` is distinct from presence shown as `live`.
- First touch assigns position from the top-left. New nouns append in reading order and existing positions never reshuffle for recency. The map is per-session; clustering and durable cross-session site-map persistence are deferred.
- Repository components use PLAN `needs` for solid dependency edges and `links` for secondary dashed relationships. Dependency depth determines columns.
- Nodes expose visible input and output ports. Direction is carried by small open chevrons on hairline paths; large filled flowchart arrows are prohibited. Color is redundant with labels and state.
- A shared request ID correlates declarations, connections, and effects but never merges MCP, WordPress, hook, sidecar, or WP-CLI connection identity.
- The canvas supports pointer pan, wheel and button zoom, Fit, node focus, and evidence selection.

## Motion and time

Motion represents recorded causality. An in-flight journey relights its existing target node and reusable channel edge with a restrained glow, animated dash, and one energy particle per active target edge. Recorded gaps determine duration; 1200ms is used only when the trail contains no positive measurable gap. Completed edges settle; idle decoration never implies an event, and connection lifecycle never becomes a card.

Replay and timelapse seek through trail time over the same append-stable map. They change node evidence, properties, liveness, and flow without replacing spatial identity. Motion must be seek-safe and must not create an entity or connection absent from the trail. `prefers-reduced-motion` removes nonessential animation while preserving state and direction.

**No harsh jumps — every state change is a continuous transition.** This is inherited deliberately from upstream agenttrail (700ms eased node-position transforms, entry reveals, breathe/travel/pulse keyframes) and survives the board rebuild as a contract:

- **Layout moves glide.** When the map grows or refits, existing nodes animate to their new positions (FLIP or equivalent, ~500–700ms on a decelerating ease); nothing teleports.
- **Nodes are born, not inserted.** A first-touched node reveals in place — scale/fade from its attachment point — while neighbors ease aside.
- **Detail expands, never pops.** Property rows and evidence under a node animate height and fade in sequence; expanded evidence remains scrollable when it exceeds the detail surface; collapse is the same curve reversed. Nodes rarely close — history cools rather than disappears.
- **State changes cross-fade.** Declared→observed, live→settled, glow decay: all interpolate. Binary class-flips that snap a color or border are a defect.
- **Two easing tokens, everywhere.** One standard ease and one decelerating ease, shared by CSS and JS-driven motion; durations from a small scale (fast ~150ms chrome, standard ~300ms detail, slow 500–700ms layout). No per-component bespoke curves.
- **Interruptible by construction.** A scrub or rapid event burst retargets in-flight transitions; motion never queues, lags the trail, or plays catch-up sequences.

## Components

Native dependency-free HTML controls and inline SVG icons are monochrome at rest and state-colored only when carrying evidence. Product components — node card, edge, presence port, scrubber, event ledger row — share the same CSS tokens in the prebuilt board. Playback chrome is compact instrument furniture: it must never compete with the map.

## Do's and Don'ts

- Body text ≥14px; mono data text ≥12px; body contrast ≥4.5:1 (secondary and tertiary included); large text ≥3:1; type-scale steps ≥1.25×.
- No eyebrows/kickers above headings; no helper text restating a heading in smaller grey type — one clear label beats a label plus a subtitle.
- No purple→blue gradients, no gradient text, no glassmorphism, no cream/tinted body backgrounds, no generic SaaS KPI grids.
- No identical same-size card grids; no nested cards; no side-stripe accent borders.
- Horizontal cards pretending to be a journey remain banned — that pattern is what this document exists to prevent.
- No node graph generated from a UI-only record; no pulsing or flowing energy without a live recorded transition.
- Developer-console copy is never the primary explanation; the owner-readable summary leads.
