import Component from '@glimmer/component';
import { svgJar } from '../../helpers/svg-jar';
import { concat } from '@ember/helper';
import cn from '../../helpers/cn';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

export interface Signature {
  Element: HTMLButtonElement;
  Args: {
    variant?: string;
    class?: string;
    icon?: string;
    width?: string;
    height?: string;
  };
  Blocks: {
    default: [];
  };
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
      class={{cn
        (if @variant (concat @variant))
        @class
      }}
      {{on 'mouseenter' this.onMouseEnterButton}}
      {{on 'mouseleave' this.onMouseLeaveButton}}
      ...attributes
    >
      {{#if @icon}}
        {{svgJar
          @icon
          width=(if @width @width '16px')
          height=(if @height @height '16px')
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

      button > svg {
        display: block;
        margin: auto;
      }
    </style>
  </template>
}

export default IconButton;
