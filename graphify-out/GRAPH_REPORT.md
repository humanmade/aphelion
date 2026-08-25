# Graph Report - .  (2026-08-25)

## Corpus Check
- Corpus is ~11,852 words - fits in a single context window. You may not need a graph.

## Summary
- 263 nodes · 330 edges · 26 communities (13 shown, 13 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Daemon State and Plan|Daemon State and Plan]]
- [[_COMMUNITY_Zero-Dependency Streaming Server|Zero-Dependency Streaming Server]]
- [[_COMMUNITY_Durable Trail Format|Durable Trail Format]]
- [[_COMMUNITY_Aphelion Delivery Map|Aphelion Delivery Map]]
- [[_COMMUNITY_WordPress Observation Surfaces|WordPress Observation Surfaces]]
- [[_COMMUNITY_Agenttrail Product Map|Agenttrail Product Map]]
- [[_COMMUNITY_Product Principles|Product Principles]]
- [[_COMMUNITY_Package Metadata|Package Metadata]]
- [[_COMMUNITY_Live Run UI|Live Run UI]]
- [[_COMMUNITY_Provenance and Declared Evidence|Provenance and Declared Evidence]]
- [[_COMMUNITY_Graph Rendering UI|Graph Rendering UI]]
- [[_COMMUNITY_Hook and Init Integration|Hook and Init Integration]]
- [[_COMMUNITY_Graph Viewport Controls|Graph Viewport Controls]]
- [[_COMMUNITY_Agent Instruction Authority|Agent Instruction Authority]]
- [[_COMMUNITY_Backfill Clipboard Helpers|Backfill Clipboard Helpers]]
- [[_COMMUNITY_Repository Identity|Repository Identity]]
- [[_COMMUNITY_Project Status|Project Status]]
- [[_COMMUNITY_Runtime Requirement|Runtime Requirement]]
- [[_COMMUNITY_Agent Icon Rendering|Agent Icon Rendering]]
- [[_COMMUNITY_Relative Time Utility|Relative Time Utility]]
- [[_COMMUNITY_Pan Completion|Pan Completion]]
- [[_COMMUNITY_Graph Depth Utility|Graph Depth Utility]]
- [[_COMMUNITY_Layout State|Layout State]]
- [[_COMMUNITY_Pan Motion|Pan Motion]]
- [[_COMMUNITY_Connection Error UI|Connection Error UI]]
- [[_COMMUNITY_Pan Start|Pan Start]]

## God Nodes (most connected - your core abstractions)
1. `aphelion flight recorder and live map` - 14 edges
2. `Trail format v0` - 12 edges
3. `renderGraph` - 12 edges
4. `render` - 11 edges
5. `handleHookEvent` - 9 edges
6. `agenttrail local observability layer` - 9 edges
7. `model` - 8 edges
8. `broadcastTick` - 8 edges
9. `The trail` - 8 edges
10. `Ship to GitHub and npm` - 8 edges

## Surprising Connections (you probably didn't know these)
- `listenWithFallback` --conceptually_related_to--> `Graceful degradation`  [INFERRED]
  upstream/agenttrail/bin/agenttrail.mjs → knowledge/agenttrail-assessment.md
- `PLAN.md convention as API` --references--> `parsePlan`  [EXTRACTED]
  knowledge/agenttrail-assessment.md → upstream/agenttrail/bin/agenttrail.mjs
- `parsePlan` --implements--> `Read the plan into a live model`  [INFERRED]
  upstream/agenttrail/bin/agenttrail.mjs → upstream/agenttrail/PLAN.md
- `Arbitrary POST /hook extension point` --references--> `handleHookEvent`  [EXTRACTED]
  knowledge/agenttrail-assessment.md → upstream/agenttrail/bin/agenttrail.mjs
- `handleHookEvent` --implements--> `Receive hook events and track sessions`  [INFERRED]
  upstream/agenttrail/bin/agenttrail.mjs → upstream/agenttrail/PLAN.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Trail projections** — product_trail, product_live_board, product_replay, product_timelapse [EXTRACTED 1.00]
- **WordPress channel observation stream** — docs_observation_surfaces_hook_layer, docs_observation_surfaces_audit_mu_plugin, docs_observation_surfaces_mcp_abilities_api, docs_observation_surfaces_rest_api, docs_observation_surfaces_wp_cli_ssh, docs_observation_surfaces_admin_ui [EXTRACTED 1.00]
- **agenttrail daemon observation pipeline** — upstream_agenttrail_bin_agenttrail_parseplan, upstream_agenttrail_bin_agenttrail_rebuildmatchers, upstream_agenttrail_bin_agenttrail_touchcomponents, upstream_agenttrail_bin_agenttrail_handlehookevent, upstream_agenttrail_bin_agenttrail_model, upstream_agenttrail_bin_agenttrail_broadcasttick [INFERRED 0.85]

## Communities (26 total, 13 thin omitted)

### Community 0 - "Daemon State and Plan"
Cohesion: 0.06
Nodes (41): Linear glob-to-regex component matching, Arbitrary POST /hook extension point, Multi-repo board discovery, Observed-state persistence, PLAN.md convention as API, argv, atDir, boards (+33 more)

### Community 1 - "Zero-Dependency Streaming Server"
Cohesion: 0.10
Nodes (29): Zero-dependency discipline, Graceful degradation, SSE full model and partial activity ticks, Hand-rolled vanilla UI, Zero-dependency daemon, broadcast, broadcastTick, buildTree (+21 more)

### Community 2 - "Durable Trail Format"
Cohesion: 0.09
Nodes (28): Append-only event log per session, Append-only rule, Envelope data field, JSONL event envelope, Envelope kind field, No secrets in payloads, Project target trail storage, Upstream rolling state as derived cache (+20 more)

### Community 3 - "Aphelion Delivery Map"
Cohesion: 0.10
Nodes (21): Typed WordPress component kinds, Show the work live, Serve the live board from trail projections, Trail is product-owned durable JSONL, Watch the repo and the agent, Adapt the agenttrail daemon to emit trail events, Derive the map from WordPress declarations, See the site (+13 more)

### Community 4 - "WordPress Observation Surfaces"
Cohesion: 0.14
Nodes (20): Admin UI surface, Audit mu-plugin, Channel-origin tags, Client-side agent tap, Declared-observed action correlation, Escalating fidelity by install cost, WordPress hook layer observation, Liveness and presence intervals (+12 more)

### Community 5 - "Agenttrail Product Map"
Cohesion: 0.10
Nodes (20): Show the repo like an editor, Draw the live map, Unfold component tasks, Show components and connections, Put the selected logo in the header, Name things for the owner, Read the plan into a live model, Read the plan file (+12 more)

### Community 6 - "Product Principles"
Cohesion: 0.12
Nodes (17): Architecture decisions log, Owner-readable naming, Product principles gate implementation, Adapt agenttrail rather than rewrite, Decision: adapt agenttrail, Decision: free MIT OSS, aphelion flight recorder and live map, aphelion non-goals (+9 more)

### Community 7 - "Package Metadata"
Cohesion: 0.12
Nodes (15): bin, agenttrail, description, engines, node, files, homepage, keywords (+7 more)

### Community 8 - "Live Run UI"
Cohesion: 0.17
Nodes (16): Show run cards and live tool line, agentColor, agentIcon, collapsedGraphNode, esc, expandedGraphNode, graphNode, graphSessionRow (+8 more)

### Community 9 - "Provenance and Declared Evidence"
Cohesion: 0.17
Nodes (13): Upstream provenance travels, Pristine upstream agenttrail snapshot, Declared and observed as distinct events, MIT provenance and vendored snapshot, Declared versus observed work, Declared and observed, always both, agenttrail adaptation, agenttrail npm package (+5 more)

### Community 10 - "Graph Rendering UI"
Cohesion: 0.17
Nodes (13): graphDetailHeight, graphEdge, graphLinkEdge, graphNodeMetrics, graphTaskIsOpen, isSkeletonPlan, renderBadge, renderGraph (+5 more)

### Community 11 - "Hook and Init Integration"
Cohesion: 0.25
Nodes (9): Backfill prompt as WordPress-awareness entry point, Additive idempotent hook install, init, installHooks, safeRead, Watch live runs, Receive hook events and track sessions, Pin runs to components (+1 more)

### Community 12 - "Graph Viewport Controls"
Cohesion: 0.67
Nodes (4): fitGraph, onGraphWheel, updateTransform, zoomBy

## Knowledge Gaps
- **104 isolated node(s):** `__dirname`, `argv`, `repo`, `planPath`, `atDir` (+99 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `renderGraph` connect `Graph Rendering UI` to `Live Run UI`, `Zero-Dependency Streaming Server`, `Durable Trail Format`, `Agenttrail Product Map`?**
  _High betweenness centrality (0.304) - this node is a cross-community bridge._
- **Why does `aphelion flight recorder and live map` connect `Product Principles` to `Provenance and Declared Evidence`, `Durable Trail Format`, `Aphelion Delivery Map`, `WordPress Observation Surfaces`?**
  _High betweenness centrality (0.296) - this node is a cross-community bridge._
- **Why does `render` connect `Zero-Dependency Streaming Server` to `Live Run UI`, `Graph Rendering UI`?**
  _High betweenness centrality (0.248) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `renderGraph` (e.g. with `Live board projection` and `Record once, render many`) actually correct?**
  _`renderGraph` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `__dirname`, `argv`, `repo` to the rest of the system?**
  _129 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Daemon State and Plan` be split into smaller, more focused modules?**
  _Cohesion score 0.06155632984901278 - nodes in this community are weakly interconnected._
- **Should `Zero-Dependency Streaming Server` be split into smaller, more focused modules?**
  _Cohesion score 0.09852216748768473 - nodes in this community are weakly interconnected._