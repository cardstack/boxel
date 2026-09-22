---
name: filedef-authoring
description: How the FileDef family architecture in `packages/base/file-formats/` works and how to render a file's content — the four shared format shells, `static previewComponent` as the (optional) family hook, the deliberate wrapped-default decision (file bar + metadata inspector stay), and the exported content-only preview components (`MarkdownPreview` / `ImagePreview` / `AudioPreview`) that render a file's content with no shell chrome. Use when adding or changing a FileDef family (a `.md`/image/audio/video/etc. type), embedding a file's content inside a card or page and wanting the clean render instead of the inspector, reviewing a `@displayContainer={{false}}` + `:deep()` file embed, or touching the file-formats module manifest / format-chooser count in tests. Triggers on editing anything under `packages/base/file-formats/`, a `FileDef` subclass, `static previewComponent`, or a `linksTo(SomeFileDef)` render.
---

# FileDef authoring & content-only rendering

FileDef families (markdown, image, audio, video, code, data, archive, font, 3D, …) live in `packages/base/`, with the shared machinery in `packages/base/file-formats/`. A family is a `FileDef` subclass that adds its `@field`s and, when a custom render beats the fallback, one renderer; it does not re-implement identity, facts, budgets, or state handling.

## Family architecture

- **Four shared shells** — `FileAtomShell`, `FileEmbeddedShell`, `FileFittedShell`, `FileIsolatedShell` (in `file-formats/`). Every family inherits these from `FileDef` and supplies only the renderer they mount, rather than shipping its own `isolated`/`embedded`/`fitted`/`atom` templates. The shells draw the chrome: the isolated shell's file bar (Download / Copy link) and the GENERAL / PARSER OUTPUT / DERIVED metadata inspector, which is also where a file's provenance is shown.
- **`FilePreviewStage`** is the slot the shells project into. It owns the render concerns every family shares — the current-render cache, the loading / failure / staleness panes, and the generic fallback pane for a family with no renderer. Provenance is **not** a stage concern: the stage deliberately floats no provenance overlay (it would land on whatever the family draws in that corner) and leaves it to the isolated shell's metadata chrome.
- **`static previewComponent`** is the family hook, and it is **optional**. A `FileDef` subclass may set `static previewComponent = XPreview` and `FilePreviewStage` mounts it; a family that declares none falls through to the generic fallback pane. `filePreviewComponentFor(instance)` resolves the renderer a file's class declares (read off the instance's constructor, since a `linksTo(FileDef)` is routinely a subclass instance).

So a new family = add `@field`s, plus a `previewComponent` only when a custom render beats the fallback. It should not touch the shells.

## The wrapped-default decision (do not "fix" it)

The default FileDef format templates are **wrapped** by design: the isolated view is the inspector (file bar + metadata groups). Navigating to a `.md` URL landing on that inspector is intentional, not a bug. Do not strip the chrome from the default templates.

Authors who want full control over how a file's **content** renders embed the exported content-only component instead. Both faces are supported; they serve different needs.

## Rendering a file's content only

The content-only renderers — just the file's content, none of the shell chrome — are exported from the `file-formats` barrel. Which families have one is exactly what the barrel exports, so read `packages/base/file-formats/index.ts` rather than trusting a list here.

Import them by context:

- Card code (in a realm): `import { MarkdownPreview } from 'https://cardstack.com/base/file-formats/index';`
- Host / base TS: the base-realm value is only available at runtime through the loader — import the **type** statically and load the value:

  ```ts
  import type * as FileFormats from '@cardstack/base/file-formats/index';

  let { MarkdownPreview } = await loader.import<typeof FileFormats>(
    `${baseRealm.url}file-formats/index`,
  );
  ```

  A static value `import { MarkdownPreview } from '@cardstack/base/…'` in host code can trip the host build's missing-module failure; `@cardstack/base/*` is a types-only static import there.

The other family renderers — `TextPreview`, `CsvPreview`, `JsonPreview`, `CodePreview`, `ArchivePreview` — are **not** content-only and are **not** barrel-exported: each lives beside its `FileDef` subclass in `packages/base/<kind>-file-def.gts`, is typed on `FilePreviewSignature`, and reads an already-projected view model straight off `@model`. To give one a content-only face, do not just re-export it from the barrel — that pulls a whole card module into every embedder, and a caller following the `@model` bullet below (passing a bare instance) renders "No content". Move it into `file-formats/`, re-type it on `ContentPreviewSignature`, and have it project through `ensureFileViewModel`.

```gts
// A markdown file's prose, no file bar / metadata / Download-Copy-link.
{{#if @model.document}}
  <MarkdownPreview @model={{@model.document}} @format='isolated' @displayContainer={{false}} />
{{/if}}
```

- **`@model`** takes the `FileDef` instance itself (the component projects it through `fileViewModel`) _or_ a prebuilt `FileViewModel` (what the shells pass).
- **`@format`** defaults to `'embedded'` (complete content); `'isolated'` is also complete content; `'fitted'` selects the budgeted snippet a collection cell draws. See `ContentPreviewSignature`.
- **`@displayContainer={{false}}`** is a `MarkdownPreview`-only argument — not part of `ContentPreviewSignature`. It drops that component's own `md-preview` / `md-preview--full` styles (padding, surface color, scroll) so the embedder owns geometry; `ImagePreview` and `AudioPreview` do not expose it. Do not confuse it with the same-named field-level `@displayContainer` in the anti-pattern below: that is a different argument that toggles the host card container and never reaches this renderer.
- **Loading / failure / staleness is the embedder's job** here — those panes are `FilePreviewStage`'s only inside the shells.
- **Kind-dispatch:** `filePreviewComponentFor(file)` returns the right renderer; pass it `ensureFileViewModel(file, format)` as `@model` (only the content-only components project a bare instance themselves).
- **Format ↔ `@format` invariant:** a prebuilt `FileViewModel` must have been projected at the same format you pass as `@format`, because the fitted budgets are applied at projection time — a complete-content projection rendered at `'fitted'` would feed the whole file to the snippet branch. If you vary the format, pass the instance and let the component re-project.

## The anti-pattern — do not use it

Do **not** render a FileDef field through the shell and then fight the chrome:

```gts
{{! ANTI-PATTERN — do not do this }}
<@fields.file @format='embedded' @displayContainer={{false}} />
<style scoped>
  :deep(.markdown-embedded__title) { display: none; }      /* hiding shell chrome */
  :deep(.markdown-embedded__content) { max-height: none; } /* un-clamping the budget */
</style>
```

This reaches into shell internals with `:deep()` to hide chrome and un-clamp content — duplicating what the content-only components already do. The classes above are not even what `MarkdownPreview` emits (it renders `md-preview` / `md-preview--full` / `md-preview--fitted`); `markdown-embedded__*` survives only in `:deep()` consumers like the field guide, so those selectors match nothing and the "fix" silently does nothing. Render `<MarkdownPreview …>` (or `ImagePreview` / `AudioPreview`) directly instead. The in-tree consumer to model on is `packages/host/tests/integration/components/content-preview-components-test.gts`; `packages/experiments-realm/filedef-fixtures/file-embedding-field-guide.gts` **is** this exact anti-pattern (its isolated template renders the embed above and its scoped CSS holds these `:deep()` rules), not a worked example to copy.

A plain wrapped embed with no chrome-fighting (`<@fields.attachments @format='embedded' />`) is fine — the anti-pattern is specifically the `@displayContainer={{false}}` + `:deep()` combination used to simulate a content-only render.

A wrapped embed *does* take component args: `<@fields.file @format='embedded' @displayContainer={{false}} />` passes `BoxComponentSignature`'s `@displayContainer` (`packages/base/field-component.gts`), which `LinksToComponent` in `card-api.gts` threads into the field component as `CardContainer @displayBoundaries={{false}}` (plus a `display-container-false` class). But that toggles the **host card container**; it never reaches the renderer's own padding or surface. When the renderer's surface is what you need to tune, the cross-boundary lever is an inherited custom property, not a selector: markdown reads `--md-preview-background`, `--md-preview-foreground`, and `--md-preview-padding` from any ancestor. `packages/boxel-cli/plugin/skills/boxel-ui-guidelines/references/delegated-render-control.md` covers the general case (a `class` on the field, the theme cascade, what a child must never decorate).

## Test gotchas

- **Module manifest:** `packages/host/tests/integration/realm-indexing-test.gts` snapshots the dependency graph reachable from `card-api`'s static FileDef-template imports. Update it when that graph changes; adding or removing an export in `file-formats/index.ts` alone does not change this manifest.
- **Format-chooser count:** `fileDefFormats` lives in `packages/runtime-common/formats.ts`; acceptance assertions in `code-submode-test.ts` and `code-submode/inspector-test.ts` count it. Adding a content-only component does **not** change `fileDefFormats` — if you find yourself editing those counts, reconsider.
