import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { cn } from '../../helpers.ts';

interface SwitchSiganture {
  Args: SwitchArgs;
  Element: HTMLLabelElement;
}
interface SwitchArgs {
  disabled?: boolean;
  isEnabled: boolean;
  label: string;
  onChange: () => void;
}

// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export default class Switch extends Component<SwitchSiganture> {
  <template>
    <label
      class={{cn 'switch' checked=@isEnabled disabled=@disabled}}
      data-test-switch-checked={{if @isEnabled 'on' 'off'}}
      ...attributes
    >
      <span class='boxel-sr-only'>{{@label}}</span>
      <input
        {{on 'click' @onChange}}
        {{on 'keypress' @onChange}}
        class='switch-input'
        type='checkbox'
        checked={{@isEnabled}}
        disabled={{@disabled}}
        aria-checked={{@isEnabled}}
        role='switch'
      />
    </label>

    <style scoped>
      @layer {
        .switch {
          width: 34px;
          height: 20px;
          border-radius: 20px;
          padding: 2.5px;
          display: inline-flex;
          align-items: center;
          transition: background-color 0.1s ease-in;
          position: relative;

          --switch-bg-color: var(--boxel-400);
          --switch-active-color: var(--primary, var(--boxel-dark-green));
          --switch-thumb-color: var(--boxel-light);

          background-color: var(--switch-bg-color);
        }

        input[type='checkbox'] {
          appearance: none;
        }

        .switch-input {
          margin: 0;
          height: 100%;
          aspect-ratio: 1;
          background-color: var(--switch-thumb-color);
          border-radius: 50%;
          margin-left: 0;
          transition: margin-left 0.1s ease-in;
        }

        .switch.checked {
          background-color: var(--switch-active-color);
        }

        .switch.checked .switch-input {
          margin-left: 49%;
        }

        .switch:hover,
        .switch-input:hover {
          cursor: pointer;
        }

        .switch.disabled {
          opacity: 0.5;
        }

        .switch.disabled,
        .switch.disabled .switch-input {
          cursor: default;
        }
      }
    </style>
  </template>
}
