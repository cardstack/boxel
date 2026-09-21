---
name: filedef-authoring
description: How the FileDef family architecture in `packages/base/file-formats/` works and how to render a file's content — the four shared format shells, `static previewComponent` as the family hook, the deliberate wrapped-default decision (file bar + metadata inspector stay), and the exported content-only preview components (`MarkdownPreview` / `ImagePreview` / `AudioPreview`) that render a file's content with no shell chrome. Use when adding or changing a FileDef family (a `.md`/image/audio/video/etc. type), embedding a file's content inside a card or page and wanting the clean render instead of the inspector, reviewing a `@displayContainer={{false}}` + `:deep()` file embed, or touching the file-formats module manifest / format-chooser count in tests. Triggers on editing anything under `packages/base/file-formats/`, a `FileDef` subclass, `static previewComponent`, or a `linksTo(SomeFileDef)` render.
---

# FileDef authoring & content-only rendering

FileDef families (markdown, image, audio, video, code, data, archive, font, 3D, …) live in `packages/base/`, with the shared machinery in `packages/base/file-formats/`. A family is a `FileDef` subclass that adds its `@field`s and **one** renderer; it does not re-implement identity, facts, budgets, or state handling.

## Family architecture

- **Four shared shells** — `FileAtomShell`, `FileEmbeddedShell`, `FileFittedShell`, `FileIsolatedShell` (in `file-formats/`). Every family inherits these from `FileDef` and supplies only the renderer they mount, rather than shipping its own `isolated`/`embedded`/`fitted`/`atom` templates. The shells draw the chrome: the isolated shell's file bar (Download / Copy link) and the GENERAL / PARSER OUTPUT / DERIVED metadata inspector.
- **`FilePreviewStage`** is the slot the shells project into. It owns the concerns every family shares — the current-render cache, loading / failure / staleness panes, provenance, and the generic fallback pane for a family with no renderer.
- **`static previewComponent`** is the family hook. A `FileDef` subclass sets `static previewComponent = XPreview`; `FilePreviewStage` mounts it. `filePreviewComponentFor(instance)` resolves the renderer a file's class declares (read off the instance's constructor, since a `linksTo(FileDef)` is routinely a subclass instance).
- **Pin statics that pre- and post-hydration must agree on.** A prerender omits linked-card CSS, so a value the render depends on (a heading font, a first-child rule) belongs where both passes see it — see the pinning comments in `default-templates/markdown.gts` and the legal-doc masthead.

So a new family = add `@field`s + a `previewComponent`. It should not touch the shells.

## The wrapped-default decision (do not "fix" it)

The default FileDef format templates are **wrapped** by design: the isolated view is the inspector (file bar + metadata groups). Navigating to a `.md` URL landing on that inspector is intentional, not a bug. Do not strip the chrome from the default templates.

Authors who want full control over how a file's **content** renders embed the exported content-only component instead. Both faces are supported; they serve different needs.

## Rendering a file's content only

The content-only renderers — just the file's content, none of the shell chrome — are exported from the `file-formats` barrel:

- Card code (in a realm): `import { MarkdownPreview } from 'https://cardstack.com/base/file-formats/index';`
- Host / base TS: `import { MarkdownPreview } from '@cardstack/base/file-formats/index';`

Which families have a content-only renderer is what the barrel exports — read `file-formats/index.ts` rather than a list here. The rest (`TextPreview`, `CsvPreview`, `JsonPreview`, `CodePreview`, `ArchivePreview`) are module-private; export one from the barrel as call sites need it.

```gts
// A markdown file's prose, no file bar / metadata / Download-Copy-link.
{{#if @model.document}}
  <MarkdownPreview @model={{@model.document}} @format='isolated' @displayContainer={{false}} />
{{/if}}
```

- **`@model`** takes the `FileDef` instance itself (the component projects it through `fileViewModel`) _or_ a prebuilt `FileViewModel` (what the shells pass).
- **`@format`** defaults to `'embedded'` (complete content); `'isolated'` is also complete content; `'fitted'` selects the budgeted snippet a collection cell draws. See `ContentPreviewSignature`.
- **`@displayContainer={{false}}`** is a `MarkdownPreview` option that opts out of its container styles (padding, surface color, scroll) so the embedder owns geometry; `ImagePreview` and `AudioPreview` do not expose this argument.
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

This reaches into shell internals with `:deep()` to hide chrome and un-clamp content. The targeted classes are renderer-internal, not a stable contract, so the CSS breaks silently when the renderer's markup changes — and it duplicates what the content-only components already do. Render `<MarkdownPreview …>` (or `ImagePreview` / `AudioPreview`) directly instead. For worked examples, see `experiments-realm/filedef-fixtures/file-embedding-field-guide.gts` and boxel-home's `LegalDoc`.

A plain wrapped embed with no chrome-fighting (`<@fields.attachments @format='embedded' />`) is fine — the anti-pattern is specifically the `@displayContainer={{false}}` + `:deep()` combination used to simulate a content-only render.

To tune a wrapped embed you cannot pass args to at all — a framework-driven `<@fields.file @format='embedded' />`, which takes no component args — the cross-boundary lever is an inherited custom property, not a selector: markdown reads `--md-preview-background`, `--md-preview-foreground`, and `--md-preview-padding` from any ancestor. The boxel-skills reference `boxel-ui-guidelines/references/delegated-render-control.md` covers the general case (a `class` on the field, the theme cascade, what a child must never decorate).

## Test gotchas

- **Module manifest:** `packages/host/tests/integration/realm-indexing-test.gts` snapshots the dependency graph reachable from `card-api`'s static FileDef-template imports. Update it when that graph changes; adding or removing an export in `file-formats/index.ts` alone does not change this manifest.
- **Format-chooser count:** `fileDefFormats` lives in `packages/runtime-common/formats.ts`; acceptance assertions in `code-submode-test.ts` and `code-submode/inspector-test.ts` count it. Adding a content-only component does **not** change `fileDefFormats` — if you find yourself editing those counts, reconsider.
