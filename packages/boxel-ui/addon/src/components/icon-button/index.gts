import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import cn from '../../helpers/cn.ts';
import type { Icon } from '../../icons/types.ts';

export interface Signature {
  Args: {
    class?: string;
    height?: string;
    icon?: Icon;
    variant?: string;
    width?: string;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement;
}

class IconButton extends Component<Signature> {
  @tracked isHoverOnButton = false;

  onMouseEnterButton = (_e: MouseEvent) => {
    this.isHoverOnButton = true;
  };

  onMouseLeaveButton = (_e: MouseEvent) => {
    this.isHoverOnButton = false;
  };

  get hasCustomSizeAttributes() {
    return this.args.width || this.args.height;
  }

  <template>
    <button
      class={{cn (if @variant (concat @variant)) @class}}
      {{on 'mouseenter' this.onMouseEnterButton}}
      {{on 'mouseleave' this.onMouseLeaveButton}}
      ...attributes
    >
      {{! Using inline style attribute because targeting the svg using <style scoped> does not work - css scoping works incorrectly }}
      {{! template-lint-disable no-inline-styles }}
      {{#if @icon}}
        <@icon
          width={{if @width @width '16px'}}
          height={{if @height @height '16px'}}
          class={{unless this.hasCustomSizeAttributes 'svg-icon'}}
        />
      {{/if}}
    </button>
    <style scoped>
      button {
        --inner-boxel-icon-button-width: var(--boxel-icon-button-width, 40px);
        --inner-boxel-icon-button-height: var(--boxel-icon-button-height, 40px);
        width: var(--inner-boxel-icon-button-width);
        height: var(--inner-boxel-icon-button-height);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        background: var(--boxel-icon-button-background, none);
        border: 1px solid transparent;
        z-index: 0;
        overflow: hidden;
      }

      button:hover {
        cursor: pointer;
      }

      button:disabled {
        cursor: default;
      }

      .primary {
        --icon-bg: var(--boxel-highlight);
        --icon-border: var(--boxel-highlight);
      }

      .secondary {
        --icon-color: var(--boxel-highlight);
        border: 1px solid rgb(255 255 255 / 35%);
        border-radius: 100px;
        background-color: var(--boxel-icon-button-background, #41404d);
      }

      .secondary:hover {
        background-color: var(--boxel-purple-800);
      }

      .svg-icon {
        width: var(--inner-boxel-icon-button-widt);
        height: var(--inner-boxel-icon-button-width);
      }
    </style>
  </template>
}

export default IconButton;
