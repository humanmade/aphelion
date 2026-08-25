# aphelion

**Live observability for AI agents working on — and inside — WordPress projects.**

aphelion starts where [agenttrail](https://github.com/sodiumsun/agenttrail) stops. agenttrail draws a live map of what a coding agent is doing to a repository: the plan it declared, the files it actually touched, and whether the two agree. aphelion takes that declared-vs-observed model and makes it WordPress-native, in three stages:

1. **WP-aware repo observability.** WordPress code is unusually declarative — `block.json`, `register_rest_route`, `add_action`, `register_post_type` say what things *are*. Derive the component map from those declarations instead of asking the agent to invent one.
2. **Runtime signals.** Half of what an agent does to a WordPress project lands in the database, not files: options, transients, rewrite rules, cron, experiment state. A sidecar (WP-CLI polling + `debug.log` tail) streams those runtime effects onto the same board.
3. **Site-agent observability (the endgame).** Shift the observed object from *repo* to *site*. When an agent optimizes a landing page, launches an A/B test, or edits content, the owner watches a live board of what it declared vs. what it actually did. Trust comes from watching the two agree.

Also on the roadmap: timelapse recording of a session's board, and the same zero-ceremony distribution as upstream — `npx aphelion --open`, no account, no telemetry, localhost only.

## Status

Pre-alpha. Nothing to run yet — see `knowledge/` for the working notes.

## Upstream

`upstream/agenttrail/` is a code snapshot of [sodiumsun/agenttrail](https://github.com/sodiumsun/agenttrail) at commit `41454d4` (2026-08-23), MIT-licensed; its license text is preserved there. Levels 1–2 adapt that code; level 3 is a fresh build that borrows only the conventions. Brand assets and demo media were not vendored.

## License

MIT.
