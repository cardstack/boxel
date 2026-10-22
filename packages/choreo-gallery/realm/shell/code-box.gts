import type { TOC } from '@ember/component/template-only';

import { highlightSample } from '../lib/highlight';

interface Signature {
  Args: {
    /** what the snippet is FROM — a filename, or the language for a sketch */
    label?: string;
    source: string | null | undefined;
  };
  Element: HTMLElement;
}

/**
 * The gallery's code box: a label over a highlighted, copyable snippet.
 *
 * One component, so the usage example under every stage, a walkthrough step
 * and a snippet quoted in a demo's notes are visibly the same object rather
 * than three kinds of code block.
 */
export const CodeBox: TOC<Signature> = <template>
  <section class='sample' aria-label='Code' ...attributes>
    <p class='sample-label'>{{if @label @label 'Glimmer'}}</p>
    <pre><code>{{highlightSample @source}}</code></pre>
  </section>
  <style scoped>
    .sample {
      margin-top: 22px;
      border: 1px solid var(--border);
      border-radius: 18px;
      overflow: hidden;
      /* the same faint light veil as a demo's own stage */
      background: color-mix(in srgb, var(--surface-tint) 3%, transparent);
    }

    .sample-label {
      margin: 0;
      padding: 10px 16px 0;
      font-family: var(--boxel-eyebrow-font-family);
      font-weight: var(--boxel-eyebrow-font-weight);
      font-size: calc(var(--boxel-eyebrow-font-size) * 10 / 11);
      letter-spacing: calc(var(--boxel-eyebrow-letter-spacing) * 14 / 18);
      text-transform: uppercase;
      color: var(--primary-ink);
    }

    pre {
      margin: 0;
      padding: 12px 16px 16px;
      overflow-x: auto;
    }

    code {
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.55;
      color: var(--foreground);
      white-space: pre;
      -webkit-user-select: text;
      user-select: text;
    }

    @media (max-width: 720px) {
      code {
        font-size: 11px;
      }
    }
  </style>
</template>;

export default CodeBox;
