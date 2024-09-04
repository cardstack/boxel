import type { TemplateOnlyComponent } from '@ember/component/template-only';

import element from '../../helpers/element.ts';

interface Signature {
  Args: {
    tag?: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

const Label: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |Tag|}}
    <Tag class='boxel-label' ...attributes>
      {{yield}}
    </Tag>
  {{/let}}
  <style>
    .boxel-label {
      --boxel-label-font: 700 var(--boxel-font-sm);
      --boxel-label-letter-spacing: var(--boxel-lsp-sm);

      color: var(--boxel-label-color);
      font: var(--boxel-label-font);
      letter-spacing: var(--boxel-label-letter-spacing);
    }
  </style>
</template>;

export default Label;
