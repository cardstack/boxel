import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import LoadingIcon from '../../icons/loading-indicator.gts';
import type { Icon } from '../../icons/types.ts';
import BoxelButton, { type BoxelButtonKind } from '../button/index.gts';

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
  };
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

const IconButton: TemplateOnlyComponent<Signature> = <template>
  <BoxelButton
    class={{cn 'boxel-icon-button' is-round=@round loading=@loading}}
    @class={{@class}}
    @kind={{@variant}}
    @size='auto'
    @disabled={{@disabled}}
    ...attributes
  >
    {{#if @loading}}
      <LoadingIcon
        class='loading-icon'
        width={{if @width @width '16px'}}
        height={{if @height @height '16px'}}
      />
    {{else if @icon}}
      <@icon
        width={{if @width @width '16px'}}
        height={{if @height @height '16px'}}
        class='svg-icon'
      />
    {{/if}}
    {{yield}}
  </BoxelButton>
  <style scoped>
    @layer {
      .boxel-icon-button {
        --icon-color: var(--boxel-icon-button-icon-color, currentColor);
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
        color: var(--boxel-icon-button-color, var(--boxel-button-text-color));
        z-index: 0;
        overflow: hidden;
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
