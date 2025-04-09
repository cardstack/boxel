import { marked } from 'marked';
import { sanitizeHtml } from './dompurify-runtime';
import { escapeHtmlOutsideCodeBlocks } from './helpers/html';

/**
 * Detects if the given text is wrapped in HTML tags
 * @param text The text to check
 * @returns true if the text appears to be wrapped in HTML tags
 */
export function isHtml(text: string): boolean {
  // Check if the text starts with an HTML tag and ends with a closing tag
  const htmlTagPattern = /^<([a-z][a-z0-9]*)\b[^>]*>[\s\S]*<\/\1>$/i;
  return htmlTagPattern.test(text.trim());
}

export function markedSync(markdown: string) {
  return marked
    .use({
      renderer: {
        code(code, language = '') {
          return `<pre data-code-language="${language === ''}">${code}</pre></div>`;
        },
      },
    })
    .parse(escapeHtmlOutsideCodeBlocks(markdown), { async: false }) as string;
}

export function markdownToHtml(
  markdown: string | null | undefined,
  sanitize = true,
): string {
  if (!markdown || isHtml(markdown)) {
    return markdown;
  }
  // Process as Markdown
  return sanitize ? sanitizeHtml(markedSync(markdown)) : markedSync(markdown);
}
