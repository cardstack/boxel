import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { svgJar } from '../../helpers/svg-jar';
import { concat } from '@ember/helper';
import cn from '../../helpers/cn';

export interface Signature {
  Element: HTMLButtonElement;
  Args: {
    variant?: string;
    class?: string;
    icon?: string;
    width?: string;
    height?: string;
    tooltip?: string;
    tooltipPosition?: 'right' | 'left' | 'above' | 'below';
  };
  Blocks: {
    default: [];
  };
}

const IconButton: TemplateOnlyComponent<Signature> = <template>
  <button
    class={{cn
      (if @variant (concat @variant))
      (if
        @tooltip
        (concat
          'tooltip tooltip__'
          (if @tooltipPosition @tooltipPosition 'right')
        )
      )
      @class
    }}
    data-hover={{@tooltip}}
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
      z-index: 1;
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
      pointer-events: unset !important;
      position: relative;
    }

    .tooltip::after {
      content: attr(data-hover);
      opacity: 0;
      background-color: rgb(0 0 0 / 80%);
      box-shadow: 0 0 0 1px var(--boxel-light-500);
      color: var(--boxel-light);
      text-align: center;
      border-radius: var(--boxel-border-radius-sm);
      padding: var(--boxel-sp-xxxs) var(--boxel-sp-sm);
      width: max-content;
      transition: opacity 1s ease-in-out;
      position: absolute;
      z-index: 1;
    }

    .tooltip:hover::after {
      opacity: 1;
      visibility: visible;
    }

    .tooltip__right::after {
      left: 140%;
      top: 10%;
    }

    .tooltip__left::after {
      right: 140%;
      top: 10%;
    }

    .tooltip__above::after {
      bottom: 110%;
    }

    .tooltip__below::after {
      top: 110%;
    }
  </style>
</template>;

export default IconButton;
