import { task } from 'ember-concurrency';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import {
  markdownToHtml,
  preloadMarkdownLanguages,
} from '@cardstack/runtime-common';

import sanitizedHtml from '../helpers/sanitized-html';

function wrapTablesHtml(html: string | null | undefined): string {
  if (!html) return '';
  // Fast path when there are no tables to wrap.
  if (!html.includes('<table')) return html;
  if (typeof DOMParser === 'undefined') return html;

  let doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('table:not(.table-wrapper table)').forEach((table) => {
    if (table.parentElement?.classList.contains('table-wrapper')) return;
    let wrapper = doc.createElement('div');
    wrapper.className = 'table-wrapper';
    table.replaceWith(wrapper);
    wrapper.appendChild(table);
  });
  return doc.body.innerHTML;
}

export default class MarkDownTemplate extends GlimmerComponent<{
  Args: { content: string | null };
}> {
  @tracked _monacoContext: any = undefined;
  get monacoContext() {
    if (!this._monacoContext) {
      this.loadMonacoContextTask.perform();
    }
    return this._monacoContext;
  }
  loadMonacoContextTask = task(async () => {
    let monacoContext = await (window as any).__loadMonacoForMarkdown();
    await preloadMarkdownLanguages(this.args.content ?? '', monacoContext);
    this._monacoContext = monacoContext;
  });
  <template>
    <div class='markdown-content'>
      {{sanitizedHtml
        (wrapTablesHtml
          (markdownToHtml
            @content enableMonacoSyntaxHighlighting=true monaco=this.monacoContext
          )
        )
      }}
    </div>
    <style scoped>
      @layer baseComponent {
        .markdown-content {
          --md-border: var(--border, var(--boxel-border-color));
          --md-muted: var(--muted, var(--boxel-100));
          --vscode-editor-background: var(--boxel-dark);
          --vscode-editorCodeLens-lineHeight: 15px;
          --vscode-editorCodeLens-fontSize: 10px;
          --vscode-editorCodeLens-fontFeatureSettings: 'liga' off, 'calt' off;

          max-width: 100%;
          font-size: var(--markdown-font-size, inherit);
          font-family: var(--markdown-font-family, inherit);
          overflow: hidden;
        }

        /* Heading */
        .markdown-content :deep(h1),
        .markdown-content :deep(h2),
        .markdown-content :deep(h3),
        .markdown-content :deep(h4),
        .markdown-content :deep(h5),
        .markdown-content :deep(h6) {
          font-weight: 600;
          font-family: var(--markdown-heading-font-family, inherit);
        }
        .markdown-content :deep(h1) {
          font-size: 2.5em;
          line-height: 1.25;
          letter-spacing: normal;
          margin-top: var(--boxel-sp-xl);
          margin-bottom: var(--boxel-sp-lg);
        }
        .markdown-content :deep(h2) {
          font-size: 1.625em;
          margin-top: var(--boxel-sp-xxl);
          margin-bottom: var(--boxel-sp-xs);
        }
        .markdown-content :deep(h3) {
          font-size: 1.125em;
          margin-top: var(--boxel-sp-xl);
          margin-bottom: var(--boxel-sp-xxxs);
        }
        .markdown-content :deep(h4) {
          font-size: 1em;
          margin-top: var(--boxel-sp-lg);
          margin-bottom: var(--boxel-sp-xxxs);
        }
        .markdown-content :deep(h5) {
          font-size: 0.8125em;
          margin-top: var(--boxel-sp);
          margin-bottom: var(--boxel-sp-xxxs);
        }
        .markdown-content :deep(h6) {
          font-size: 0.6875em;
          margin-top: var(--boxel-sp-sm);
          margin-bottom: var(--boxel-sp-xxxs);
        }

        /* Paragraph */
        .markdown-content :deep(p) {
          font-family: inherit;
          font-size: inherit;
          font-weight: 400;
          line-height: 1.6;
          margin-top: var(--boxel-sp-lg);
          margin-bottom: var(--boxel-sp);
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
          margin-top: var(--boxel-sp-lg);
          margin-bottom: var(--boxel-sp-lg);
          margin-right: auto;
          margin-left: auto;
          padding-top: var(--boxel-sp-4xs);
          padding-bottom: var(--boxel-sp-4xs);
          border-right: 1px solid black;
          border-left: 1px solid black;
        }
        .markdown-content :deep(blockquote p) {
          font-size: 1.5em;
          font-style: italic;
          margin-inline-start: var(--boxel-sp-xl);
          margin-inline-end: var(--boxel-sp-xl);
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
          font-family: var(--markdown-code-font-family, monospace);
        }

        /* Code Block */
        .markdown-content :deep(pre) {
          white-space: var(--boxel-markdown-field-pre-wrap, pre-wrap);
          background-color: var(--vscode-editor-background);
          border-radius: var(--boxel-border-radius-xl);
          padding: var(--boxel-sp-lg);
        }

        .markdown-content :deep(pre code) {
          background-color: var(--vscode-editor-background);
        }

        /* Link */
        .markdown-content :deep(a),
        .markdown-content :deep(a:hover) {
          color: currentColor;
          text-decoration: underline;
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
          padding-left: 1.375em;
          margin-top: var(--boxel-sp);
          margin-bottom: var(--boxel-sp);
          font-size: inherit;
          font-weight: 400;
          font-family: inherit;
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
      }
    </style>
  </template>
}
