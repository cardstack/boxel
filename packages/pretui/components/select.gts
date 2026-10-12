// Pretui — Select: BoxelSelect (ember-power-select) behind Pretui's value API.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
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
    /** the id your `<label for>` points at. The trigger keeps BoxelSelect's
     * own id, so this only finds the label, which then names the trigger
     * through aria-labelledby */
    controlId?: string;
    /** accessible name for the trigger, when there is no label */
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
// scroll-into-view and trigger typeahead — while
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
    matchTriggerWidth?: boolean;
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
  (wrap: HTMLElement, [controlId, explicit]: [string | undefined, boolean]) => {
    if (explicit) {
      return;
    }
    let trigger = wrap.querySelector<HTMLElement>(
      '[data-pretui-select-trigger]',
    );
    if (!trigger) {
      return;
    }
    let label =
      (controlId
        ? document.querySelector<HTMLElement>(
            `label[for="${CSS.escape(controlId)}"]`,
          )
        : null) ?? wrap.closest('label');
    if (!label) {
      return;
    }
    if (!label.id) {
      label.id = `${trigger.id}-label`;
    }
    trigger.setAttribute('aria-labelledby', `${label.id} ${trigger.id}`);
  },
);

export class Select extends Component<SelectSignature> {
  @tracked internal = this.args.defaultValue;
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
      {{nameFromLabel @controlId this.explicitName}}
      data-test-pretui-select
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
        @matchTriggerWidth={{true}}
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
      @layer PretComponent {
        .pretui-selectwrap {
          /* per-instance knob: the trigger's height */
          --pretui-select-h: 1.75rem;

          min-width: 0;
          /* BoxelSelect's knobs, set to theme tokens. The --boxel-dropdown-*
             ones and the radius travel to the wormhole, values resolved. */
          --boxel-form-control-border-radius: calc(var(--radius) - 2px);
          /* the trigger spends its hairline as a box-shadow with border: 0,
             so it pads 1px more than a bordered Input to line its text up */
          --boxel-select-trigger-padding: 0 0.625rem;
          --boxel-select-trigger-gap: var(--boxel-sp-2xs);
          --boxel-select-trigger-content-wrap: nowrap;
          --boxel-select-background-color: var(--field);
          --boxel-select-text-color: var(--foreground);
          --boxel-dropdown-background-color: var(--popover);
          --boxel-dropdown-text-color: var(--popover-foreground);
          --boxel-dropdown-border-color: var(--border);
          --boxel-dropdown-hover-color: var(--hover);
          --boxel-dropdown-hover-text-color: var(--popover-foreground);
          /* the selected row is a --primary fill; its text and checkmark
             take --primary-foreground through currentColor. Its hover and
             keyboard-highlight tints are BoxelSelect's own mixes of the two. */
          --boxel-dropdown-highlight-color: var(--primary);
          --boxel-dropdown-highlight-hover-color: var(--primary);
          --boxel-dropdown-selected-text-color: var(--primary-foreground);
          --boxel-dropdown-focus-border-color: var(--ring);
        }
      }
      /* BoxelSelect has no knobs for the trigger's height and hairline, so
         these reach its trigger, dressed to match Input. Unlayered, the one
         exception in the kit: BoxelSelect's own rules are unlayered, and
         unlayered CSS beats any layer. */
      .pretui-selectwrap :deep(.pretui-selecttrigger) {
        align-items: center;
        height: var(--pretui-select-h);
        border: 0;
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
        /* BoxelSelect paints disabled on --muted; this rule outranks it, so
           the field surface holds and only the opacity says disabled */
        background-color: var(--field);
        color: var(--foreground);
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
      .pretui-selectwrap :deep(.boxel-trigger-content > *) {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
