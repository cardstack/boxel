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

Git tracks some files the realm leaves out: `.boxelignore` lists them (the `*.test.gts` files and `scripts/`). The indexer skips what it lists, and the deploy's rsync excludes the same list, so a new kind of non-card file added to the package belongs there. Keep its lines to simple patterns with no `!`, since rsync reads the file as filter rules and a `!` line clears the whole list.

## Cascade layers

Every component's `<style scoped>` content sits in one of two layers, so a caller's unlayered CSS overrides any component without a more specific selector or `:deep()`:

- `@layer PretComponent` for a component that styles only its own elements.
- `@layer PretComposite` for a component that restyles another Pret UI component, whether through `:deep()` or a class it passes onto that component's root. The block starts with `@layer PretComponent, PretComposite;`, so the composite wins by layer order whichever stylesheet loads first.

Rules that restyle a boxel-ui component whose own CSS is unlayered stay outside the layer, since unlayered CSS beats any layer. Select is the one case: BoxelSelect's trigger and option styles are unlayered.

The `Pret` prefix matters because layer names are document-global. Usage pages, example galleries, `pretui-component.gts` and `pretui-note.gts` stay unlayered: they are callers of the kit, and their styles win the way any caller's do.

## Development

```sh
pnpm lint          # ember-template-lint + ember-tsc
```

The kit's remaining components live in the `cardstack/pretui` repo and move here in batches.
