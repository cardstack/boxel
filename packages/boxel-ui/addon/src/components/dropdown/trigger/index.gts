import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../../helpers/cn.ts';
import CaretDown from '../../../icons/caret-down.gts';
import type { Icon } from '../../../icons/types.ts';
import BoxelButton from '../../button/index.gts';

interface Signature {
  Args: {
    disabled?: boolean;
    icon?: Icon;
    isMissingValue?: boolean;
    label: string | number | undefined;
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
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
      <@icon class='boxel-dropdown-trigger__icon' role='presentation' />
    {{/if}}

    {{@label}}
    <CaretDown
      class='boxel-dropdown-trigger__caret'
      width='8'
      height='8'
      role='presentation'
    />
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
