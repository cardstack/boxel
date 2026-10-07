import type { TOC } from '@ember/component/template-only';

import { highlightSample } from '../lib/highlight';

interface Signature {
  Args: {
    /** what the snippet is FROM — a filename, or the language for a sketch */
    label?: string;
    source: string;
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
      border: 1px solid var(--line);
      border-radius: 18px;
      overflow: hidden;
      /* the same faint light veil as a demo's own stage */
      background: rgba(var(--surface-tint-rgb), 0.03);
    }

    .sample-label {
      margin: 0;
      padding: 10px 16px 0;
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--copper-ink);
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
      color: var(--ink);
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
