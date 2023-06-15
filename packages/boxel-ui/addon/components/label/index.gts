import type { TemplateOnlyComponent } from '@ember/component/template-only';
import element from '../../helpers/element';

interface Signature {
  Element: HTMLElement;
  Args: {
    tag?: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [];
  };
}

const Label: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |Tag|}}
    <Tag class='boxel-label' ...attributes>
      {{yield}}
    </Tag>
  {{/let}}
  <style>
    .boxel-label {
      color: var(--boxel-label-color);
      font: 700 var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp-sm);
    }
  </style>
</template>;

export default Label;
