import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';

import { cn, element, eq } from '../../helpers.ts';
import { getContrastColor } from '../../helpers/contrast-color.ts';
import cssVar from '../../helpers/css-var.ts';

export type BoxelPillKind = 'button' | 'default';

export interface PillSignature {
  Args: {
    kind?: BoxelPillKind;
    pillBackgroundColor?: string;
    pillBorderColor?: string;
    pillFontColor?: string;
    tag?: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [];
    iconLeft?: [];
    iconRight?: [];
  };
  Element: HTMLElement;
}

const Pill: TemplateOnlyComponent<PillSignature> = <template>
  {{#let (element (if (eq @kind 'button') 'button' @tag)) as |Tag|}}
    <Tag
      class={{cn 'pill' button-pill=(eq @kind 'button')}}
      style={{cssVar
        pill-background-color=@pillBackgroundColor
        pill-font-color=(if
          @pillFontColor
          @pillFontColor
          (getContrastColor
            @pillBackgroundColor undefined undefined (hash isSmallText=true)
          )
        )
        pill-border-color=@pillBorderColor
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
        --default-pill-font: 600 var(--boxel-font-sm);
        --default-pill-padding: var(--boxel-sp-5xs) var(--boxel-sp-xxxs);
        --default-pill-border: 1px solid
          var(--pill-border-color, var(--boxel-400));
        display: inline-flex;
        align-items: center;
        gap: var(--pill-gap, var(--boxel-sp-5xs));
        padding: var(--pill-padding, var(--default-pill-padding));
        background-color: var(--pill-background-color, var(--boxel-light));
        color: var(--pill-font-color, var(--boxel-dark));
        border: var(--pill-border, var(--default-pill-border));
        border-radius: var(--pill-border-radius, var(--boxel-border-radius-sm));
        font: var(--pill-font, var(--default-pill-font));
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
