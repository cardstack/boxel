import { marked } from 'marked';
import { sanitizeHtml } from './dompurify-runtime';
import { escapeHtml } from './helpers/html';

const DECORATIVE_BULLET_PATTERN =
  /(^|\n)(\s*)([\p{Extended_Pictographic}★•▪●❖✦✧◉◦◾◽⬢⬡☑✔✅☑️➤➔➜➡→▶])(\s+)/gu;

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
  // Marked only treats ASCII list markers, so prefix decorative bullets with a standard marker.
  let normalizedMarkdown = markdown.replace(
    DECORATIVE_BULLET_PATTERN,
    (_match, boundary, indentation, bullet, whitespace) =>
      `${boundary}${indentation}* ${bullet}${whitespace}`,
  );
  let html = markedSync(normalizedMarkdown, {
    escapeHtmlInCodeBlocks: opts.escapeHtmlInCodeBlocks,
  });
  if (opts.sanitize) {
    html = sanitizeHtml(html);
  }
  return html;
}
