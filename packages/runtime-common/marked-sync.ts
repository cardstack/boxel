import { marked } from 'marked';
import { sanitizeHtml } from './dompurify';

export function markedSync(markdown: string) {
  return marked(markdown, { async: false }) as string;
}

export function markdownToHtml(markdown: string | null | undefined): string {
  return markdown ? sanitizeHtml(markedSync(markdown)) : '';
}
