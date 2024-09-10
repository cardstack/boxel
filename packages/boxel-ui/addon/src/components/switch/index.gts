import { cn } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

interface SwitchArgs {
  disabled?: boolean;
  isEnabled: boolean;
  onChange: () => void;
  label: string;
}

export default class Switch extends Component<SwitchArgs> {
  <template>
    <label
      class={{cn 'switch' checked=@isEnabled disabled=@disabled}}
      data-test-switch-checked={{if @isEnabled 'on' 'off'}}
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
        aria-label={{@label}}
      />
    </label>

    <style>
      .switch {
        width: 22px;
        height: 12px;
        background-color: var(--boxel-450);
        border-radius: var(--boxel-border-radius-sm);
        padding: 3px;
        display: inline-flex;
        align-items: center;
        transition: background-color 0.1s ease-in;
        position: relative;
        --default-switch-color: var(--boxel-dark-green);
      }
      input[type='checkbox'] {
        appearance: none;
      }
      .switch-input {
        margin: 0;
        width: 6px;
        height: 6px;
        background-color: var(--boxel-light);
        border-radius: 50%;
        transform: translateX(0);
        transition: transform 0.1s ease-in;
      }
      .switch.checked {
        background-color: var(
          --boxel-switch-color,
          var(--default-switch-color)
        );
      }
      .switch.checked .switch-input {
        transform: translateX(10px);
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
    </style>
  </template>
}
