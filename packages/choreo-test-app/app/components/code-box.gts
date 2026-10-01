import type { TOC } from '@ember/component/template-only';
import { highlightSample } from 'test-app/lib/highlight';

interface Signature {
  Args: {
    /** what the snippet is FROM — a filename, or the language for a sketch */
    label?: string;
    source: string;
  };
  Element: HTMLElement;
}

/**
 * The demo page's code box, as a component.
 *
 * Same markup and same `.sample` styling as the usage example under every
 * stage — pulled out so a deep dive can quote four files without four copies
 * of the same three lines, and so a snippet inside prose is visibly the same
 * object as the one above it rather than a second kind of code block.
 */
const CodeBox: TOC<Signature> = <template>
  <section class="sample" aria-label="Code" ...attributes>
    <p class="sample-label">{{if @label @label "Glimmer"}}</p>
    <pre><code>{{highlightSample @source}}</code></pre>
  </section>
</template>;

export default CodeBox;
export { CodeBox };
