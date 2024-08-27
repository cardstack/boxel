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
      class={{cn 'toggle' checked=@isEnabled}}
      data-test-toggle-checked={{if @isEnabled 'on' 'off'}}
    >
      <input
        {{on 'click' @onToggle}}
        {{on 'keypress' @onToggle}}
        class='toggle-switch'
        type='checkbox'
        checked={{@isEnabled}}
      />
    </label>

    <style>
      .toggle {
        width: 22px;
        height: 12px;
        background-color: var(--boxel-450);
        border-radius: var(--boxel-border-radius-sm);
        padding: 3px;
        display: inline-flex;
        align-items: center;
        transition: background-color 0.1s ease-in;
        position: relative;
        --default-toggle-color: var(--boxel-dark-green);
      }
      input[type='checkbox'] {
        appearance: none;
      }
      .toggle-switch {
        margin: 0;
        width: 6px;
        height: 6px;
        background-color: var(--boxel-light);
        border-radius: 50%;
        transform: translateX(0);
        transition: transform 0.1s ease-in;
      }
      .toggle.checked {
        background-color: var(
          --boxel-toggle-color,
          var(--default-toggle-color)
        );
      }
      .toggle.checked .toggle-switch {
        transform: translateX(10px);
      }
      .toggle:hover,
      .toggle-switch:hover {
        cursor: pointer;
      }
    </style>
  </template>
}
