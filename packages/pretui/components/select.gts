// Pretui — Select: BoxelSelect (ember-power-select) behind Pretui's value API.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { guidFor } from '@ember/object/internals';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlNotifyArgs } from '../pretui-primitives';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectSignature {
  Args: ControlNotifyArgs & {
    options?: SelectOption[];
    /** alias — the collection noun the React contract calls canonical for a
     * flat list. Accepted so `@items` is not a silent empty select. */
    items?: SelectOption[];
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    disabled?: boolean;
    controlId?: string;
    /** accessible name for the trigger. The trigger is not a labelable
     * element, so a `<label for={{controlId}}>` alone may not name it. */
    label?: string;
    /** id of an element that names the trigger; preferred over @label when
     * a visible or visually hidden label already exists */
    labelledBy?: string;
    /** alias — React Aria / Base UI spelling of @disabled */
    isDisabled?: boolean;
  };
  Element: HTMLDivElement;
}

// The flagship, rebuilt ON boxel-ui (standing reuse directive): wraps
// BoxelSelect (ember-power-select) for real listbox behavior — keyboard nav,
// scroll-into-view, trigger typeahead, and a search box on long lists — while
// keeping Pretui's public API (value/defaultValue/onValueChange hybrid).
// The dropdown renders in BoxelSelect's wormhole, so no overflow-hidden
// ancestor clips it. BoxelSelect copies its --boxel-dropdown-* knobs from the
// trigger onto the wormhole on every open, and a custom property's computed
// value has its var() references resolved — so setting those knobs to theme
// tokens here carries the theme, dark mode included, onto the dropdown
// without any :deep() rule reaching it.
//
// Type-only cast: the CLI's bundled boxel-ui types import PowerSelectArgs
// from ember-power-select, which the realm type env cannot resolve, so
// BoxelSelect's visible args collapse to options/variant. Re-assert the
// power-select arg surface we actually use; runtime is the real BoxelSelect.
interface PoweredSelectSignature {
  Args: {
    options: SelectOption[];
    selected?: SelectOption;
    onChange: (option: SelectOption | null) => void;
    placeholder?: string;
    disabled?: boolean;
    searchEnabled?: boolean;
    searchField?: string;
    matchTriggerWidth?: boolean;
    dropdownClass?: string;
    ariaLabel?: string;
    ariaLabelledBy?: string;
  };
  Blocks: { default: [SelectOption] };
  Element: HTMLElement;
}
const PoweredSelect = BoxelSelect as unknown as new (
  owner: unknown,
  args: PoweredSelectSignature['Args'],
) => Component<PoweredSelectSignature>;

// The trigger is a role='button' div, which a <label> does not name, so a
// label pointing at @controlId (or wrapping the Select) is linked through
// aria-labelledby — label first, then the trigger itself, so the chosen
// value is still announced after the name.
const nameFromLabel = modifier(
  (
    wrap: HTMLElement,
    [controlId, explicit, fallbackId]: [string | undefined, boolean, string],
  ) => {
    if (explicit) {
      return;
    }
    let trigger = wrap.querySelector<HTMLElement>('[data-pretui-select-trigger]');
    if (!trigger) {
      return;
    }
    let label =
      (controlId
        ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(controlId)}"]`)
        : null) ?? wrap.closest('label');
    if (!label) {
      return;
    }
    if (!trigger.id) {
      trigger.id = fallbackId;
    }
    if (!label.id) {
      label.id = `${trigger.id}-label`;
    }
    trigger.setAttribute('aria-labelledby', `${label.id} ${trigger.id}`);
  },
);

export class Select extends Component<SelectSignature> {
  @tracked internal = this.args.defaultValue;
  get triggerId(): string {
    return this.args.controlId ?? `${guidFor(this)}-trigger`;
  }
  get explicitName(): boolean {
    return this.args.label !== undefined || this.args.labelledBy !== undefined;
  }

  get options(): SelectOption[] {
    return firstDefined(this.args.options, this.args.items) ?? [];
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get value() {
    return this.args.value ?? this.internal;
  }
  // power-select selects the option OBJECT; the public API speaks in values
  get selectedOption() {
    return this.options.find((o) => o.value === this.value);
  }
  get searchEnabled() {
    return this.options.length > 7;
  }
  choose = (option: SelectOption | null) => {
    if (!option) {
      return;
    }
    if (this.args.value === undefined) {
      this.internal = option.value;
    }
    emit([this.args.onValueChange, this.args.onChange], option.value);
  };

  <template>
    <div
      class='pretui-selectwrap'
      data-test-pretui-select
      {{nameFromLabel @controlId this.explicitName this.triggerId}}
      ...attributes
    >
      {{! no id here: BoxelSelect finds the trigger by its own id to copy the
          theme onto the wormhole. A label[for=@controlId] still names it,
          through the aria-labelledby that nameFromLabel sets. }}
      <PoweredSelect
        class='pretui-selecttrigger'
        @options={{this.options}}
        @selected={{this.selectedOption}}
        @onChange={{this.choose}}
        @placeholder={{if @placeholder @placeholder 'Select…'}}
        @disabled={{this.disabled}}
        @searchEnabled={{this.searchEnabled}}
        @searchField='label'
        @matchTriggerWidth={{true}}
        @dropdownClass='pretui-select-dropdown'
        @ariaLabel={{@label}}
        @ariaLabelledBy={{@labelledBy}}
        data-pretui-select-trigger
        data-test-pretui-select-trigger
        as |option|
      >
        <span data-test-pretui-select-option>{{option.label}}</span>
      </PoweredSelect>
    </div>
    <style scoped>
      .pretui-selectwrap {
        --pretui-select-h: 1.75rem;

        min-width: 0;
        /* BoxelSelect's knobs, set to theme tokens. The --boxel-dropdown-*
           ones travel to the wormhole with their values resolved. */
        --boxel-form-control-border-radius: calc(var(--radius) - 2px);
        /* the trigger spends its hairline as a box-shadow with border: 0,
           so it pads 1px more than a bordered Input to line its text up */
        --boxel-select-trigger-padding: 0 0.625rem;
        --boxel-select-trigger-gap: var(--boxel-sp-2xs);
        --boxel-select-trigger-content-wrap: nowrap;
        --boxel-dropdown-background-color: var(--popover);
        --boxel-dropdown-text-color: var(--popover-foreground);
        --boxel-dropdown-border-color: var(--border);
        --boxel-dropdown-hover-color: var(--hover);
        --boxel-dropdown-hover-text-color: var(--popover-foreground);
        --boxel-dropdown-highlight-color: var(--hover);
        --boxel-dropdown-highlight-hover-color: var(--hover);
        --boxel-dropdown-selected-text-color: var(--primary-ink);
        --boxel-dropdown-selected-highlighted-color: var(--hover);
        --boxel-dropdown-selected-hover-color: var(--hover);
        --boxel-dropdown-focus-border-color: var(--ring);
      }
      /* BoxelSelect has no knobs for the trigger's height and hairline, so
         these reach its trigger, dressed to match Input. Unlayered:
         BoxelSelect's own rules are unlayered, and unlayered CSS beats any
         layer. */
      .pretui-selectwrap :deep(.pretui-selecttrigger) {
        align-items: center;
        height: var(--pretui-select-h);
        border: 0;
        font-family: inherit;
        font-size: var(--boxel-font-size-xs);
        color: var(--foreground);
        background: var(--field);
        box-shadow: 0 0 0 1px var(--input);
        width: 100%;
        text-align: start;
        transition: none;
      }
      .pretui-selectwrap :deep(.pretui-selecttrigger[aria-expanded='true']),
      .pretui-selectwrap :deep(.pretui-selecttrigger:focus-visible) {
        /* forced-colors paints no box-shadow, so a transparent outline keeps
           a focus indicator there */
        outline: 2px solid transparent;
        outline-offset: 1px;
        box-shadow:
          0 0 0 2px var(--ring),
          var(--shadow-inset);
      }
      .pretui-selectwrap :deep(.pretui-selecttrigger[aria-disabled='true']) {
        opacity: 0.45;
      }
      .pretui-selectwrap :deep(.boxel-trigger) {
        width: 100%;
        font-family: inherit;
        font-size: var(--boxel-font-size-xs);
      }
      .pretui-selectwrap :deep(.boxel-trigger-content) {
        min-width: 0;
        overflow: hidden;
      }
      .pretui-selectwrap :deep(.boxel-trigger-placeholder) {
        color: var(--muted-foreground);
        font-family: inherit;
        font-size: var(--boxel-font-size-xs);
      }
      .pretui-selectwrap :deep(.pretui-selecttrigger svg) {
        --icon-color: var(--muted-foreground);

        flex: none;
      }
    </style>
  </template>
}

