import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import cn from '../../helpers/cn.ts';
import { svgJar } from '../../helpers/svg-jar.ts';

export interface Signature {
  Args: {
    class?: string;
    height?: string;
    icon?: string;
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

  <template>
    <button
      class={{cn (if @variant (concat @variant)) @class}}
      {{on 'mouseenter' this.onMouseEnterButton}}
      {{on 'mouseleave' this.onMouseLeaveButton}}
      ...attributes
    >
      {{! Using inline style attribute because targeting the svg using <style> does not work - css scoping works incorrectly }}
      {{#if @icon}}
        {{svgJar
          @icon
          width=(if @width @width '16px')
          height=(if @height @height '16px')
          style='margin: auto;'
        }}
      {{/if}}
    </button>
    <style>
      button {
        --boxel-icon-button-width: 40px;
        --boxel-icon-button-height: 40px;

        width: var(--boxel-icon-button-width);
        height: var(--boxel-icon-button-height);
        padding: 0;
        background: none;
        border: 1px solid transparent;
        z-index: 0;
      }

      button:hover {
        cursor: pointer;
      }

      .primary {
        --icon-bg: var(--boxel-highlight);
        --icon-border: var(--boxel-highlight);
      }

      .secondary {
        --icon-color: var(--boxel-highlight);

        border: 1px solid rgb(255 255 255 / 35%);
        border-radius: 100px;
        background-color: #41404d;
      }

      .secondary:hover {
        background-color: var(--boxel-purple-800);
      }
    </style>
  </template>
}

export default IconButton;
