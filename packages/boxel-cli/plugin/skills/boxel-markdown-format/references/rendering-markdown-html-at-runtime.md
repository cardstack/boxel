## Rendering markdown → HTML at runtime

If your card has a markdown field and you need to render it as HTML in a _non-markdown_ format (e.g. an `isolated` template that shows the body as styled HTML), the `MarkdownField`'s default `embedded` template already handles that. Use `<@fields.body />` and let the field render itself.

Reach for the runtime helper only when you need the HTML string directly — for diffing, plain-text extraction, custom downstream processing, etc.:

```gts
import { markdownToHtml } from '@cardstack/runtime-common/marked-sync';
//                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                          subpath, NOT '@cardstack/runtime-common'

let html = markdownToHtml(rawSource, {
  preprocessKatex: true, // or false depending on your need
});
```

**Critical: import from the subpath `@cardstack/runtime-common/marked-sync`, not the bare `@cardstack/runtime-common`.** The `marked-sync` module is registered as a separate (lazy-loaded) shim so the markdown parser + DOMPurify + extensions don't get pulled into the eager host bundle for cards that don't render markdown. The bare `@cardstack/runtime-common` does **not** re-export `markdownToHtml` or `preloadMarkdownLanguages`.

If you import from the wrong path, the runtime catches the mismatch at module-load time and surfaces a tight `ReferenceError` naming both the missing export and the source module:

```
ReferenceError: Module '@cardstack/runtime-common' has no exported
member 'markdownToHtml'. If this is a card, check the import
statement that names 'markdownToHtml' — you may be importing from
the wrong module ID.
```

(In standard ESM, a named-import mismatch like this would already fail at module-link time. Cardstack's realm loader uses an AMD-style transform under the hood, which historically turned missing-export mismatches into silent `undefined` bindings that failed later with confusing downstream errors. The current runtime restores the link-time-error behavior for shimmed modules — so wrong imports surface immediately, with the actionable message above.)

Other helpers that live on the same `marked-sync` subpath (also import from there, not the bare module):

- `markdownToHtml(content, options)` — the main renderer; sanitises by default
- `preloadMarkdownLanguages(langs)` — pre-loads syntax highlighters for fenced code blocks
- `wrapTablesHtml(html)` — adds responsive wrappers around `<table>` (use after `markdownToHtml` if needed)
