# aphelion

**Live observability for AI agents working on — and inside — WordPress projects.**

One command in any WordPress project opens a local board showing what your agents are doing right now, a trail of everything they did, a replay you can scrub through when something went wrong, and a timelapse you can render and share when something went right. It adapts [agenttrail](https://github.com/sodiumsun/agenttrail)'s declared-vs-observed model and makes it WordPress-native — from repo, to runtime, to the site itself.

The full picture — phases, the trail primitive, design principles, non-goals — lives in [PRODUCT.md](PRODUCT.md).

## Status

Pre-alpha. Nothing to run yet — see [PRODUCT.md](PRODUCT.md) for where this is going and `knowledge/` for working notes.

## Upstream

`upstream/agenttrail/` is a code snapshot of [sodiumsun/agenttrail](https://github.com/sodiumsun/agenttrail) at commit `41454d4` (2026-08-23), MIT-licensed; its license text is preserved there. Levels 1–2 adapt that code; level 3 is a fresh build that borrows only the conventions. Brand assets and demo media were not vendored.

## License

MIT.
