import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { initStyleSheet, attachStyles } from '../attach-styles';
import element from '../helpers/element';

interface Signature {
  Element: HTMLElement;
  Args: {
    tag?: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [],
  };
}

let labelStyles = initStyleSheet(`
  .boxel-label {
    color: var(--boxel-label-color);
    font: 700 var(--boxel-font-xs);
    letter-spacing: var(--boxel-lsp-xxl);
    text-transform: uppercase;
  }
`);

const Label: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |Tag|}}
    <Tag class="boxel-label" {{attachStyles labelStyles}} ...attributes>
      {{yield}}
    </Tag>
  {{/let}}
</template>;

export default Label;
