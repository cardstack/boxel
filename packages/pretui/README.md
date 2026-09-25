# Pret UI

Pret UI is a Boxel UI kit: typed Glimmer components with Pret UI's own visual layer on boxel-ui's structural bones.

This directory is both a pnpm workspace package and a realm.

- **Host**: a workspace dependency on `@cardstack/pretui`. `package.json#exports` maps every subpath to its `.gts` source, so `import { Button } from '@cardstack/pretui/components/button'` compiles into the host bundle per file and only imported components ship.
- **Cards**: the same spelling through the realm-server, which serves this directory as the realm `@cardstack/pretui/`. The loader fetches and compiles the source, and the index tracks the dependency so importers reindex when a component changes.

## Layout

Flat, dot-suffixed, one name per component:

```
components/button.gts          the component, its signature, its scoped CSS
components/button.test.gts     the component's tests (run through the host test harness)
components/button.md           the component's write-up
components/button.usage.gts    the component's usage page (knobs + API docs)
components/button.examples.gts the component's example gallery
internal/<module>.gts          helpers shared by several components, not components themselves
pretui-primitives.gts          shared axis types and resolvers
pretui-component.gts           PretUISpec, the kit's Spec card
```

Names are kebab-case, and every component has exactly one module, named after it. Aliases (`Callout`, `PinInput`, …) are one-line modules re-exporting their target. Imports name the file itself: the realm loader resolves file extensions only and has no directory-implies-index fallback, so there are no barrels. A component file reaches the package root with `../`; a sibling component is `./select`.

Spec instances for these components live in the catalog realm, not here.

## Development

```sh
pnpm lint          # ember-template-lint + ember-tsc
```

The kit's remaining components live in the `cardstack/pretui` repo and move here in batches.
