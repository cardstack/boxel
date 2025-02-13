import { marked } from 'marked';
import { sanitizeHtml } from './dompurify-runtime';

interface Options {
  includeCodeCopyButton?: true;
}

export function markedSync(markdown: string, opts?: Options) {
  return marked
    .use({
      renderer: {
        code(code, language) {
          let html: string[] = [];
          if (opts?.includeCodeCopyButton) {
            html.push(`
              <button class="code-copy-button">
                <svg
                  xmlns='http://www.w3.org/2000/svg'
                  width='16'
                  height='16'
                  fill='none'
                  stroke='currentColor'
                  stroke-linecap='round'
                  stroke-linejoin='round'
                  stroke-width='3'
                  class='lucide lucide-copy'
                  viewBox='0 0 24 24'
                  role='presentation'
                  aria-hidden='true'
                  ...attributes
                ><rect width='14' height='14' x='8' y='8' rx='2' ry='2' /><path
                    d='M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'
                  />
                </svg>
                <span class="copy-text">Copy to clipboard</span>
              </button>`);
          }
          html.push(
            `<pre class="language-${language}" data-codeblock>${code}</pre>`,
          );
          return html.join('\n');
        },
      },
    })
    .parse(markdown, { async: false }) as string;
}

export function markdownToHtml(
  markdown: string | null | undefined,
  opts?: Options,
): string {
  return markdown ? sanitizeHtml(markedSync(markdown, opts)) : '';
}
