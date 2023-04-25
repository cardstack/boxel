import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { svgJar } from '../../helpers/svg-jar';
import { concat } from '@ember/helper';
import cn from '../../helpers/cn';
import './style.css';

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

const IconButton: TemplateOnlyComponent<Signature> = <template>
  <button
    class={{cn
      'boxel-icon-button'
      (if @variant (concat 'boxel-icon-button--' @variant))
      @class
    }}
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
</template>;

export default IconButton;
