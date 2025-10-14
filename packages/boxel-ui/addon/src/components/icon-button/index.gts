import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import { eq } from '../../helpers/truth-helpers.ts';
import LoadingIcon from '../../icons/loading-indicator.gts';
import type { Icon } from '../../icons/types.ts';
import BoxelButton, { type BoxelButtonKind } from '../button/index.gts';

export type BoxelIconButtonSize = 'small' | 'medium' | 'large';
export const boxelIconButtonSizeOptions = ['small', 'medium', 'large'];

export interface Signature {
  Args: {
    class?: string;
    disabled?: boolean;
    height?: string;
    icon?: Icon;
    loading?: boolean;
    round?: boolean;
    variant?: BoxelButtonKind;
    width?: string;
    size?: BoxelIconButtonSize;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

const IconButton: TemplateOnlyComponent<Signature> = <template>
  <BoxelButton
    class={{cn
      'boxel-icon-button'
      is-round=@round
      loading=@loading
      boxel-icon-button--small=(eq @size 'small')
      boxel-icon-button--medium=(eq @size 'medium')
      boxel-icon-button--large=(eq @size 'large')
    }}
    @class={{@class}}
    @kind={{@variant}}
    @size='auto'
    @disabled={{@disabled}}
    aria-label={{if @loading 'loading'}}
    ...attributes
  >
    {{#if @loading}}
      <LoadingIcon
        class='loading-icon'
        width={{if @width @width '14px'}}
        height={{if @height @height '14px'}}
        role='presentation'
        aria-hidden='true'
      />
    {{else if @icon}}
      <@icon
        width={{if @width @width '14px'}}
        height={{if @height @height '14px'}}
        class='svg-icon'
      />
    {{/if}}
    {{yield}}
  </BoxelButton>
  <style scoped>
    @layer boxelComponentL2 {
      .boxel-icon-button {
        --icon-color: var(
          --boxel-icon-button-icon-color,
          var(--boxel-button-text-color, currentColor)
        );
        width: var(--boxel-icon-button-width, var(--boxel-icon-lg));
        height: var(--boxel-icon-button-height, var(--boxel-icon-lg));
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: var(--boxel-icon-button-padding, 0);
        background-color: var(
          --boxel-icon-button-background,
          var(--boxel-button-color)
        );
        border-radius: var(--boxel-border-radius);
        color: var(
          --boxel-icon-button-color,
          var(--boxel-button-text-color, currentColor)
        );
        z-index: 0;
        flex-shrink: 0;
        overflow: hidden;
      }
      .boxel-icon-button--small {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        border-radius: var(--boxel-border-radius-xs);
      }
      .boxel-icon-button--medium {
        width: var(--boxel-icon-med);
        height: var(--boxel-icon-med);
        border-radius: var(--boxel-border-radius-sm);
      }
      .boxel-icon-button--large {
        width: var(--boxel-icon-lg);
        height: var(--boxel-icon-lg);
        border-radius: var(--boxel-border-radius);
      }
      .is-round {
        border-radius: 50%;
      }

      .kind-default {
        background: var(--boxel-icon-button-background, none);
        color: var(--boxel-icon-button-color, inherit);
        border: none;
      }
      .kind-default:disabled {
        color: var(--muted, var(--boxel-400));
      }

      .kind-primary-dark:not(:disabled) {
        --boxel-button-color: var(--primary-foreground, var(--boxel-700));
        --boxel-button-text-color: var(--primary, var(--boxel-highlight));
      }
      .kind-primary-dark:not(:disabled):hover {
        --boxel-button-color: color-mix(
          in oklab,
          var(--primary-foreground, var(--boxel-700)) 85%,
          transparent
        );
      }

      @media (prefers-reduced-motion: no-preference) {
        .loading-icon {
          animation: var(--boxel-infinite-spin-animation);
        }
      }
    }
  </style>
</template>;

export default IconButton;
