import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import element from '../../helpers/element.ts';

interface Signature {
  Args: {
    ellipsize?: boolean;
    tag?: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

const Label: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |Tag|}}
    <Tag class={{cn 'boxel-label' boxel-ellipsize=@ellipsize}} ...attributes>
      {{yield}}
    </Tag>
  {{/let}}
  <style scoped>
    .boxel-label {
      color: var(--boxel-label-color);
      font: var(--boxel-label-font, 600 var(--boxel-font-sm));
      font-family: inherit;
      letter-spacing: var(--boxel-label-letter-spacing, var(--boxel-lsp-sm));
    }
  </style>
</template>;

export default Label;
