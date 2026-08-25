# Releasing Aphelion

This repository is prepared through the last reversible step before npm publication. Publication is intentionally not part of local or pull-request verification.

The registry identity is the unscoped package `aphelion`:

```sh
npm install aphelion
```

`humanmade/aphelion` is the GitHub source repository, not the npm package scope.

## Preconditions

- Explicit release authority has been given.
- `npm view aphelion` has been rechecked live immediately before release.
- The version and changelog are approved.
- The human publisher has npm two-factor authentication enabled.
- The release commit is clean, reviewed, and tagged from CI-proven source.

## Predeploy verification

```sh
npm ci
npm run verify
npm pack --dry-run --json --ignore-scripts
npm publish --dry-run --ignore-scripts
```

Confirm the tarball contains only the executable, static board, public screenshot, runtime source, mu-plugin, types, public docs, README, release guide, license, and package metadata. It must not contain trails, tests, working knowledge, the upstream snapshot, credentials, or QA artifacts.

## First publication

The first registry mutation is performed manually by a human with release authority because trusted-publisher settings belong to an existing npm package. From a clean, tagged release commit:

```sh
npm login
npm publish --ignore-scripts
```

The manifest fixes publication to the public npm registry with public access. No development, QA, dry-run, or pull-request command publishes implicitly.

## Trusted publishing after bootstrap

After the package exists, configure its npm trusted publisher with:

- Organization or user: `humanmade`
- Repository: `aphelion`
- Workflow filename: `release.yml`
- GitHub environment: `npm`

Future human-authorized releases run the manual **Publish to npm** workflow and type its confirmation phrase. The workflow uses GitHub OIDC and stores no npm token.

The current GitHub repository is private. Trusted publishing still works, but npm provenance statements require a public source repository. Do not claim provenance until the repository is public and the package's repository URL exactly matches it.

## Post-publication proof

After publication, verify the registry metadata, provenance, install the exact released version into an empty directory on Node 20, run `aphelion --help`, open a local fixture board, and record the result in the release notes.
