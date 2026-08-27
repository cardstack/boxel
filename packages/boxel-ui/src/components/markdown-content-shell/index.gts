import type { TemplateOnlyComponent } from '@ember/component/template-only';

// The styled surface every markdown renderer projects into: a `.markdown-content`
// container carrying the full markdown typography stylesheet and the
// `--markdown-*` styling contract, as scoped CSS so the styles travel with a
// rendering card's captured CSS. The markdown-to-HTML pipeline and the BFM
// card/file slot machinery stay with the caller (the base realm's
// MarkdownTemplate, the host's preview-panel renderer) — they yield the
// rendered HTML into this shell and attach their slot-capture modifier through
// `...attributes`. Slot markup the caller renders via `in-element` lands inside
// this element, which is why the `.markdown-bfm-*` rules reach it with `:deep`.
//
// To customize the typography, set `--markdown-*` custom properties on any
// ancestor — see the styling-contract comment on `.markdown-content` below.
interface Signature {
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

const MarkdownContentShell: TemplateOnlyComponent<Signature> = <template>
  <div class='markdown-content' ...attributes>
    {{yield}}
  </div>
  <style scoped>
    @layer boxelComponentL1 {
      .markdown-content {
        --md-border: var(
          --markdown-border-color,
          var(--border, var(--boxel-border-color))
        );
        --md-muted: var(
          --markdown-muted-background,
          var(--muted, var(--boxel-100))
        );
        --md-mono: var(
          --markdown-code-font-family,
          var(--font-mono, var(--boxel-monospace-font-family))
        );

        /* Overridable styling contract: set `--markdown-*` custom properties
           on any ancestor element to customize the render without reaching in
           with `:deep`. Each rule below reads its public token with the
           default as the var() fallback. Public tokens must stay undeclared on
           this element — a declaration here would shadow the value inheriting
           down from the consumer — so only tokens read in several rules get a
           private `--md-*` consolidation var (these two and the three above). */
        --md-heading-font-weight: var(--markdown-heading-font-weight, 600);
        --md-pre-border: var(--markdown-pre-border, none);

        max-width: 100%;
        font-size: var(--markdown-font-size, inherit);
        font-family: var(--markdown-font-family, inherit);
        line-height: var(--markdown-line-height, inherit);
        overflow: hidden;
      }

      /* Over-limit content notice + truncated plain-text preview */
      .markdown-content :deep(.markdown-oversized-notice) {
        margin: 0 0 var(--boxel-sp-xs);
        font-style: italic;
        color: var(--boxel-500);
      }
      .markdown-content :deep(.markdown-oversized-preview) {
        max-height: 20rem;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--md-mono);
        font-size: 0.8125em;
        background-color: var(--md-muted);
        border: 1px solid var(--md-border);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-xs);
      }

      /* Heading */
      .markdown-content :deep(h1),
      .markdown-content :deep(h2),
      .markdown-content :deep(h3),
      .markdown-content :deep(h4),
      .markdown-content :deep(h5),
      .markdown-content :deep(h6) {
        font-family: var(--markdown-heading-font-family, inherit);
        scroll-margin-top: var(--markdown-heading-scroll-margin, 0);
      }
      .markdown-content :deep(h1) {
        font-size: var(--markdown-h1-font-size, 2.5em);
        font-weight: var(
          --markdown-h1-font-weight,
          var(--md-heading-font-weight)
        );
        line-height: var(--markdown-h1-line-height, 1.25);
        letter-spacing: normal;
        margin-block: var(
          --markdown-h1-margin-block,
          var(--boxel-sp-xl) var(--boxel-sp-lg)
        );
      }
      .markdown-content :deep(h2) {
        font-size: var(--markdown-h2-font-size, 1.625em);
        font-weight: var(
          --markdown-h2-font-weight,
          var(--md-heading-font-weight)
        );
        line-height: var(--markdown-h2-line-height, inherit);
        margin-block: var(
          --markdown-h2-margin-block,
          var(--boxel-sp-2xl) var(--boxel-sp-xs)
        );
      }
      .markdown-content :deep(h3) {
        font-size: var(--markdown-h3-font-size, 1.125em);
        font-weight: var(
          --markdown-h3-font-weight,
          var(--md-heading-font-weight)
        );
        line-height: var(--markdown-h3-line-height, inherit);
        margin-block: var(
          --markdown-h3-margin-block,
          var(--boxel-sp-xl) var(--boxel-sp-3xs)
        );
      }
      .markdown-content :deep(h4) {
        font-size: var(--markdown-h4-font-size, 1em);
        font-weight: var(
          --markdown-h4-font-weight,
          var(--md-heading-font-weight)
        );
        line-height: var(--markdown-h4-line-height, inherit);
        margin-block: var(
          --markdown-h4-margin-block,
          var(--boxel-sp-lg) var(--boxel-sp-3xs)
        );
      }
      .markdown-content :deep(h5) {
        font-size: var(--markdown-h5-font-size, 0.8125em);
        font-weight: var(
          --markdown-h5-font-weight,
          var(--md-heading-font-weight)
        );
        line-height: var(--markdown-h5-line-height, inherit);
        margin-block: var(
          --markdown-h5-margin-block,
          var(--boxel-sp) var(--boxel-sp-3xs)
        );
      }
      .markdown-content :deep(h6) {
        font-size: var(--markdown-h6-font-size, 0.6875em);
        font-weight: var(
          --markdown-h6-font-weight,
          var(--md-heading-font-weight)
        );
        line-height: var(--markdown-h6-line-height, inherit);
        margin-block: var(
          --markdown-h6-margin-block,
          var(--boxel-sp-sm) var(--boxel-sp-3xs)
        );
      }

      /* Paragraph */
      .markdown-content :deep(p) {
        font-family: inherit;
        font-size: inherit;
        font-weight: 400;
        line-height: var(--markdown-p-line-height, 1.6);
        margin-block: var(
          --markdown-p-margin-block,
          var(--boxel-sp-lg) var(--boxel-sp)
        );
      }

      /* Bold */
      .markdown-content :deep(strong),
      .markdown-content :deep(b) {
        font-weight: 700;
      }

      /* Italic */
      .markdown-content :deep(em),
      .markdown-content :deep(i) {
        font-style: italic;
      }

      /* Strikethrough */
      .markdown-content :deep(del),
      .markdown-content :deep(s) {
        text-decoration: line-through;
      }

      /* Highlight */
      /** Must use "<mark>...</mark>" html element **/
      .markdown-content :deep(mark) {
        background-color: var(--boxel-yellow);
      }

      /* Subscript */
      /** Must use <sub> **/

      /* Superscript */
      /** Must use <sup> **/

      /* Blockquote */
      .markdown-content :deep(blockquote) {
        margin-block: var(
          --markdown-blockquote-margin-block,
          var(--boxel-sp-lg)
        );
        margin-inline: auto;
        padding: var(--markdown-blockquote-padding, var(--boxel-sp-4xs) 0);
        border-right: var(--markdown-blockquote-border-right, 1px solid black);
        border-left: var(--markdown-blockquote-border-left, 1px solid black);
        background: var(--markdown-blockquote-background, transparent);
        border-radius: var(--markdown-blockquote-border-radius, 0);
      }
      .markdown-content :deep(blockquote p) {
        font-size: var(--markdown-blockquote-p-font-size, 1.5em);
        font-style: var(--markdown-blockquote-font-style, italic);
        margin-inline: var(
          --markdown-blockquote-p-margin-inline,
          var(--boxel-sp-xl)
        );
      }

      /* GFM Alerts / Admonitions (rendered by marked-alert) */
      .markdown-content :deep(.markdown-alert) {
        border-left: 3px solid var(--markdown-alert-color, var(--boxel-400));
        border-radius: 0 6px 6px 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        margin: var(--boxel-sp-xs) 0;
      }
      .markdown-content :deep(.markdown-alert-title) {
        font-weight: 700;
        color: var(--markdown-alert-color, inherit);
        margin: 0;
      }
      .markdown-content :deep(.markdown-alert-title svg) {
        display: none;
      }
      .markdown-content :deep(.markdown-alert p:not(.markdown-alert-title)) {
        margin: var(--boxel-sp-4xs) 0 0;
      }
      .markdown-content :deep(.markdown-alert-note) {
        --markdown-alert-color: #0969da;
        background-color: #ddf4ff;
      }
      .markdown-content :deep(.markdown-alert-tip) {
        --markdown-alert-color: #1a7f37;
        background-color: #dcfce7;
      }
      .markdown-content :deep(.markdown-alert-important) {
        --markdown-alert-color: #8250df;
        background-color: #f5f0ff;
      }
      .markdown-content :deep(.markdown-alert-warning) {
        --markdown-alert-color: #9a6700;
        background-color: #fff8c5;
      }
      .markdown-content :deep(.markdown-alert-caution) {
        --markdown-alert-color: #d1242f;
        background-color: #ffebe9;
      }

      /* Horizontal rule */
      .markdown-content :deep(hr) {
        border-bottom: none;
        border-right: none;
        border-left: none;
        border-top: var(--boxel-border);
      }

      /* Code */
      .markdown-content :deep(code) {
        font-family: var(--md-mono);
        font-size: var(--markdown-code-font-size, inherit);
        background-color: var(--markdown-code-background, var(--md-muted));
        color: var(--foreground);
        padding: var(--markdown-code-padding, 0);
        border-radius: var(--markdown-code-border-radius, 0);
      }

      /* Code Block */
      .markdown-content :deep(pre) {
        white-space: var(--boxel-markdown-field-pre-wrap, pre-wrap);
        background-color: var(
          --markdown-pre-background,
          var(--vscode-editor-background, var(--md-muted))
        );
        color: var(--vscode-editor-foreground, var(--foreground));
        font-family: var(--md-mono);
        font-size: var(--markdown-pre-font-size, inherit);
        line-height: var(--markdown-pre-line-height, inherit);
        margin-block: var(--markdown-pre-margin-block, 1em);
        border: var(--md-pre-border);
        border-left: var(--markdown-pre-border-left, var(--md-pre-border));
        border-radius: var(
          --markdown-pre-border-radius,
          var(--boxel-border-radius-xl)
        );
        padding: var(--markdown-pre-padding, var(--boxel-sp-lg));
      }

      /* A code run inside a block shows the block's surface, not the inline
           chip's, and keeps doing so when the pre surface is customized. */
      .markdown-content :deep(pre code) {
        background-color: transparent;
        color: inherit;
        font-size: inherit;
        padding: 0;
        border-radius: 0;
      }

      /* Link */
      .markdown-content :deep(a),
      .markdown-content :deep(a:hover) {
        color: var(--markdown-link-color, currentColor);
        text-decoration: var(--markdown-link-text-decoration, underline);
      }

      /* Image */
      .markdown-content :deep(figure, img, svg) {
        max-width: 100%;
      }
      .markdown-content :deep(figure) {
        margin-top: var(--boxel-sp-lg);
        margin-bottom: var(--boxel-sp-lg);
        margin-right: auto;
        margin-left: auto;
      }
      .markdown-content :deep(figcaption) {
        font-size: 0.8125em;
        font-style: italic;
      }
      .markdown-content :deep(img) {
        border-radius: var(--boxel-border-radius-lg);
        overflow: hidden;
      }

      /* Ordered & Unordered List */
      .markdown-content :deep(ol),
      .markdown-content :deep(ul) {
        padding-left: var(--markdown-list-padding-left, 1.375em);
        margin-block: var(--markdown-list-margin-block, var(--boxel-sp));
        font-size: inherit;
        font-weight: 400;
        font-family: inherit;
      }
      .markdown-content :deep(li) {
        margin-block: var(--markdown-li-margin-block, 0);
        line-height: var(--markdown-li-line-height, inherit);
      }
      /* Nested list */
      .markdown-content :deep(ol ol),
      .markdown-content :deep(ol ul),
      .markdown-content :deep(ul ul),
      .markdown-content :deep(ul ol) {
        margin-top: var(--boxel-sp-xxxs);
        margin-bottom: var(--boxel-sp-xxxs);
      }

      /* Task List */
      .markdown-content :deep(ul:has(input[type='checkbox'])) {
        list-style-type: none;
        padding-left: 0;
      }

      /* Definition List */
      /* Must use <dl> <dt> <dd> tags -- default browser styling */

      /* Footnote */
      /* Not available */

      /* Emoji */
      /* Must copy/paste emoji */

      /* Scrollable table wrapper */
      .markdown-content :deep(.table-wrapper) {
        width: 100%;
        max-width: var(--markdown-table-max-width, 56.25rem);
        overflow-x: auto;
        margin-top: var(--boxel-sp-lg);
        margin-bottom: var(--boxel-sp-lg);
        background-color: var(--md-muted);
        border: 1px solid var(--md-border);
        border-radius: var(--boxel-border-radius);
        word-break: initial;
      }
      /* Table */
      .markdown-content :deep(table) {
        width: 100%;
        max-width: 100%; /* Allow full width within scroll container */
        border-radius: 0;
        border-collapse: collapse;
      }
      .markdown-content :deep(thead) {
        border-bottom: 2px solid var(--md-border);
      }
      .markdown-content :deep(th),
      .markdown-content :deep(td) {
        text-align: start;
        padding: var(--boxel-sp-2xs);
      }
      .markdown-content :deep(th:not(:last-child)),
      .markdown-content :deep(td:not(:last-child)) {
        border-right: 1px solid var(--md-border);
      }
      .markdown-content :deep(tr:not(:last-child) td) {
        border-bottom: 1px solid var(--md-border);
      }

      /* Mermaid diagrams */
      .markdown-content :deep(pre.mermaid) {
        background-color: transparent;
        color: inherit;
        text-align: center;
        padding: var(--boxel-sp);
        border-radius: var(--boxel-border-radius-xl);
        overflow-x: auto;
      }

      .markdown-content :deep(pre.mermaid svg) {
        max-width: 100%;
        height: auto;
      }

      /* Mermaid error display */
      .markdown-content :deep(pre.mermaid[data-processed='true'] .error-icon),
      .markdown-content :deep(pre.mermaid #d .error-text) {
        fill: var(--boxel-error-200, #b00020);
      }

      /* BFM references (card, file, etc.) */
      .markdown-content :deep([data-boxel-bfm-inline-ref]) {
        display: inline;
      }

      .markdown-content :deep([data-boxel-bfm-block-ref]) {
        display: block;
        margin: var(--boxel-sp) 0;
      }

      .markdown-content :deep(.markdown-bfm-card-slot) {
        max-width: 100%;
      }

      .markdown-content :deep(.markdown-bfm-card-slot--inline) {
        display: inline-flex;
        vertical-align: middle;
      }

      /* Inline embeds with an explicit non-atom format flow inline-block so a
           sized card sits in the text run without the flex shrink behavior the
           atom pill relies on. */
      .markdown-content :deep(.markdown-bfm-card-slot--inline-embed) {
        display: inline-block;
        vertical-align: middle;
      }

      .markdown-content :deep(.markdown-bfm-card-slot--block) {
        display: block;
      }

      .markdown-content :deep(.markdown-bfm-card-slot--fitted) {
        border-radius: var(--boxel-border-radius);
      }

      /* Placeholder footprint shared by loading + broken states. The
           default block sizes approximate the eventual card so the layout does
           not jump when the card resolves; the slot's shared inline footprint
           (fitted dimensions, inline embedded/isolated defaults, block
           isolated min-height) overrides these when present. */
      .markdown-content :deep(.markdown-bfm-loading--embedded),
      .markdown-content :deep(.markdown-bfm-broken--embedded) {
        width: 100%;
        min-height: 9.375rem;
      }
      .markdown-content :deep(.markdown-bfm-loading--isolated),
      .markdown-content :deep(.markdown-bfm-broken--isolated) {
        width: 100%;
        min-height: 18.75rem;
      }
      .markdown-content :deep(.markdown-bfm-loading--fitted),
      .markdown-content :deep(.markdown-bfm-broken--fitted) {
        width: 15.625rem;
        height: 10.625rem;
      }

      /* Loading shimmer for card refs before content is rendered */
      .markdown-content :deep(.markdown-bfm-loading) {
        position: relative;
        overflow: hidden;
        max-width: 100%;
        background-color: var(--boxel-light-200);
        border-radius: var(--boxel-border-radius);
      }
      .markdown-content :deep(.markdown-bfm-loading--inline) {
        display: inline-block;
        width: 6em;
        height: 1.2em;
        vertical-align: middle;
        border-radius: var(--boxel-border-radius-sm);
      }
      /* Inline embeds with an explicit non-atom format share the block
           footprint classes but flow inline. */
      .markdown-content :deep(.markdown-bfm-loading--inline-embed) {
        display: inline-block;
        max-width: 100%;
        vertical-align: middle;
      }
      .markdown-content :deep(.markdown-bfm-loading--block) {
        display: block;
      }
      .markdown-content :deep(.markdown-bfm-loading::after) {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          transparent,
          var(--boxel-light-100),
          transparent
        );
        transform: translateX(-100%);
        animation: bfm-shimmer 1.6s linear 0.5s infinite;
      }
      @keyframes bfm-shimmer {
        0% {
          transform: translateX(-200%);
        }
        100% {
          transform: translateX(100%);
        }
      }

      /* Broken-link placeholder: a card-sized box with a faint diagonal
           cross and a centered icon + type-name label (no chip). */
      .markdown-content :deep(.markdown-bfm-broken) {
        display: flex;
        align-items: center;
        justify-content: center;
        max-width: 100%;
        border: 1px solid var(--md-border);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light-100);
        background-image:
          linear-gradient(
            to top right,
            transparent calc(50% - 0.5px),
            var(--md-border) calc(50% - 0.5px),
            var(--md-border) calc(50% + 0.5px),
            transparent calc(50% + 0.5px)
          ),
          linear-gradient(
            to bottom right,
            transparent calc(50% - 0.5px),
            var(--md-border) calc(50% - 0.5px),
            var(--md-border) calc(50% + 0.5px),
            transparent calc(50% + 0.5px)
          );
        overflow: hidden;
      }
      .markdown-content :deep(.markdown-bfm-broken--inline) {
        display: inline-flex;
        min-height: 1.6em;
        padding: 0 var(--boxel-sp-5xs);
        vertical-align: middle;
        border-radius: var(--boxel-border-radius-sm);
      }
      /* Inline embeds with an explicit non-atom format share the block
           footprint classes but flow inline. */
      .markdown-content :deep(.markdown-bfm-broken--inline-embed) {
        display: inline-flex;
        vertical-align: middle;
      }
      .markdown-content :deep(.markdown-bfm-broken--block) {
        display: flex;
        margin: var(--boxel-sp-xxxs) 0;
      }
      .markdown-content :deep(.markdown-bfm-broken-label) {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        padding: 0 var(--boxel-sp-4xs);
        /* Match the box fill so the cross does not slice through the text. */
        background-color: var(--boxel-light-100);
        color: var(--boxel-500);
        font-size: 0.75rem;
        font-weight: 500;
        line-height: 1.5;
        white-space: nowrap;
      }
      .markdown-content :deep(.markdown-bfm-broken-label svg) {
        flex: none;
      }
    }
  </style>
</template>;

export default MarkdownContentShell;
