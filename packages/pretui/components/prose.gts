// Pretui — Prose: long-form text in the kit reading voice.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

export interface ProseSignature {
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

// The typographic reading surface — styles inline code per Law 3's quieter
// cousin, and every block a markdown render produces: headings, lists, quotes,
// links, tables, preformatted code and rules. The content is markup Prose did
// not render, so every rule reaches it through :deep().
export const Prose: TemplateOnlyComponent<ProseSignature> = <template>
  <div class='pretui-prose' data-test-pretui-prose ...attributes>{{yield}}</div>
  <style scoped>
    @layer PretComponent {
      .pretui-prose {
        max-width: var(--pretui-prose-measure, 62ch);
        line-height: calc(var(--leading-body, 24px) / var(--text-body, 15px));
        overflow-wrap: break-word;
      }
      .pretui-prose :deep(p) {
        margin: 0 0 var(--space-4, 11px);
        text-wrap: pretty;
      }
      .pretui-prose :deep(code) {
        font-family: var(--font-mono);
        font-size: 0.92em;
        background: var(--inset, var(--boxel-100));
        padding: 1px 5px;
        border-radius: 5px;
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
      }

      /* Headings: a step scale off the body size, tight leading, balanced
         wrap. Real heading styles remove the temptation to fake a heading
         with a bold paragraph, which loses the document's structure. */
      .pretui-prose :deep(h1),
      .pretui-prose :deep(h2),
      .pretui-prose :deep(h3),
      .pretui-prose :deep(h4),
      .pretui-prose :deep(h5),
      .pretui-prose :deep(h6) {
        margin: var(--space-6, 22px) 0 var(--space-3, 7px);
        font-weight: 600;
        line-height: 1.25;
        text-wrap: balance;
        color: var(--foreground);
      }
      .pretui-prose :deep(h1) {
        font-size: 1.6em;
      }
      .pretui-prose :deep(h2) {
        font-size: 1.35em;
      }
      .pretui-prose :deep(h3) {
        font-size: 1.15em;
      }
      .pretui-prose :deep(h4),
      .pretui-prose :deep(h5),
      .pretui-prose :deep(h6) {
        font-size: 1em;
      }

      /* Lists on the spacing scale, nested lists without extra gap. */
      .pretui-prose :deep(ul),
      .pretui-prose :deep(ol) {
        margin: 0 0 var(--space-4, 11px);
        padding-inline-start: 1.4em;
      }
      .pretui-prose :deep(li) {
        margin: 0.2em 0;
      }
      .pretui-prose :deep(li > ul),
      .pretui-prose :deep(li > ol) {
        margin-block: 0.2em 0;
      }
      .pretui-prose :deep(li::marker) {
        color: var(--muted-foreground);
      }
      .pretui-prose :deep(li > p) {
        margin: 0;
      }

      /* Links: the theme's own ink, underlined so a link is not told apart by
         colour alone (WCAG 1.4.1). */
      .pretui-prose :deep(a) {
        /* a link is words in the sentence: it wraps like them, even where
           a host's reset makes anchors inline-block */
        display: inline;
        color: var(--pretui-link, var(--primary));
        text-decoration: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 0.18em;
      }
      .pretui-prose :deep(a:hover) {
        text-decoration-thickness: 2px;
      }
      .pretui-prose :deep(a:focus-visible) {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
        border-radius: 2px;
      }

      .pretui-prose :deep(blockquote) {
        margin: 0 0 var(--space-4, 11px);
        padding: 0 0 0 var(--space-4, 11px);
        box-shadow: inset 2px 0 0 var(--border);
        color: var(--muted-foreground);
      }

      /* Preformatted blocks scroll inside themselves; the page never does. */
      .pretui-prose :deep(pre) {
        margin: 0 0 var(--space-4, 11px);
        padding: var(--space-3, 7px) var(--space-4, 11px);
        overflow-x: auto;
        border-radius: 8px;
        background: var(--inset, var(--boxel-100));
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        font-size: 0.9em;
        line-height: 1.5;
      }
      .pretui-prose :deep(pre code) {
        background: none;
        padding: 0;
        box-shadow: none;
        font-size: inherit;
      }

      /* A table wider than the measure scrolls itself rather than the page. */
      .pretui-prose :deep(table) {
        display: block;
        max-width: 100%;
        overflow-x: auto;
        margin: 0 0 var(--space-4, 11px);
        border-collapse: collapse;
        font-size: 0.94em;
        font-variant-numeric: tabular-nums;
      }
      .pretui-prose :deep(th),
      .pretui-prose :deep(td) {
        padding: 0.35em 0.75em;
        text-align: start;
        vertical-align: top;
        box-shadow: inset 0 -1px 0 var(--border);
      }
      .pretui-prose :deep(th) {
        font-weight: 600;
        color: var(--foreground);
        box-shadow: inset 0 -1px 0 var(--muted-foreground);
      }

      .pretui-prose :deep(hr) {
        margin: var(--space-6, 22px) 0;
        border: 0;
        height: 1px;
        background: var(--border);
      }
      .pretui-prose :deep(img) {
        max-width: 100%;
        height: auto;
        border-radius: 6px;
      }

      /* The surface owns its outer edges: no stray margin above the first
         block or below the last. */
      .pretui-prose > :deep(:first-child) {
        margin-block-start: 0;
      }
      .pretui-prose > :deep(:last-child) {
        margin-block-end: 0;
      }
    }
  </style>
</template>;
