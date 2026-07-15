# CS-11678 — Broken card / broken file rendering (Option D: move template to boxel-ui)

## Context

BFM refs (`:card[...]` / `:file[...]`) can point to a target that no longer
resolves (deleted, moved, no permission). Today the **chooser preview pane** and
the **Edit modal** can't express that: `tab-panel.gts`'s `loadTarget` collapses
"still loading / nothing picked" and "resolution failed" into the same
`selectedTarget = undefined`, so a broken ref just shows the _"Search for a … &
preview its format here"_ placeholder. The ticket wants these surfaces to render
the same rich broken-ref visual that broken `linksTo`/`linksToMany` field values
use — the reveal overlay with URL, copy button, and error diagnostics.

That visual is `BrokenLinkTemplate`, which today lives in **base**
(`packages/base/default-templates/broken-link-template.gts`) and is only
reachable from host at runtime. Rather than pioneer a runtime component-render in
host, we relocate the component to its architecturally-correct home —
**`@cardstack/boxel-ui`**, the package both base and host already static-import
components from (the template itself imports `@cardstack/boxel-ui/components`).
Then every surface uses a plain static import.

Confirmed scope decisions:

1. **Full parity** with the `linksTo` broken visual (not the light inline box).
2. **Reuse one real component** — relocated to boxel-ui, imported statically.
3. **Affordance = treat the broken ref as a selected card/file** — the Edit
   modal's existing `current`-mode **Remove / Replace** tile is the affordance.
4. **Leave the inline editor render (`rendered-markdown.gts`) as-is.**

## Why boxel-ui (decision rationale, keep for reviewers)

- boxel-ui is the shared-component package both base **and** host consume; the
  template already imports `@cardstack/boxel-ui/components`.
- Its scoped CSS is compiled into the addon and shipped in the **host app
  bundle**, so styles are globally present for both the host chooser render and
  the base `linksTo` renders — **no runtime `.glimmer-scoped.css` injection**.
- The only outside deps are trivially removable (see below) → **no dependency
  cycle** (boxel-ui must not depend on runtime-common; runtime-common→boxel-ui
  already exists).
- Making `typeName` a prop is **required anyway**: base `linksTo` sites are always
  cards (type-name label), but the BFM chooser must also label **files** by
  filename. A caller-supplied `@typeName` serves both.

Rejected alternatives: (A) keep in base + host `loader.import` at runtime — works,
but a novel host render pattern and subtler CSS story; (C) move to runtime-common
— Node-consumed/framework-light package, no component precedent, footgun.

## Decouple the three outside imports (removes the cycle)

In the relocated component:

- `cardTypeName` (value, `runtime-common`) → **drop**; add `@typeName: string`
  arg; `typeName` getter returns `this.args.typeName ?? 'Card'`.
- `SerializedError` (type, `runtime-common`) → local `interface
BrokenLinkErrorDoc` with only the fields read: `status?`, `title?`,
  `message?`, `stack?`, `additionalErrors?: Array<{message?;title?;status?;stack?}> | null`.
  (Base callers pass a `SerializedError`, structurally a superset — assignable.)
- `ViewCardFn` (type, base `../card-api`) → local `type BrokenLinkViewFn = (url:
URL) => void`. Base's `crud.viewCard` stays assignable (its wider first param
  accepts `URL`).

## Change set

### 1. New boxel-ui component

`packages/boxel-ui/addon/src/components/broken-link/index.gts`

- Move the file content verbatim; swap the 3 imports as above; add the
  `@typeName` arg + getter; keep `WarningIcon`, all CSS, overlay/anchor logic.
- Export `BrokenLinkFormat`, `BrokenLinkState`, and the arg types.
  Register in `packages/boxel-ui/addon/src/components.ts`:
  `import BrokenLink from './components/broken-link/index.gts';` and add to the
  export block (alias `BrokenLinkTemplate` for a drop-in name; export the types).

### 2. Base consumers — 5 call sites, behavior identical

`card-api.gts:1601`, `links-to-editor.gts:107`,
`links-to-many-component.gts:301 / 456 / 710`:

- Import `BrokenLinkTemplate` from `@cardstack/boxel-ui/components` (drop the
  `./default-templates/broken-link-template` import). Move the `BrokenLinkFormat`
  type import at `card-api.gts:117` to boxel-ui too.
- Add `@typeName={{cardTypeName <reference>}}` to each site (each already has the
  reference URL; `cardTypeName` is invocable as a strict-mode helper). Value is
  identical to what the component computed internally → **no visual change**.
- `brokenLinkFormat` helper (`card-api.gts:2236`) stays in base; its return type
  now comes from boxel-ui.

### 3. Delete the base template

Remove `packages/base/default-templates/broken-link-template.gts`.

### 4. Host chooser (the actual ticket) — thread the broken state

`tab-panel.gts`:

- Add `@tracked selectedError: CardErrorJSONAPI | undefined`.
- `loadTarget`: clear it up front; on `isCardErrorJSONAPI(result)` keep
  `selectedUrl`, leave `selectedTarget` undefined, set `selectedError`.
- Right panel: mount the pane when `selectedTarget` **or** `selectedError`; keep
  the empty placeholder only when neither.
- Derive & pass down: `brokenUrl` (= `selectedUrl`), `brokenState`
  (`status === 404 ? 'not-found' : 'error'`), `errorDoc` (the `CardErrorJSONAPI`;
  map `meta?.stack` → `stack` — structurally satisfies `BrokenLinkErrorDoc`), and
  `brokenTypeName` (`refType === 'file' ? fileNameFromUrl(url) : cardTypeName(url)`).
- Edit-mode `current` tile already handles broken (label/url fall back to
  `selectedUrl`; Remove/Replace already render).

`pane.gts` (`MarkdownEmbedPreviewPane`): `@target` optional; add `@brokenUrl?`,
`@errorDoc?`, `@brokenState?`, `@brokenTypeName?`; `bfmString` uses
`target?.id ?? brokenUrl`; forward broken args to `MarkdownEmbedPreview`.
Format/size/CTA stay.

`preview/index.gts` (`MarkdownEmbedPreview`): `@target` optional; add the broken
args; `import { BrokenLinkTemplate } from '@cardstack/boxel-ui/components'`
(static). Render: `@target` → existing `<Embed>`; else if `@brokenUrl` →

```
<BrokenLinkTemplate
  @brokenUrl={{@brokenUrl}} @typeName={{@brokenTypeName}}
  @errorDoc={{@errorDoc}} @state={{@brokenState}} @format={{this.renderFormat}} />
```

Format maps 1:1 (`atom|embedded|fitted|isolated`). No `@viewCard` (no "Open
anyway" here, per decision 3). Keep `@showSurroundingText` wrapping.

## Critical files

- New: `packages/boxel-ui/addon/src/components/broken-link/index.gts`; edit
  `packages/boxel-ui/addon/src/components.ts`.
- Base: `packages/base/card-api.gts`, `packages/base/links-to-editor.gts`,
  `packages/base/links-to-many-component.gts`; delete
  `packages/base/default-templates/broken-link-template.gts`.
- Host: `packages/host/app/components/markdown-embed-chooser/{tab-panel,pane,preview/index}.gts`.
- Reuse: `cardTypeName`, `fileNameFromUrl`, `isCardErrorJSONAPI`, `CardErrorJSONAPI`
  from `@cardstack/runtime-common` (subpaths).

## Verification

- **boxel-ui build**: `cd packages/boxel-ui/addon && pnpm start` (watch/rebuild).
- Add a boxel-ui **test-app** test for the moved component
  (`packages/boxel-ui/test-app`, `ember test --path dist --filter "broken"`):
  renders box + `@typeName`; reveal toggle opens the overlay with URL/copy;
  `not-found` vs `error` variants.
- Update `packages/host/tests/integration/components/broken-link-template-test.gts`
  → import from `@cardstack/boxel-ui/components`, pass `@typeName`.
- `linksto-broken-link-placeholder-test.gts` must still pass unchanged (same
  typeName value) — this is the regression guard for the shipped `linksTo` UI.
- Add broken-state cases to the chooser suites: `markdown-embed-preview-test.gts`
  (renders broken template for 404 + error; card vs file `typeName`),
  `markdown-embed-preview-pane-test.gts` (pane surfaces broken; CTA serializes the
  URL), `markdown-embed-chooser-modal-test.gts` (Edit-mode broken preload shows
  broken preview + Remove/Replace, no empty placeholder; choose-mode broken row
  shows broken preview).
- Host run: `pnpm exec ember test --path dist --filter "markdown-embed"` and
  `--filter "broken-link"` (capture to a file per AGENTS.md). Rely on CI for full
  suite. Lint: `pnpm lint` in `packages/host` and `packages/boxel-ui/addon`.
- Optional manual check via Chrome MCP at `https://localhost:4200/tests`.

## Risk / blast radius

Touches the **shipped** `linksTo`/`linksToMany` broken UI (import swap + one added
`@typeName` per call site) and deletes a base file. Every edit is mechanical and
the rendered result is identical (same `typeName` value, same component); the
existing `broken-link-template-test` + `linksto-broken-link-placeholder-test`
guard it. Watch for: strict-mode `cardTypeName` helper invocation in base
templates; the boxel-ui→base type import must be fully removed (no cycle);
`errorDoc` structural compatibility.

## Out of scope

- `rendered-markdown.gts` inline render (decision 4).
- Any "Open anyway"/navigation affordance inside the chooser.
- Behavioral changes to the `linksTo`/`linksToMany` broken UI (visual parity only).

## Process (AGENTS.md Linear flow)

- Ticket already assigned + In Progress.
- Refresh `docs/cs-11678-broken-card-file-rendering-plan.md` from this file
  (the pre-plan-mode copy there predates the boxel-ui decision); delete it before
  merge.
- Branch `cs-11678-broken-card-broken-file-rendering`; post plan as a Linear
  comment; open a **draft** PR (`gh pr create --draft --base main`) via the
  `FadhlanR` gh account. PR touches no `packages/boxel-cli/**`, so a plain
  descriptive title (no conventional-commit prefix).
