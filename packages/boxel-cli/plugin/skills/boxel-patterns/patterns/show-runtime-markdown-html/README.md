---
validated: source-proven
---

# show-runtime-markdown-html — Render BFM/markdown to HTML at runtime in a template

**What this gives you:** A template that takes a markdown string (BFM, GFM, CommonMark) and renders it as HTML inside an `isolated` or `embedded` view, with sanitization, code highlighting, mermaid, math, and card-embed directives all working.

**When to use:** Long-form content cards (blog posts, docs, reports) that store markdown in a `MarkdownField` and need to render it richly. Or runtime-formatted help text where the source is markdown but the display is HTML.

**The insight:** Boxel ships a runtime markdown component (`@cardstack/boxel-ui/components` → `MarkdownComponent`, or via `MarkdownField`'s default render). Pass the markdown string + a few options and you get safe HTML out. The `static markdown` template (covered by `boxel-markdown-format` skill) is for *emitting* markdown; this pattern is for the inverse — *rendering* markdown to HTML.

**Recipe shape:**

```ts
import { Component } from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';

class BlogPost extends CardDef {
  @field title = contains(StringField);
  @field body  = contains(MarkdownField);

  static isolated = class extends Component<typeof BlogPost> {
    <template>
      <article>
        <h1>{{@model.title}}</h1>
        {{!--
          MarkdownField provides its own render via @fields delegation.
          The default output is rendered HTML — no extra wiring needed.
        --}}
        <@fields.body />
      </article>
    </template>
  };
}
```

For finer control (custom renderers, inline rendering, embedded BFM):

```hbs
{{!-- Render an arbitrary markdown string via the markdown helper --}}
{{markdown @model.markdownString}}
```

**BFM features that work out of the box:**
- `:card[<url>]` and `::card[<url>]` directives — inline and block card embeds.
- ` ```mermaid ` fenced diagrams.
- `$...$` and `$$...$$` LaTeX math (KaTeX).
- `> [!NOTE]` / `> [!WARNING]` / etc. GFM alerts.
- Footnotes, GFM tables, heading IDs.
- Monaco-powered code highlighting in ` ```language ` blocks.
- See `boxel-flavored-markdown/SKILL.md` for the full dialect.

**Gotchas:**
- **Don't sanitize HTML inside markdown text.** The renderer already handles XSS. Double-sanitizing strips legitimate emphasis/links.
- **Card-embed directives need realm-accessible URLs.** A `:card[https://...]` will only render if the realm can resolve the card.
- **Mermaid + math add bundle weight.** They lazy-load on first use; first render of a card containing them takes longer.
- **Edit format is separate.** This pattern is for `isolated`/`embedded`. For editing markdown, MarkdownField's edit template provides a textarea + live preview by default.

**Source:** `boxel-catalog/blog-app/blog-post.gts` (long-form post with BFM body), `boxel-catalog/system-card/model-configuration.gts` (markdown description fields). The base implementation is in `@cardstack/boxel-ui` and `https://cardstack.com/base/markdown`.

**See also:** `boxel-flavored-markdown` (the dialect), `boxel-markdown-format` (the inverse — emitting markdown from cards), `boxel/references/template-syntax.md` (the `<@fields.body />` delegation rule).
