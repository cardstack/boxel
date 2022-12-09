import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { initStyleSheet, attachStyles } from '../attach-styles';

export interface Signature {
  Element: HTMLElement;
  Blocks: {
    default: [],
  };
}

let styles = initStyleSheet(`
  .boxel-label {
    display: grid;
    color: var(--boxel-purple-400);
    font: 600 var(--boxel-font-xs);
    letter-spacing: var(--boxel-lsp-xl);
    text-transform: uppercase;
  }
`);

const Label: TemplateOnlyComponent<Signature> = <template>
  <label
    class="boxel-label"
    {{attachStyles styles}}
    data-test-boxel-label
    ...attributes
  >
    {{yield}}
  </label>
</template>;

export default Label;
