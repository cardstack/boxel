import LoadingIcon from '@cardstack/boxel-icons/loader';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { concat } from '@ember/helper';

import cn from '../../helpers/cn.ts';
import type { Icon } from '../../icons/types.ts';
import BoxelButton, {
  type BoxelButtonKind,
  type BoxelButtonSize,
} from '../button/index.gts';

export interface Signature {
  Args: {
    class?: string;
    disabled?: boolean;
    height?: string;
    icon?: Icon;
    loading?: boolean;
    round?: boolean;
    size?: BoxelButtonSize;
    variant?: BoxelButtonKind;
    width?: string;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

export const getIconSize = (size?: BoxelButtonSize) => {
  if (size === 'extra-small') {
    return '16px';
  }
  return '20px';
};

const IconButton: TemplateOnlyComponent<Signature> = <template>
  <BoxelButton
    class={{cn
      'boxel-icon-button'
      (if @size (concat 'boxel-icon-button--' @size))
      is-round=@round
      loading=@loading
    }}
    @class={{@class}}
    @kind={{@variant}}
    @size='auto'
    @disabled={{@disabled}}
    ...attributes
  >
    {{#if @loading}}
      <LoadingIcon
        class='loading-icon'
        width={{if @width @width (getIconSize @size)}}
        height={{if @height @height (getIconSize @size)}}
      />
    {{else if @icon}}
      <@icon
        width={{if @width @width (getIconSize @size)}}
        height={{if @height @height (getIconSize @size)}}
        class='svg-icon'
      />
    {{/if}}
    {{yield}}
  </BoxelButton>
  <style scoped>
    @layer boxelComponentL2 {
      .boxel-icon-button {
        --icon-color: var(--boxel-icon-button-color, currentColor);
        width: var(--boxel-icon-button-width, var(--boxel-icon-lg));
        height: var(--boxel-icon-button-height, var(--boxel-icon-lg));
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        padding: var(--boxel-icon-button-padding, 0);
        background-color: var(
          --boxel-icon-button-background,
          var(--boxel-button-color, transparent)
        );
        border: none;
        border-radius: var(--boxel-border-radius);
        color: var(
          --boxel-icon-button-color,
          var(--boxel-button-text-color, inherit)
        );
        z-index: 0;
        overflow: hidden;
      }
      .boxel-icon-button--extra-small {
        width: var(--boxel-button-mini);
        height: var(--boxel-button-mini);
        border-radius: var(--boxel-border-radius-xs);
      }
      .boxel-icon-button--small {
        width: var(--boxel-button-xs);
        height: var(--boxel-button-xs);
        border-radius: var(--boxel-border-radius-xs);
      }
      .boxel-icon-button--base {
        width: var(--boxel-button-sm);
        height: var(--boxel-button-sm);
        border-radius: var(--boxel-border-radius-sm);
      }
      .boxel-icon-button--tall {
        padding: var(--boxel-sp-xxs);
        width: var(--boxel-button-tall);
        height: var(--boxel-button-tall);
      }
      .boxel-icon-button--touch {
        padding: var(--boxel-sp-xs);
        width: var(--boxel-button-touch);
        height: var(--boxel-button-touch);
      }
      .is-round {
        border-radius: 50%;
      }

      .kind-default {
        background: var(--boxel-icon-button-background, none);
        color: var(--boxel-icon-button-color, inherit);
      }
      .kind-default:disabled {
        color: var(--boxel-400);
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
