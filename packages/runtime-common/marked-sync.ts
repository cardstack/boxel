import { marked } from 'marked';
import { sanitizeHtml } from './dompurify-runtime';

export function markedSync(markdown: string) {
  return marked
    .use({
      renderer: {
        code(code, language) {
          return `
            <pre class="language-${language}" data-codeblock>${code}</pre>
          `;
        },
      },
    })
    .parse(markdown, { async: false }) as string;
}

export function markdownToHtml(markdown: string | null | undefined): string {
  return markdown ? sanitizeHtml(markedSync(markdown)) : '';
}
