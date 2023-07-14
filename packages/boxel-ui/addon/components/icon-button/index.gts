import Component from '@glimmer/component';
import { svgJar } from '../../helpers/svg-jar';
import { concat } from '@ember/helper';
import cn from '../../helpers/cn';
import { Velcro } from 'ember-velcro';
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
    tooltip?: string;
    tooltipPosition?: 'right' | 'left' | 'top' | 'bottom';
    tooltipOffset?: number;
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

  get showTooltip() {
    return this.args.tooltip && this.isHoverOnButton;
  }

  <template>
    <Velcro @placement={{if @tooltipPosition @tooltipPosition 'top'}}  @offsetOptions={{if @tooltipOffset @tooltipOffset 5}} as |velcro|>
      <button
        {{velcro.hook}}
        class={{cn
          (if @variant (concat @variant))
          @class
        }}
        data-hover={{@tooltip}}
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
      {{#if this.showTooltip}}
          <div {{velcro.loop}} class='tooltip'>
            {{@tooltip}}
          </div>
      {{/if}}
    </Velcro>
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

      .tooltip {
        background-color: rgb(0 0 0 / 80%);
        box-shadow: 0 0 0 1px var(--boxel-light-500);
        color: var(--boxel-light);
        text-align: center;
        border-radius: var(--boxel-border-radius-sm);
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-sm);
        width: max-content;
        position: absolute;
        font: var(--boxel-font-xs);
        z-index: 5;
      }
    </style>
  </template>
}

export default IconButton;
