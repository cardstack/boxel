import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { cn, element, eq } from '../../helpers.ts';

interface Signature {
  Args: {
    ellipsize?: boolean;
    size?: BoxelLabelFontSize;
    tag?: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

export type BoxelLabelFontSize = 'small' | 'default';

const Label: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |Tag|}}
    <Tag
      class={{cn
        'boxel-label'
        boxel-label--small=(eq @size 'small')
        boxel-label--default=(eq @size 'default')
        boxel-ellipsize=@ellipsize
      }}
      ...attributes
    >
      {{yield}}
    </Tag>
  {{/let}}
  <style scoped>
    @layer boxelComponentL1 {
      .boxel-label {
        color: var(--boxel-label-color);
        font-size: var(--boxel-label-font-size, var(--boxel-font-size-sm));
        font-weight: var(--boxel-label-font-weight, 600);
        line-height: var(--boxel-label-line-height, calc(18 / 13));
        font-family: inherit;
        letter-spacing: var(--boxel-label-letter-spacing, var(--boxel-lsp-sm));
      }
      .boxel-label--small {
        font-size: var(
          --boxel-label-font-size-small,
          var(--boxel-font-size-xs)
        );
        line-height: var(--boxel-label-line-height-small, calc(15 / 11));
      }
      .boxel-label--default {
        font-size: var(--boxel-label-font-size, var(--boxel-font-size-sm));
        line-height: var(--boxel-label-line-height, calc(18 / 13));
      }
    }
  </style>
</template>;

export default Label;
