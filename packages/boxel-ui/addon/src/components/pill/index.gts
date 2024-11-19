import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { cn, element, eq } from '../../helpers.ts';
import { getContrastColor } from '../../helpers/contrast-color.ts';
import cssVar from '../../helpers/css-var.ts';

export type BoxelPillKind = 'button' | 'default';

export interface PillSignature {
  Args: {
    kind?: BoxelPillKind;
    pillBackgroundColor?: string;
  };
  Blocks: {
    default: [];
    iconLeft?: [];
    iconRight?: [];
  };
  Element: HTMLButtonElement | HTMLDivElement;
}

const Pill: TemplateOnlyComponent<PillSignature> = <template>
  {{#let (element (if (eq @kind 'button') 'button' 'div')) as |Tag|}}
    <Tag
      class={{cn 'pill' button-pill=(eq @kind 'button')}}
      style={{cssVar
        pill-background-color=@pillBackgroundColor
        pill-font-color=(getContrastColor @pillBackgroundColor)
      }}
      ...attributes
    >
      {{#if (has-block 'iconLeft')}}
        <figure class='icon'>
          {{yield to='iconLeft'}}
        </figure>
      {{/if}}

      {{yield}}

      {{#if (has-block 'iconRight')}}
        <figure class='icon'>
          {{yield to='iconRight'}}
        </figure>
      {{/if}}
    </Tag>
  {{/let}}

  <style scoped>
    @layer {
      .pill {
        display: inline-flex;
        align-items: center;
        gap: var(--pill-gap, var(--boxel-sp-5xs));
        padding: var(--pill-padding, var(--boxel-sp-5xs) var(--boxel-sp-xxxs));
        background-color: var(--pill-background-color, var(--boxel-light));
        color: var(--pill-font-color, var(--boxel-dark));
        border: 1px solid var(--pill-font-color, var(--boxel-400));
        border-radius: var(--boxel-border-radius-sm);
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        word-break: break-word;
      }

      .button-pill:not(:disabled):hover {
        background-color: var(--pill-background-color-hover, var(--boxel-100));
      }

      .icon {
        display: flex;
        margin-block: 0;
        margin-inline: 0;
        --icon-color: var(--pill-font-color, var(--boxel-dark));
      }

      .icon > :deep(*) {
        height: var(--pill-icon-size, 1.25rem);
      }
    }
  </style>
</template>;

export default Pill;
