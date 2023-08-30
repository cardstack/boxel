import type { TemplateOnlyComponent } from '@ember/component/template-only';
import BoxelButton from '../../button';
import cn from '../../../helpers/cn';
import { svgJar } from '../../../helpers/svg-jar';

interface Signature {
  Element: HTMLButtonElement | HTMLAnchorElement;
  Args: {
    icon?: string;
    label: string | number | undefined;
    isMissingValue?: boolean;
    disabled?: boolean;
  };
}

const BoxelDropdownTrigger: TemplateOnlyComponent<Signature> = <template>
  <BoxelButton
    class={{cn
      'boxel-dropdown-trigger'
      boxel-dropdown-trigger--showing-placeholder=@isMissingValue
    }}
    @disabled={{@disabled}}
    ...attributes
  >
    {{#if @icon}}
      {{svgJar @icon class='boxel-dropdown-trigger__icon' role='presentation'}}
    {{/if}}
    {{@label}}
    {{svgJar
      'caret-down'
      class='boxel-dropdown-trigger__caret'
      width=8
      height=8
      role='presentation'
    }}
  </BoxelButton>
  <style>
    @layer {
      .boxel-dropdown-trigger {
        border: 0;
        padding: 0;
        border-radius: 0;
        font-weight: bold;
        font-size: var(--boxel-font-size);
        justify-content: flex-start;
      }

      .boxel-dropdown-trigger--showing-placeholder {
        color: var(--boxel-purple-300);
      }

      .boxel-dropdown-trigger__icon {
        --icon-color: var(--boxel-highlight);

        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        margin-right: var(--boxel-sp-xxs);
      }

      .boxel-dropdown-trigger__caret {
        --icon-color: var(--boxel-purple-200);
        margin-left: var(--boxel-sp-xxs);
      }
    }
  </style>
</template>;

export default BoxelDropdownTrigger;
