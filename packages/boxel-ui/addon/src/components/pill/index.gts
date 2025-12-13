import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { concat } from '@ember/helper';
import { hash } from '@ember/helper';

import { cn, element, eq } from '../../helpers.ts';
import { getContrastColor } from '../../helpers/contrast-color.ts';
import cssVar from '../../helpers/css-var.ts';

export type BoxelPillKind = 'button' | 'default';

export type BoxelPillVariant =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'accent'
  | 'destructive'
  | 'default';

export const boxelPillVariants = [
  'default',
  'primary',
  'secondary',
  'muted',
  'accent',
  'destructive',
];

export interface PillSignature {
  Args: {
    kind?: BoxelPillKind;
    pillBackgroundColor?: string;
    pillBorderColor?: string;
    pillFontColor?: string;
    tag?: keyof HTMLElementTagNameMap;
    variant?: BoxelPillVariant;
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
      class={{cn
        'pill'
        (if (eq @kind 'button') 'button-pill')
        (if @variant (concat 'variant-' @variant) 'variant-default')
      }}
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
        /* internal properties */
        --pill-padding: var(--boxel-sp-5xs) var(--boxel-sp-xxxs);
        --pill-gap: var(--boxel-sp-5xs);
        --pill-border: 1px solid
          var(--boxel-pill-border-color, var(--pill-border-color));
        --pill-border-radius: var(--boxel-border-radius-sm);

        display: inline-flex;
        align-items: center;
        gap: var(--boxel-pill-gap, var(--pill-gap));
        max-width: 100%;
        padding: var(--boxel-pill-padding, var(--pill-padding));
        background-color: var(
          --boxel-pill-background-color,
          var(--pill-background-color)
        );
        color: var(--boxel-pill-font-color, var(--pill-font-color));
        border: var(--boxel-pill-border, var(--pill-border));
        border-radius: var(
          --boxel-pill-border-radius,
          var(--pill-border-radius)
        );
        font: var(
          --boxel-pill-font,
          var(--pill-font, 700 var(--boxel-font-xs))
        );
        font-family: inherit;
        letter-spacing: var(--boxel-lsp-xs);
        word-break: break-word;
        transition: var(
          --boxel-pill-transition,
          var(--boxel-transition-properties)
        );
      }

      .variant-default {
        --pill-background-color: var(--background, var(--boxel-light));
        --pill-font-color: var(--foreground, var(--boxel-dark));
        --pill-border-color: var(--border, var(--boxel-400));
      }

      .variant-primary {
        --pill-background-color: var(--primary, var(--boxel-highlight));
        --pill-font-color: var(--primary-foreground, var(--boxel-dark));
        --pill-border-color: var(--primary, var(--boxel-highlight));
      }

      .variant-secondary {
        --pill-background-color: var(--secondary, var(--boxel-light));
        --pill-font-color: var(--secondary-foreground, var(--boxel-dark));
        --pill-border-color: var(--secondary, var(--boxel-400));
      }

      .variant-muted {
        --pill-background-color: var(--muted, var(--boxel-200));
        --pill-font-color: var(--muted-foreground, var(--boxel-dark));
        --pill-border-color: var(--muted, var(--boxel-400));
      }

      .variant-accent {
        --pill-background-color: var(--accent, var(--boxel-100));
        --pill-font-color: var(--accent-foreground, var(--boxel-dark));
        --pill-border-color: var(--border, var(--boxel-400));
      }

      .variant-destructive {
        --pill-background-color: var(--destructive, var(--boxel-danger));
        --pill-font-color: var(--destructive-foreground, var(--boxel-light));
        --pill-border-color: var(--destructive, var(--boxel-danger));
      }

      .button-pill.variant-default:not(:disabled):hover,
      .button-pill.variant-primary:not(:disabled):hover,
      .button-pill.variant-destructive:not(:disabled):hover {
        background-color: color-mix(
          in srgb,
          var(--boxel-pill-background-color, var(--pill-background-color)) 90%,
          transparent
        );
      }

      .button-pill.variant-secondary:not(:disabled):hover,
      .button-pill.variant-muted:not(:disabled):hover {
        background-color: color-mix(
          in srgb,
          var(--boxel-pill-background-color, var(--pill-background-color)) 80%,
          transparent
        );
      }

      .button-pill.variant-default:not(:disabled):hover {
        --pill-background-color: var(--background, var(--boxel-100));
      }
      .button-pill.variant-primary:not(:disabled):hover {
        --pill-background-color: var(--primary, var(--boxel-highlight-hover));
        --pill-border-color: var(--pill-background-color);
      }
      .button-pill.variant-secondary:not(:disabled):hover {
        --pill-border-color: var(--secondary, var(--pill-font-color));
      }
      .button-pill.variant-destructive:not(:disabled):hover {
        --pill-background-color: var(--destructive, var(--boxel-danger-hover));
        --pill-border-color: var(--pill-background-color);
      }

      .icon {
        --icon-color: var(--pill-font-color, currentColor);
        flex-shrink: 0;
        display: inline-flex;
        min-width: var(
          --boxel-pill-icon-size,
          var(--pill-icon-size, var(--boxel-icon-xxs))
        );
        margin-block: 0;
        margin-inline: 0;
      }
    }
  </style>
</template>;

export default Pill;
