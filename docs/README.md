# Aphelion documentation

Start with the root [README](../README.md) for the product, quickstart, CLI, and WordPress
setup. The documents here cover the contracts and operational paths that are too detailed
for the front page.

| Document | Use it when… |
| --- | --- |
| [Running in the background](background-service.md) | You want one opt-in Aphelion service to start at login and survive terminal sessions. |
| [WordPress observation surfaces](observation-surfaces.md) | You are connecting wp-admin, REST, WP-CLI, MCP, Abilities, or a plugin adapter. |
| [Trail format v1](trail-format.md) | You are producing, consuming, migrating, or validating trail events. |
| [Security](../SECURITY.md) | You are evaluating local exposure, trail sensitivity, or reporting a vulnerability. |
| [Release process](../RELEASING.md) | You are preparing or verifying an npm release. |
| [Changelog](../CHANGELOG.md) | You need the release history. |

Aphelion has one architectural constraint across every document: the append-only trail is
the record. Live, replay, timelapse, adapters, and future surfaces are projections of it.
