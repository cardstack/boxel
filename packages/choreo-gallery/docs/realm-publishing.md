# Publishing Choreo to a Boxel realm

The realm build packages the public `glimmer-motion` and `@cardstack/choreo`
APIs (plus `Film`) and their Motion engine dependencies into a single
Ember-compatible module. It leaves only the Ember
and Glimmer modules supplied by the Boxel host as external imports.

## Configure a target

Create `.choreo-realm-sync.json` at the repository root. The file is ignored by
Git because the workspace path is machine-specific.

```json
{
  "workspace": "/absolute/path/to/a/boxel/workspace",
  "realmUrl": "https://example.com/my-realm/"
}
```

`realmUrl` may instead come from the workspace's `.boxel-sync.json`. When using
a Boxel CLI checkout rather than an installed `boxel` executable, add its path
as `boxelCliDir`.

## Build and publish

Build glimmer-motion, then choreo, then run one of these commands from
`packages/glimmer-motion`:

```sh
(cd packages/glimmer-motion && pnpm build)
(cd packages/choreo && pnpm build)
cd packages/glimmer-motion
pnpm realm:stage
pnpm realm:local
pnpm realm
```

- `pnpm realm:stage` builds into
  `packages/glimmer-motion/dist-realm/` without touching a workspace.
- `pnpm realm:local` stages the build and mirrors it into the configured
  workspace without contacting the realm.
- `pnpm realm` stages, mirrors, and publishes to the configured realm.

All three commands bundle the existing build output and stop with an error
when either package's `dist/` is missing. The publisher requires an
authenticated `boxel` CLI and writes two files, in this order:

```text
builds/choreo-<hash>.ts
choreo.ts
```

The first file is an immutable, content-addressed build. The second is the
stable entrypoint imported by cards:

```ts
import { Choreo, motion, spring } from '../choreo';
```

Publishing the hashed artifact before the entrypoint prevents `choreo.ts` from
temporarily referring to a build that is not yet present in the realm. A failed
CLI write stops the command with a non-zero exit.

## Roll back

Previous hashed builds remain in `builds/`. To roll back, change `choreo.ts` in
the workspace to export the desired previous build and publish that file:

```ts
export * from './builds/choreo-<previous-hash>';
```

Do not edit a hashed artifact in place. Its filename identifies its contents.
