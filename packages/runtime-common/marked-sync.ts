import { marked } from 'marked';
import { sanitizeHtml } from './dompurify-runtime';
import { escapeHtml } from './helpers/html';

export function markedSync(
  markdown: string,
  opts: { escapeHtmlInCodeBlocks?: boolean } = {
    escapeHtmlInCodeBlocks: true,
  },
): string {
  return marked
    .use({
      renderer: {
        code(code, language = '') {
          if (opts.escapeHtmlInCodeBlocks) {
            return `<pre data-code-language="${language}">${escapeHtml(code)}</pre>`;
          } else {
            return `<pre data-code-language="${language}">${code}</pre>`;
          }
        },
      },
    })
    .parse(markdown, { async: false }) as string;
}

const DEFAULT_OPTS = {
  sanitize: true,
  escapeHtmlInCodeBlocks: true,
};

export function markdownToHtml(
  markdown: string | null | undefined,
  opts: { sanitize?: boolean; escapeHtmlInCodeBlocks?: boolean } = DEFAULT_OPTS,
): string {
  opts = { ...DEFAULT_OPTS, ...opts };
  if (!markdown) {
    return '';
  }
  let html = markedSync(markdown, {
    escapeHtmlInCodeBlocks: opts.escapeHtmlInCodeBlocks,
  });
  if (opts.sanitize) {
    html = sanitizeHtml(html);
  }
  return html;
}
