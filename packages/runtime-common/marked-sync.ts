import { marked } from 'marked';
import { sanitizeHtml } from './dompurify-runtime';

// Helper function to escape HTML content
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function markedSync(markdown: string) {
  return marked
    .use({
      renderer: {
        code(code, language = '') {
          return `<pre data-code-language="${language}">${escapeHtml(code)}</pre>`;
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
