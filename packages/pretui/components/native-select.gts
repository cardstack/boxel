// Pretui — NativeSelect: a styled closed face over a real <select>. The
// platform draws the open list, so a phone gets its own picker and the
// control works in a form without a script. Select is the popup one.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { emit, firstDefined, resolveSize } from '../pretui-primitives';
import type { ControlAliasArgs, PretuiSizeArg } from '../pretui-primitives';

export interface NativeSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface NativeSelectSignature {
  Args: ControlAliasArgs & {
    options?: NativeSelectOption[];
    /** alias — the canonical flat-collection noun */
    items?: NativeSelectOption[];
    value?: string;
    defaultValue?: string;
    /** a disabled, unselectable first option, shown while nothing is chosen */
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    invalid?: boolean;
    /** alias — React Aria / Base UI spelling of @invalid */
    isInvalid?: boolean;
    /** the id a <label for> points at */
    controlId?: string;
    /** accessible name when no label element points here */
    label?: string;
    size?: PretuiSizeArg;
  };
  Blocks: {
    /** hand-written <option> / <optgroup>; replaces @options */
    default: [];
  };
  Element: HTMLSelectElement;
}

export class NativeSelect extends Component<NativeSelectSignature> {
  @tracked internal = this.args.defaultValue;
  get options(): NativeSelectOption[] {
    return firstDefined(this.args.options, this.args.items) ?? [];
  }
  /** With no placeholder the platform selects the first enabled option, so
   *  that option is the value until something else is chosen. */
  get value() {
    let chosen = this.args.value ?? this.internal;
    if (chosen !== undefined) {
      return chosen;
    }
    if (this.args.placeholder) {
      return '';
    }
    return this.options.find((o) => !o.disabled)?.value ?? '';
  }
  /** the placeholder is showing; without one the select always shows a choice */
  get empty() {
    return Boolean(this.args.placeholder) && this.value === '';
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired) ?? false;
  }
  get invalid() {
    return firstDefined(this.args.invalid, this.args.isInvalid) ?? false;
  }
  get size() {
    return resolveSize(this.args.size);
  }
  handleChange = (ev: Event) => {
    let select = ev.target as HTMLSelectElement;
    let next = select.value;
    if (this.args.value === undefined) {
      this.internal = next;
    }
    emit([this.args.onChange, this.args.onValueChange], next);
    if (this.args.value !== undefined) {
      // controlled: show the owner's value until the owner moves it
      select.value = this.value;
    }
  };
  isOn = (option: NativeSelectOption) => option.value === this.value;
  <template>
    <span
      class='pretui-nativeselect'
      data-size={{this.size}}
      data-empty={{if this.empty 'true' 'false'}}
      data-invalid={{if this.invalid 'true' 'false'}}
      data-test-pretui-native-select
    >
      <select
        class='pretui-nativeselect-control'
        id={{@controlId}}
        aria-label={{@label}}
        aria-invalid={{if this.invalid 'true'}}
        disabled={{this.disabled}}
        required={{this.required}}
        {{on 'change' this.handleChange}}
        ...attributes
      >
        {{#if @placeholder}}
          <option value='' disabled selected={{this.empty}}>{{@placeholder}}</option>
        {{/if}}
        {{#if (has-block)}}
          {{yield}}
        {{else}}
          {{! the param is not named `option`: a lowercase tag that matches an in-scope binding invokes it }}
          {{#each this.options as |opt|}}
            <option
              value={{opt.value}}
              selected={{this.isOn opt}}
              disabled={{opt.disabled}}
            >{{opt.label}}</option>
          {{/each}}
        {{/if}}
      </select>
      <svg class='pretui-nativeselect-caret' viewBox='0 0 12 12' aria-hidden='true'>
        <path d='M3 4.5l3 3 3-3' />
      </svg>
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-nativeselect {
          --ns-h-base: var(--control-h, 1.75rem);
          --ns-h: var(--ns-h-base);
          --ns-text: var(--text-ui-md, 0.78rem);
          --ns-text-sm: var(--text-ui-sm, 0.72rem);
          --ns-text-lg: var(--text-ui-lg, 0.875rem);
          --ns-pad: var(--space-3, 0.5rem);
          --ns-snap: var(--pretui-dur-snap, 180ms) var(--pretui-ease-snap, ease);
          position: relative;
          display: inline-grid;
          align-items: center;
          inline-size: 100%;
          min-inline-size: 0;
          font-size: var(--ns-text);
          letter-spacing: var(--track-ui, 0.01em);
        }
        .pretui-nativeselect-control {
          appearance: none;
          inline-size: 100%;
          min-block-size: var(--ns-h);
          margin: 0;
          padding-block: 0;
          padding-inline: var(--ns-pad) calc(var(--ns-pad) * 2 + 0.75rem);
          font: inherit;
          letter-spacing: inherit;
          color: var(--foreground);
          background-color: var(--field);
          border: 0;
          border-radius: var(--radius);
          box-shadow: 0 0 0 1px var(--input);
          cursor: pointer;
          transition:
            box-shadow var(--ns-snap),
            background-color var(--ns-snap);
        }
        .pretui-nativeselect[data-empty='true'] .pretui-nativeselect-control {
          color: var(--muted-foreground);
        }
        .pretui-nativeselect-control:hover:not(:disabled) {
          background-color: var(--hover);
        }
        .pretui-nativeselect-control:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-nativeselect[data-invalid='true'] .pretui-nativeselect-control {
          box-shadow: 0 0 0 1px var(--destructive);
        }
        .pretui-nativeselect-control:disabled {
          opacity: 0.45;
          cursor: default;
        }
        .pretui-nativeselect-caret {
          position: absolute;
          inset-inline-end: var(--ns-pad);
          inline-size: 0.75rem;
          block-size: 0.75rem;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.5;
          stroke-linecap: round;
          stroke-linejoin: round;
          color: var(--muted-foreground);
          pointer-events: none;
        }
        .pretui-nativeselect[data-size='xs'] {
          --ns-h: calc(var(--ns-h-base) - 0.375rem);
          --ns-text: var(--ns-text-sm);
        }
        .pretui-nativeselect[data-size='s'] {
          --ns-h: calc(var(--ns-h-base) - 0.1875rem);
        }
        .pretui-nativeselect[data-size='l'] {
          --ns-h: calc(var(--ns-h-base) + 0.25rem);
          --ns-text: var(--ns-text-lg);
        }
        .pretui-nativeselect[data-size='xl'] {
          --ns-h: calc(var(--ns-h-base) + 0.5rem);
          --ns-text: var(--ns-text-lg);
        }
      }
    </style>
  </template>
}
