---
name: dev-markdown-format
description: Authoring `static markdown` templates: defaults, markdownEscape, markdown-helpers toolkit, delegation, and pitfalls.
---

# Authoring the `markdown` Format

Boxel has a sixth display format alongside `isolated`, `embedded`, `fitted`, `atom`, and `edit`:

- **`markdown`** — the card (or field, or file) rendered as text in **Boxel Flavored Markdown** (BFM).

This format is what the realm serves under `Accept: text/markdown`, what "Copy as Markdown" puts on the clipboard, what the code-mode markdown preview panel shows, and what gets indexed into the `boxel_index.markdown` column. See the `dev-bfm-syntax` skill for the dialect itself.

## The default — usually good enough

Every `CardDef`, `FieldDef`, and `FileDef` already has a working `markdown` format. The default renders the card's HTML fallback (`isolated` for cards, `embedded` for fields) into a hidden container and converts it to markdown via turndown + GFM.

**Do not define `static markdown` just to have one.** The default handles headings, paragraphs, lists, links, images, tables, and embedded cards (HTML card containers become `:card[…]` / `::card[…]` directives automatically).

Define an explicit `static markdown` only when:

- The HTML fallback produces noisy or misleading output (style leakage, odd layout artifacts)
- The field has a natural non-HTML representation (code files → fenced code blocks, dates → formatted strings, scalar values → bare text)
- You need deterministic output for indexing or downstream consumers
- A stakeholder explicitly wants a specific markdown shape

## Shape of a `static markdown` template

It's a format slot like `static isolated`, but emits **plain text**, not HTML. Glimmer HTML-escapes the string in the DOM; the prerender pipeline decodes those entities when it captures `textContent`, so the markdown parser downstream sees the literal characters you emitted.

```gts
import { CardDef, Component } from 'https://cardstack.com/base/card-api';
import { markdownEscape } from '@cardstack/boxel-ui/helpers';

export class Note extends CardDef {
  static displayName = 'Note';

  static markdown = class Markdown extends Component<typeof this> {
    get text() {
      return markdownEscape(this.args.model?.title ?? '');
    }
    <template>{{this.text}}</template>
  };
}
```

Rules of thumb:

- The template should emit **only text** — no layout elements, no `<style>`, no `{{! comments }}` that leak.
- Return `''` for null/empty — never emit the string `"undefined"` or `"null"`.
- Whitespace is preserved (the render container applies `white-space: pre`), so newlines and indentation you emit survive into the output.

## Essential helper: `markdownEscape`

```gts
import { markdownEscape } from '@cardstack/boxel-ui/helpers';
```

Escapes every CommonMark/GFM metacharacter (`\`, `` ` ``, `*`, `_`, `[`, `]`, `(`, `)`, `<`, `>`, `|`, `~`, `!`, `#`, `+`, `-`) plus line-start numeric list prefixes (`1.` → `1\.`). Null/undefined inputs return `''`; non-string inputs are coerced with `String()`.

**Use it on any user-supplied string** before it lands in markdown output. Skipping it will eventually bite when a user types `*`, `_`, or a leading `1.`.

## The `markdown-helpers` toolkit

Module: `https://cardstack.com/base/markdown-helpers`

```gts
import {
  formatDateForMarkdown,
  formatDateTimeForMarkdown,
  formatDateRangeForMarkdown,
  markdownLink,
  markdownImage,
  fencedCodeBlock,
  markdownLinkForCard,
  markdownLinksForCards,
  markdownEmbedForCard,
  markdownEmbedsForCards,
} from 'https://cardstack.com/base/markdown-helpers';
```

All helpers return pre-escaped strings — safe to interpolate directly.

| Helper                                       | Output                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `formatDateForMarkdown(date)`                | `Mar 5, 2026` (empty for null/invalid)                                             |
| `formatDateTimeForMarkdown(date)`            | `Mar 5, 2026, 3:42 PM`                                                             |
| `formatDateRangeForMarkdown(start, end)`     | `Mar 5, 2026 - Mar 12, 2026`                                                       |
| `markdownLink(text, href)`                   | `[escaped text](encoded-href)` — parens in URL become `%28`/`%29`                  |
| `markdownImage(alt, url)`                    | `![alt](url)`, or `[binary image]` when url is missing                             |
| `fencedCodeBlock(content, language?)`        | Auto-widens the fence past any backtick run in `content`                           |
| `markdownLinkForCard(card, text?)`           | `[title](card.id)` — empty for null card                                           |
| `markdownLinksForCards(cards, { style })`    | `style: 'list'` (default, `- [A](id)` per line) or `'inline'` (`[A](id), [B](id)`) |
| `markdownEmbedForCard(card, { kind, size })` | `:card[id]` / `:card[id \| size]` (inline) or `::card[id]` / `::card[id \| size]` (block, default) |
| `markdownEmbedsForCards(cards, options)`     | Multiple embeds joined by `separator` (default `\n\n` block, `' '` inline)         |

The last four emit BFM card directives — see the `dev-bfm-syntax` skill.

## Delegation composes

Inside a `static markdown` template, `<@fields.x />` recursively renders the child's `markdown` format (not `embedded`/`fitted`). So composition works the same way as any other format:

```gts
static markdown = class Markdown extends Component<typeof this> {
  <template>
    {{! prettier-ignore }}
# {{markdownEscape @model.cardTitle}}

{{#if @model.author}}
By <@fields.author />
{{/if}}

<@fields.body />
  </template>
};
```

**Each `<@fields.x />` invocation emits that child's `markdown` output**, whitespace-preserved.

## Pitfalls

### ATX headings must be on one line

`# Heading` requires the `#` and the text on the same line in the emitted string. Prettier will reformat a multi-line template and break this — protect it:

```gts
static markdown = class Markdown extends Component<typeof this> {
  <template>
    {{!-- prettier-ignore --}}
# {{markdownEscape @model.title}}
  </template>
};
```

### Multi-line text needs hard breaks

A single `\n` between lines collapses into a paragraph. For `TextAreaField`-style content, escape each line and join with CommonMark hard breaks (`  \n`):

```gts
get lines() {
  return (this.args.model ?? '')
    .split('\n')
    .map((line) => markdownEscape(line))
    .join('  \n');
}
```

### Fenced code blocks around arbitrary content

Use `fencedCodeBlock(content, lang)` rather than hand-rolling triple backticks — it widens the fence past any run of backticks inside `content` so the block can't be closed prematurely.

### FileDef code blocks: `static markdownLanguage`

Code-file FileDef subclasses (`TsFileDef`, `GtsFileDef`, `JsonFileDef`, `CsvFileDef`, `TextFileDef`) use a `static markdownLanguage` property to label the fence:

```gts
export class TsFileDef extends FileDef {
  static markdownLanguage = 'ts';
  // ...
  static markdown = class Markdown extends Component<typeof TsFileDef> {
    get text() {
      let content = this.args.model?.content;
      if (!content) return '';
      let ctor = this.args.model?.constructor as typeof TsFileDef | undefined;
      return fencedCodeBlock(
        content,
        ctor?.markdownLanguage ?? TsFileDef.markdownLanguage,
      );
    }
    <template>{{this.text}}</template>
  };
}
```

Override `markdownLanguage` in a subclass to change the language tag (e.g. `GtsFileDef` sets `'gts'`).

### Don't wrap in HTML

No `<div>`, no `<style>`, no `<article>` — the markdown format is text-only. The render container already supplies `white-space: pre`. HTML you emit will be captured as literal characters by `textContent` and pollute the output.

### Subclass overrides win

The format resolver uses bracket-notation lookup, so `static markdown` on a subclass overrides the inherited default (or a parent's explicit template) with no further ceremony.

## Worked example: `Note` card with custom markdown

```gts
import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { markdownEscape } from '@cardstack/boxel-ui/helpers';
import {
  markdownLinkForCard,
  formatDateTimeForMarkdown,
} from 'https://cardstack.com/base/markdown-helpers';
import { Author } from './author';

export class Note extends CardDef {
  static displayName = 'Note';

  @field title = contains(StringField);
  @field body = contains(MarkdownField);
  @field author = linksTo(Author);
  @field publishedAt = contains(DateTimeField);

  static markdown = class Markdown extends Component<typeof this> {
    get header() {
      let title = markdownEscape(this.args.model?.title ?? 'Untitled');
      let byline = this.args.model?.author
        ? `By ${markdownLinkForCard(this.args.model.author)}`
        : '';
      let when = formatDateTimeForMarkdown(this.args.model?.publishedAt);
      let meta = [byline, when].filter(Boolean).join(' · ');
      return meta ? `# ${title}\n\n${meta}` : `# ${title}`;
    }
    <template>
      {{!-- prettier-ignore --}}
      {{this.header}}

      <@fields.body />
    </template>
  };
}
```

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

## When you're done

- Test output by opening the card in code mode and toggling the preview panel to **Markdown → Source**.
- Hit the realm with `Accept: text/markdown` to see the served output.
- Run `"Copy as Markdown"` from the isolated view context menu to verify clipboard output.
- Markdown lives in the `boxel_index.markdown` column after the card re-indexes, so changes propagate once the instance is touched.
