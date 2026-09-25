// Pretui — RadioGroup: one-of-N native radios sharing a generated name.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { emit, firstDefined } from '../pretui-primitives';

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupSignature {
  Args: {
    options?: RadioOption[];
    /** alias — the canonical flat-collection noun */
    items?: RadioOption[];
    value?: string;
    defaultValue?: string;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
    /** aliases */
    onChange?: (value: string) => void;
    isDisabled?: boolean;
  };
  Element: HTMLDivElement;
}

export class RadioGroup extends Component<RadioGroupSignature> {
  @tracked internal = this.args.defaultValue;
  name = `${guidFor(this)}-rg`;
  get options(): RadioOption[] {
    return firstDefined(this.args.options, this.args.items) ?? [];
  }
  get groupDisabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get value() {
    return this.args.value ?? this.internal;
  }
  pick = (option: RadioOption) => {
    if (this.args.value === undefined) {
      this.internal = option.value;
    }
    emit([this.args.onValueChange, this.args.onChange], option.value);
  };
  isOn = (option: RadioOption) => this.value === option.value;
  isDisabled = (option: RadioOption) => this.groupDisabled || option.disabled;
  <template>
    <div role='radiogroup' class='pretui-radiogroup' data-test-pretui-radio-group ...attributes>
      {{#each this.options as |option|}}
        <label class='pretui-choice'>
          <input
            type='radio'
            class='pretui-radio'
            name={{this.name}}
            value={{option.value}}
            checked={{this.isOn option}}
            disabled={{this.isDisabled option}}
            {{on 'change' (fn this.pick option)}}
          />
          {{option.label}}
        </label>
      {{/each}}
    </div>
    <style scoped>
      .pretui-radiogroup {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .pretui-choice {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: var(--text-ui-md, 12.5px);
        cursor: pointer;
      }
      .pretui-radio {
        appearance: none;
        width: 15px;
        height: 15px;
        margin: 0;
        border-radius: 50%;
        background: var(--pretui-control-rest, var(--field, var(--boxel-light)));
        box-shadow: 0 0 0 1px var(--pretui-control-border, var(--input));
        cursor: pointer;
        display: inline-grid;
        place-content: center;
        flex: none;
      }
      .pretui-radio:checked {
        background: var(--primary);
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--primary) 70%, var(--border)),
          var(--pretui-edge-highlight, inset 0 1px 0 rgb(255 255 255 / 0.14));
      }
      .pretui-radio:checked::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        /* the Switch's white knob, not ink-on-highlight — one selected
           language across toggles (boxel-ui paints this dark; deliberate
           delta for consistency with our Switch) */
        background: var(--card);
        box-shadow: 0 0 0 1px rgb(0 0 0 / 0.12);
      }
      .pretui-radio:disabled {
        opacity: 0.45;
        cursor: default;
      }
    </style>
  </template>
}

