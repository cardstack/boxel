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
        font-size: var(--boxel-label-font-size, var(--boxel-body-font-size));
        font-weight: var(--boxel-label-font-weight, 500);
        line-height: var(
          --boxel-label-line-height,
          var(--boxel-body-line-height)
        );
        font-family: inherit;
        letter-spacing: var(--boxel-label-letter-spacing, var(--boxel-lsp-sm));
      }
      .boxel-label--small {
        font-size: var(
          --boxel-label-font-size-small,
          var(--boxel-caption-font-size)
        );
        line-height: var(
          --boxel-label-line-height-small,
          var(--boxel-caption-line-height)
        );
      }
      .boxel-label--default {
        font-size: var(--boxel-label-font-size, var(--boxel-body-font-size));
        line-height: var(
          --boxel-label-line-height,
          var(--boxel-body-line-height)
        );
      }
    }
  </style>
</template>;

export default Label;
