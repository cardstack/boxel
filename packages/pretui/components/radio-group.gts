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
  /** a line under the label saying what the choice means */
  description?: string;
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
    /** the group's accessible name when no label element points at it */
    label?: string;
    /** the form field the radios submit under; a generated name groups them otherwise */
    name?: string;
    onValueChange?: (value: string) => void;
    /** aliases */
    onChange?: (value: string) => void;
    isDisabled?: boolean;
  };
  Element: HTMLDivElement;
}

export class RadioGroup extends Component<RadioGroupSignature> {
  @tracked internal = this.args.defaultValue;
  generatedName = `${guidFor(this)}-rg`;
  get name() {
    return this.args.name ?? this.generatedName;
  }
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
    <div
      role='radiogroup'
      class='pretui-radiogroup'
      aria-label={{@label}}
      data-test-pretui-radio-group
      ...attributes
    >
      {{#each this.options as |option|}}
        <label
          class='pretui-choice'
          data-has-description={{if option.description 'true'}}
          data-test-pretui-radio-option={{option.value}}
        >
          <input
            type='radio'
            class='pretui-radio'
            name={{this.name}}
            value={{option.value}}
            checked={{this.isOn option}}
            disabled={{this.isDisabled option}}
            {{on 'change' (fn this.pick option)}}
          />
          {{#if option.description}}
            <span class='pretui-radio-text'>
              <span class='pretui-radio-label'>{{option.label}}</span>
              <span class='pretui-radio-description'>{{option.description}}</span>
            </span>
          {{else}}
            {{option.label}}
          {{/if}}
        </label>
      {{/each}}
    </div>
    <style scoped>
      @layer PretComponent {
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
          transition: background var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease);
          cursor: pointer;
          display: inline-grid;
          place-content: center;
          flex: none;
        }
        .pretui-radio:checked {
          background: var(--primary);
          box-shadow: 0 0 0 1px
              var(
                --pretui-control-checked-border,
                color-mix(in oklch, var(--primary) 70%, var(--border))
              ),
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
        .pretui-radio:hover:not(:checked):not(:disabled) {
          background: var(--pretui-control-hover, var(--hover, var(--boxel-100)));
        }
        .pretui-radio:disabled {
          opacity: 0.45;
          cursor: default;
        }
        /* appearance: none discards the UA focus ring with the native look */
        .pretui-radio:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        /* with a description, the radio sits on the label's first line */
        .pretui-choice[data-has-description] {
          align-items: flex-start;
        }
        .pretui-choice[data-has-description] .pretui-radio {
          margin-block-start: calc((1lh - 15px) / 2);
        }
        .pretui-radio-text {
          display: grid;
          gap: 0.125rem;
          min-inline-size: 0;
        }
        .pretui-radio-description {
          font-size: var(--text-ui-sm, 0.72rem);
          color: var(--muted-foreground);
          overflow-wrap: anywhere;
        }
        /* forced colors drop the painted face, so the platform's radio,
           drawn in the system colors, stands in there */
        @media (forced-colors: active) {
          .pretui-radio {
            appearance: auto;
          }
        }
      }
    </style>
  </template>
}

