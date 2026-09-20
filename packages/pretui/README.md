# Pret UI

Pret UI is a Boxel UI kit: typed Glimmer components with Pret UI's own visual layer on boxel-ui's structural bones.

This directory is both a pnpm workspace package and a realm.

- **Host** depends on `@cardstack/pretui` as a workspace package. `package.json#exports` maps every subpath to its `.gts` source, so `import { Button } from '@cardstack/pretui/components/button'` compiles into the host bundle per file and only imported components ship.
- **Cards** import the same spelling. The realm-server serves this directory as the realm `@cardstack/pretui/`, the loader fetches and compiles the source, and the index tracks the dependency so importers reindex when a component changes.

## Layout

Flat, dot-suffixed, one name per component:

```
components/button.gts          the component, its signature, its scoped CSS
components/button.test.gts     the component's tests (run through the host test harness)
components/button.md           the component's write-up
pretui-primitives.gts          shared axis types and resolvers
```

Names are kebab-case. No folders: the realm loader resolves file extensions only and has no directory-implies-index fallback. A component file reaches the package root with `../`; a sibling component is `./select`.

Spec cards for these components live in the catalog realm, not here.

## Development

```sh
pnpm lint          # ember-template-lint + ember-tsc
```

The realm is opt-in locally: start the dev stack with `START_PRETUI=1` to have the realm-server serve it. Host consumption does not need the realm running.

The kit's remaining components live in the `cardstack/pretui` repo and move here in batches.
