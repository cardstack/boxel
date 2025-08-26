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
        background: var(
          --boxel-icon-button-background,
          var(--boxel-button-color)
        );
        color: var(--boxel-icon-button-color, var(--boxel-button-text-color));
        z-index: 0;
        overflow: hidden;
        transition: var(
          --boxel-icon-button-transition,
          var(--boxel-transition-properties)
        );
      }
      .is-round {
        border-radius: 50%;
      }

      .kind-default {
        --boxel-button-color: transparent;
        --boxel-button-text-color: var(--foreground, var(--boxel-dark));
        --boxel-button-border: var(
          --boxel-icon-button-background,
          var(--boxel-button-color)
        );
      }
      .kind-default:not(:disabled):hover,
      .kind-default:not(:disabled):active {
        --boxel-button-color: transparent;
        color: color-mix(
          in oklab,
          var(--boxel-icon-button-color, var(--boxel-button-text-color)) 90%,
          transparent
        );
      }
      .kind-default:disabled {
        --boxel-button-text-color: var(--muted-foreground, var(--boxel-450));
      }

      @media (prefers-reduced-motion: no-preference) {
        .loading-icon {
          animation: spin 6000ms linear infinite;
        }
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    }
  </style>
</template>;

export default IconButton;
