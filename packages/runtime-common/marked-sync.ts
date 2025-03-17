import { marked } from 'marked';
import { sanitizeHtml } from './dompurify-runtime';

export function markedSync(markdown: string) {
  return marked
    .use({
      renderer: {
        code(code, language = '') {
          return `<pre class="language-${language}" data-codeblock="${language}">${code}</pre></div>`;
        },
      },
    })
    .parse(markdown, { async: false }) as string;
}

export function markdownToHtml(
  markdown: string | null | undefined,
  sanitize = true,
): string {
  return markdown
    ? sanitize
      ? sanitizeHtml(markedSync(markdown))
      : markedSync(markdown)
    : '';
}
