import Component from '@glimmer/component';
import { cn } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';

interface SwitchArgs {
  isEnabled: boolean;
  onToggle: () => void;
}

export default class Switch extends Component<SwitchArgs> {
  <template>
    <label
      class={{cn 'switch' checked=@isEnabled}}
      data-test-switch-checked={{if @isEnabled 'on' 'off'}}
    >
      <input
        {{on 'click' @onToggle}}
        {{on 'keypress' @onToggle}}
        class='switch-input'
        type='checkbox'
        checked={{@isEnabled}}
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
    </style>
  </template>
}
