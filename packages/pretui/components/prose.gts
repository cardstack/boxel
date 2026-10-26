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
//
// A surface that needs another voice (MarkdownSurface, for an assistant's
// answer) sets these knobs on an ancestor rather than restyling the markup,
// so there is one set of rules and the two cannot drift apart:
//   --pretui-prose-measure          the whole surface's max width (62ch)
//   --pretui-prose-block-measure    each text block's max width (none)
//   --pretui-prose-leading          body line height (the body role's)
//   --pretui-prose-heading-gap      space under a heading (--boxel-sp-2xs)
//   --pretui-prose-h1-size … -h4-size     heading sizes; h4 also sizes h5, h6
//   --pretui-prose-h1-leading … -h4-leading   heading line heights (1.25)
//   --pretui-prose-h3-tracking, --pretui-prose-h3-case   h3 letter spacing
//                                   and text transform (normal, none)
//   --pretui-prose-code-size        inline code size (0.92em)
//   --pretui-prose-pre-size, --pretui-prose-pre-leading   code blocks
//   --pretui-prose-table-size, --pretui-prose-table-leading   tables
//   --pretui-prose-th-size, -th-leading, -th-tracking, -th-case, -th-ink,
//   -th-align                       table headers
export const Prose: TemplateOnlyComponent<ProseSignature> = <template>
  <div class='pretui-prose' data-test-pretui-prose ...attributes>{{yield}}</div>
  <style scoped>
    @layer PretComponent {
      .pretui-prose {
        max-width: var(--pretui-prose-measure, 62ch);
        line-height: var(
          --pretui-prose-leading,
          var(--boxel-body-line-height)
        );
        overflow-wrap: break-word;
      }
      .pretui-prose :deep(p) {
        margin: 0 0 var(--boxel-sp-sm);
        text-wrap: pretty;
      }
      .pretui-prose
        :deep(:is(p, ul, ol, dl, blockquote, h1, h2, h3, h4, h5, h6)) {
        max-inline-size: var(--pretui-prose-block-measure, none);
      }
      .pretui-prose :deep(code) {
        font-family: var(--font-mono);
        font-size: var(--pretui-prose-code-size, 0.92em);
        background-color: var(--inset);
        padding: var(--boxel-sp-6xs) var(--boxel-sp-3xs);
        border-radius: var(--boxel-border-radius-xs);
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
      }

      /* Headings: a step scale off the body size, tight leading, balanced
         wrap. Real heading styles remove the temptation to fake a heading
         with a bold paragraph, which loses the document's structure. */
      .pretui-prose :deep(:is(h1, h2, h3, h4, h5, h6)) {
        margin: var(--boxel-sp-lg) 0
          var(--pretui-prose-heading-gap, var(--boxel-sp-2xs));
        font-weight: 600;
        letter-spacing: normal;
        text-transform: none;
        text-wrap: balance;
        color: var(--foreground);
      }
      .pretui-prose :deep(h1) {
        font-size: var(--pretui-prose-h1-size, 1.6em);
        line-height: var(--pretui-prose-h1-leading, 1.25);
      }
      .pretui-prose :deep(h2) {
        font-size: var(--pretui-prose-h2-size, 1.35em);
        line-height: var(--pretui-prose-h2-leading, 1.25);
      }
      .pretui-prose :deep(h3) {
        font-size: var(--pretui-prose-h3-size, 1.15em);
        line-height: var(--pretui-prose-h3-leading, 1.25);
        letter-spacing: var(--pretui-prose-h3-tracking, normal);
        text-transform: var(--pretui-prose-h3-case, none);
      }
      .pretui-prose :deep(:is(h4, h5, h6)) {
        font-size: var(--pretui-prose-h4-size, 1em);
        line-height: var(--pretui-prose-h4-leading, 1.25);
      }

      /* Lists on the spacing scale, nested lists without extra gap. */
      .pretui-prose :deep(ul),
      .pretui-prose :deep(ol) {
        margin: 0 0 var(--boxel-sp-sm);
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

      /* Links: the primary hue's ink, which the theme guarantees as text,
         underlined so a link is not told apart by colour alone (WCAG
         1.4.1). */
      .pretui-prose :deep(a) {
        /* a link is words in the sentence: it wraps like them, even where
           a host's reset makes anchors inline-block */
        display: inline;
        color: var(--primary-ink);
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
        border-radius: var(--boxel-border-radius-2xs);
      }

      .pretui-prose :deep(blockquote) {
        margin: 0 0 var(--boxel-sp-sm);
        padding: 0 0 0 var(--boxel-sp-sm);
        box-shadow: inset 2px 0 0 var(--border);
        color: var(--muted-foreground);
      }

      /* Preformatted blocks scroll inside themselves; the page never does. */
      .pretui-prose :deep(pre) {
        margin: 0 0 var(--boxel-sp-sm);
        padding: var(--boxel-sp-2xs) var(--boxel-sp-sm);
        overflow-x: auto;
        border-radius: var(--boxel-border-radius-sm);
        background-color: var(--inset);
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        font-size: var(--pretui-prose-pre-size, 0.9em);
        line-height: var(--pretui-prose-pre-leading, 1.5);
      }
      .pretui-prose :deep(pre code) {
        background-color: transparent;
        padding: 0;
        border-radius: 0;
        box-shadow: none;
        font-size: inherit;
      }

      /* A table wider than the measure scrolls itself rather than the page. */
      .pretui-prose :deep(table) {
        display: block;
        max-width: 100%;
        overflow-x: auto;
        margin: 0 0 var(--boxel-sp-sm);
        border-collapse: collapse;
        font-size: var(--pretui-prose-table-size, 0.94em);
        line-height: var(--pretui-prose-table-leading, inherit);
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
        font-size: var(--pretui-prose-th-size, inherit);
        line-height: var(--pretui-prose-th-leading, inherit);
        font-weight: 600;
        letter-spacing: var(--pretui-prose-th-tracking, normal);
        text-transform: var(--pretui-prose-th-case, none);
        vertical-align: var(--pretui-prose-th-align, top);
        color: var(--pretui-prose-th-ink, var(--foreground));
        box-shadow: inset 0 -1px 0 var(--muted-foreground);
      }

      .pretui-prose :deep(hr) {
        margin: var(--boxel-sp-lg) 0;
        border: 0;
        height: 1px;
        background-color: var(--border);
      }
      .pretui-prose :deep(img) {
        max-width: 100%;
        height: auto;
        border-radius: var(--boxel-border-radius-sm);
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
