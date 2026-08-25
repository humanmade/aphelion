# Security

Aphelion is local observability software. Its server binds to `127.0.0.1`, new trails use
owner-only `0600` permissions, capture boundaries redact common credential fields, and the
package has no runtime dependencies, accounts, or telemetry.

## Data in a trail

Treat trails as operational records. Depending on the observed work, they can contain:

- local filesystem paths and filenames;
- WordPress object IDs, titles, metadata keys, and option names;
- actor login names and roles;
- action summaries, error messages, channels, transports, and timing.

The WordPress observer intentionally excludes post bodies, block text and attribute values,
option and metadata values, request bodies, credentials, authorization headers, and Ability
inputs/results. Redaction is defense in depth, not permission to publish a trail without
reviewing it.

## Local threat model

- The board and ingest API are loopback-only. Do not place them behind a public reverse proxy.
- Anyone able to read the trail files can read the operational context they contain.
- The audit mu-plugin writes only to its site-local JSONL and has no remote transport.
- Aphelion does not authenticate local browser clients; the loopback boundary is part of the
  security model.
- `--wp-command` accepts a JSON string array and is spawned without shell evaluation. Treat the
  configured executable and remote target as trusted local administration infrastructure.
- Standalone timelapse HTML contains a projection of trail evidence. Review it before sharing.

## Supported versions

Security fixes are applied to the latest released minor version. Before the first stable
release, only the newest `0.x` version is supported.

## Reporting a vulnerability

Use the repository's private vulnerability-reporting flow when available. Otherwise contact
the maintainers privately before opening a public issue. Do not attach a real trail, local
paths, credentials, or site data to a public report.

Include the Aphelion version, Node/WordPress/PHP versions, reproduction steps using synthetic
data, the affected surface, and whether exploitation requires an authenticated local user.
