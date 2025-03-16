import { marked } from 'marked';
import { sanitizeHtml } from './dompurify-runtime';
import { simpleHash } from '.';
import { escapeHtmlTags } from './helpers/html';

const CODEBLOCK_KEY_PREFIX = 'codeblock_';

export function markedSync(markdown: string) {
  return marked
    .use({
      renderer: {
        // If you are relying on codeblocks in your
        // markdown, please use the `CodeBlock` modifier to render the
        // markdown.
        code(code, language = '') {
          let id = `${CODEBLOCK_KEY_PREFIX}${simpleHash(Date.now() + language + code)}`;
          // we pass the code thru using localstorage instead of in the DOM,
          // that way we don't have to worry about escaping code. note that the
          // DOM wants to render "<template>" strings when we put them in the
          // DOM even when wrapped by <pre>. also consider a codeblock that has
          // a "</pre>" string in it.
          //
          // also note that since we are in common, we don't have ember-window-mock
          // available to us.
          globalThis.localStorage?.setItem(id, code);
          return `<pre id="${id}" class="language-${language}" data-codeblock="${language}">${code}</pre></div>`;
        },
      },
    })
    .parse(markdown, { async: false }) as string;
}

export function markdownToHtml(
  markdown: string | null | undefined,
  sanitize = true,
): string {
  let a = markdown
    ? sanitize
      ? sanitizeHtml(markedSync(markdown))
      : markedSync(markdown)
    : '';

  return a;
}
