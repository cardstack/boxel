// Pretui — NativeSelect: a styled closed face over a real <select>. The
// platform draws the open list, so a phone gets its own picker and the
// control works in a form without a script. Select is the popup one.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { emit, firstDefined, resolveSize } from '../pretui-primitives';
import type { ControlAliasArgs, PretuiSizeArg } from '../pretui-primitives';
import { Caret } from '../internal/caret';

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
      <Caret class='pretui-nativeselect-caret' />
    </span>
    <style scoped>
      @layer PretComponent {
        /* Select's field style: the --field face, a 1px --input edge inside
           the box, Button's corner, --boxel-form-control-height-sm at size m
           and --boxel-font-size-xs type, with Select's caret at its inset */
        .pretui-nativeselect {
          --ns-h-base: var(--boxel-form-control-height-sm);
          --ns-h: var(--ns-h-base);
          /* Select's 0.625rem text inset, less the edge's 1px border */
          --ns-pad: calc(0.625rem - 1px);
          position: relative;
          display: inline-grid;
          align-items: center;
          inline-size: 100%;
          min-inline-size: 0;
          font-size: var(--boxel-font-size-xs);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .pretui-nativeselect-control {
          appearance: none;
          inline-size: 100%;
          min-block-size: var(--ns-h);
          margin: 0;
          padding-block: 0;
          padding-inline: var(--ns-pad)
            calc(var(--ns-pad) + 0.625rem + var(--boxel-sp-2xs));
          font-family: inherit;
          font-size: inherit;
          font-weight: inherit;
          font-style: inherit;
          letter-spacing: inherit;
          line-height: var(--boxel-form-control-line-height-sm);
          color: var(--foreground);
          background-color: var(--field);
          border: 1px solid var(--input);
          border-radius: calc(var(--radius) - 0.125rem);
          cursor: pointer;
          transition: border-color var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease);
        }
        .pretui-nativeselect[data-empty='true'] .pretui-nativeselect-control {
          color: var(--muted-foreground);
        }
        /* the -ink edge (the fill hue misses a field boundary's 3:1), which
           hover darkens; a disabled field can't be fixed, so it drops it */
        .pretui-nativeselect[data-invalid='true']
          .pretui-nativeselect-control:not(:disabled) {
          --input: var(--destructive-ink);
        }
        /* Select's hover edge: toward --foreground, in both schemes */
        @media (hover: hover) {
          .pretui-nativeselect-control:hover:not(:disabled) {
            border-color: color-mix(
              in oklch,
              var(--foreground) 30%,
              var(--input)
            );
          }
        }
        .pretui-nativeselect-control:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -1px;
        }
        .pretui-nativeselect-control:disabled {
          opacity: var(--boxel-disabled-opacity);
          cursor: default;
        }
        /* the platform draws the open list, so the caret never flips */
        .pretui-nativeselect-caret {
          position: absolute;
          inset-inline-end: 0.625rem;
          color: var(--muted-foreground);
          pointer-events: none;
        }
        .pretui-nativeselect:has(select:disabled) .pretui-nativeselect-caret {
          opacity: var(--boxel-disabled-opacity);
        }
        .pretui-nativeselect[data-size='xs'] {
          --ns-h: calc(var(--ns-h-base) - 0.375rem);
          font-size: var(--boxel-font-size-2xs);
        }
        .pretui-nativeselect[data-size='s'] {
          --ns-h: calc(var(--ns-h-base) - 0.1875rem);
          font-size: var(--boxel-font-size-2xs);
        }
        .pretui-nativeselect[data-size='l'] {
          --ns-h: calc(var(--ns-h-base) + 0.25rem);
          font-size: var(--boxel-font-size-sm);
        }
        .pretui-nativeselect[data-size='xl'] {
          --ns-h: calc(var(--ns-h-base) + 0.5rem);
          font-size: var(--boxel-font-size-sm);
        }
        /* iOS zooms into inputs under 16px on focus */
        @media (pointer: coarse) {
          .pretui-nativeselect,
          .pretui-nativeselect[data-size] {
            font-size: var(--boxel-form-control-touch-font-size);
          }
        }
      }
    </style>
  </template>
}
