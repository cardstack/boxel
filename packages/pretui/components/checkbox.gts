// Checkbox: a native binary choice in Pretui cloth.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { emit, firstDefined } from '../pretui-primitives';

export interface CheckboxSignature {
  Args: {
    label?: string;
    checked?: boolean;
    defaultChecked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    /** aliases — see Switch */
    isSelected?: boolean;
    selected?: boolean;
    isDisabled?: boolean;
    onChange?: (checked: boolean) => void;
  };
  Element: HTMLLabelElement;
}

export class Checkbox extends Component<CheckboxSignature> {
  @tracked internal = this.args.defaultChecked ?? false;
  get controlled() {
    return firstDefined(
      this.args.checked,
      this.args.isSelected,
      this.args.selected,
    );
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get on() {
    return this.controlled ?? this.internal;
  }
  handleChange = (ev: Event) => {
    let next = (ev.target as HTMLInputElement).checked;
    if (this.controlled === undefined) {
      this.internal = next;
    }
    emit([this.args.onCheckedChange, this.args.onChange], next);
    // a controlled parent that declines the change must not leave the box toggled
    (ev.target as HTMLInputElement).checked = this.on;
  };
  <template>
    <label class='pretui-choice' data-test-pretui-checkbox ...attributes>
      <input
        type='checkbox'
        class='pretui-checkbox'
        checked={{this.on}}
        disabled={{this.disabled}}
        {{on 'change' this.handleChange}}
      />
      {{#if @label}}{{@label}}{{/if}}
    </label>
    <style scoped>
      .pretui-choice {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: var(--text-ui-md, 12.5px);
        cursor: pointer;
      }
      .pretui-checkbox {
        appearance: none;
        width: 15px;
        height: 15px;
        margin: 0;
        border-radius: 5px;
        background: var(
          --pretui-control-rest,
          var(--field, var(--boxel-light))
        );
        box-shadow: 0 0 0 1px var(--pretui-control-border, var(--input));
        cursor: pointer;
        display: inline-grid;
        place-content: center;
        flex: none;
        transition: background var(--pretui-dur-snap, 180ms)
          var(--pretui-ease-snap, ease);
      }
      .pretui-checkbox:hover:not(:checked):not(:disabled) {
        background: var(--pretui-control-hover, var(--hover, var(--boxel-100)));
      }
      .pretui-checkbox:checked {
        background: var(--primary);
        box-shadow:
          0 0 0 1px color-mix(in oklch, var(--primary) 70%, var(--border)),
          var(--pretui-edge-highlight, inset 0 1px 0 rgb(255 255 255 / 0.14));
      }
      .pretui-checkbox:checked::before {
        content: '';
        width: 9px;
        height: 9px;
        background: var(--primary-foreground);
        clip-path: polygon(14% 47%, 38% 70%, 86% 18%, 96% 30%, 39% 89%, 4% 58%);
      }
      .pretui-checkbox:disabled {
        opacity: 0.45;
        cursor: default;
      }
      /* appearance: none discards the UA focus ring with the native look */
      .pretui-checkbox:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
    </style>
  </template>
}
