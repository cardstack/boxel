// Pretui — Select: BoxelSelect (ember-power-select) behind Pretui's value API.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
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
    /** alias — React Aria / Base UI spelling of @disabled */
    isDisabled?: boolean;
  };
  Element: HTMLDivElement;
}

// The flagship, rebuilt ON boxel-ui (standing reuse directive): wraps
// BoxelSelect (ember-power-select) for real listbox behavior — keyboard nav,
// scroll-into-view, trigger typeahead, and a search box on long lists — while
// keeping Pretui's exact public API (value/defaultValue/onValueChange hybrid)
// and the Pretui control dress. @renderInPlace={{true}} is deliberate:
// BoxelSelect's wormhole path (#ember-basic-dropdown-wormhole, synced via its
// syncCustomProps/detectAndSetThemeColors MutationObserver) only copies
// boxel's fixed variable list (--background, --foreground, --border, …) onto
// the portal, so Pretui tokens (--popover, --hover, --field, --pretui-*)
// would not travel and a season recompile could not re-dress the dropdown.
// In-place, the dropdown inherits every token naturally and scoped :deep()
// styles reach it — no :global cached-HTML classes needed. Trade-off
// (accepted): an overflow-hidden ancestor can clip the dropdown, unlike the
// old fixed-position Popup.
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
    renderInPlace?: boolean;
    dropdownClass?: string;
  };
  Blocks: { default: [SelectOption] };
  Element: HTMLElement;
}
const PoweredSelect = BoxelSelect as unknown as new (
  owner: unknown,
  args: PoweredSelectSignature['Args'],
) => Component<PoweredSelectSignature>;

export class Select extends Component<SelectSignature> {
  @tracked internal = this.args.defaultValue;

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
    <div class='pretui-selectwrap' data-test-pretui-select ...attributes>
      {{! id lands on the power-select trigger (label[for] wiring). It
          overrides BoxelSelect's own guid id, which is safe here: that id
          only feeds its wormhole theme observer, skipped for renderInPlace. }}
      <PoweredSelect
        id={{@controlId}}
        class='pretui-selecttrigger'
        @options={{this.options}}
        @selected={{this.selectedOption}}
        @onChange={{this.choose}}
        @placeholder={{if @placeholder @placeholder 'Select…'}}
        @disabled={{this.disabled}}
        @searchEnabled={{this.searchEnabled}}
        @searchField='label'
        @matchTriggerWidth={{true}}
        @renderInPlace={{true}}
        @dropdownClass='pretui-select-dropdown'
        as |option|
      >
        {{option.label}}
      </PoweredSelect>
    </div>
    <style scoped>
      .pretui-selectwrap {
        position: relative; /* anchors the in-place dropdown */
        min-width: 0;
        /* boxel-ui custom-property channel: route Pretui tokens through the
           knobs BoxelSelect exposes (renderInPlace keeps these inheriting
           straight down into the dropdown). Colors without a knob are
           overridden in the :deep() rules below. */
        --boxel-form-control-border-radius: var(--radius);
        /* 10px, not 9px: this trigger spends its hairline as a box-shadow
           with `border: 0`, so 9px of padding puts its text 9px from the box
           edge — while a boxel-ui-backed Input draws a real 1px border and
           puts its text at 1 + 9 = 10px. Stacked, the two were 1px out. */
        --boxel-select-trigger-padding: 0 10px;
        --boxel-select-trigger-gap: 6px;
        --boxel-select-trigger-content-wrap: nowrap;
        --boxel-select-background-color: var(--field, var(--boxel-light));
        --boxel-select-text-color: var(--foreground);
        --boxel-dropdown-background-color: var(--popover);
        --boxel-dropdown-text-color: var(--foreground);
        --boxel-dropdown-hover-color: var(--hover, var(--boxel-100));
        --boxel-dropdown-highlight-color: var(--hover, var(--boxel-100));
        --boxel-dropdown-selected-text-color: var(--foreground);
      }
      /* trigger — dressed to match .pretui-input exactly: hairline rides
         box-shadow (not border) so the box metrics stay identical */
      .pretui-selectwrap :deep(.pretui-selecttrigger) {
        align-items: center;
        height: var(--control-h, 28px);
        border: 0;
        border-radius: var(--radius);
        font: inherit;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        color: var(--foreground);
        background: var(--field, var(--boxel-light));
        box-shadow: 0 0 0 1px var(--input);
        width: 100%;
        text-align: left;
        transition: none;
      }
      .pretui-selectwrap :deep(.pretui-selecttrigger[aria-expanded='true']),
      .pretui-selectwrap :deep(.pretui-selecttrigger:focus-visible) {
        /* The ring rides box-shadow so it costs no layout — but forced-colors
           paints no box-shadow at all, leaving this trigger with no focus
           indicator in high contrast. A transparent outline paints nothing
           normally, never participates in layout, and forced-colors forces
           outline-color to a system colour. boxel-ui's own device. */
        outline: 2px solid transparent;
        outline-offset: 1px;
        box-shadow: 0 0 0 2px var(--primary), var(--pretui-shadow-inset, inset 0 1px 2px rgb(0 0 0 / 0.16));
      }
      .pretui-selectwrap :deep(.pretui-selecttrigger[aria-disabled='true']) {
        opacity: 0.45;
        background: var(--field, var(--boxel-light));
        color: var(--foreground);
      }
      .pretui-selectwrap :deep(.boxel-trigger) {
        width: 100%;
        font: inherit;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
      }
      .pretui-selectwrap :deep(.boxel-trigger-content) {
        min-width: 0;
        overflow: hidden;
      }
      .pretui-selectwrap :deep(.boxel-trigger-placeholder) {
        color: var(--ink-3, var(--boxel-400));
        font: inherit;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
      }
      .pretui-selectwrap :deep(.pretui-selecttrigger svg) {
        flex: none;
        --icon-color: var(--ink-3, var(--boxel-400));
      }
      /* dropdown — the old .pretui-listbox look (popover bg, r10, overlay
         shadow, 4px padding); boxel's own margin-top: 4px matches the old
         @distance 4 */
      .pretui-selectwrap :deep(.pretui-select-dropdown.ember-power-select-dropdown) {
        background: var(--popover);
        border: 0;
        border-radius: 10px;
        box-shadow: var(--pretui-shadow-overlay, 0 0 0 1px var(--border), 0 8px 28px rgb(0 0 0 / 0.16));
        overflow: hidden;
      }
      .pretui-selectwrap :deep(.pretui-select-dropdown.ember-basic-dropdown-content--above) {
        margin-bottom: 4px;
      }
      .pretui-selectwrap :deep(.pretui-select-dropdown ul) {
        padding: 4px;
        gap: 1px;
      }
      .pretui-selectwrap :deep(.pretui-select-dropdown li.ember-power-select-option) {
        min-height: 28px;
        margin: 0;
        padding: 0 8px;
        align-items: center;
        border-radius: 6px;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        background: transparent;
        color: var(--foreground);
        transition: none;
      }
      .pretui-selectwrap :deep(.pretui-select-dropdown li.ember-power-select-option:hover),
      .pretui-selectwrap :deep(.pretui-select-dropdown li.ember-power-select-option--highlighted) {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      /* checked row: bold primary ink; power-select opens with the highlight
         on it, echoing the old traveling highlight's landing spot */
      .pretui-selectwrap :deep(.pretui-select-dropdown li.ember-power-select-option--selected),
      .pretui-selectwrap :deep(.pretui-select-dropdown li.ember-power-select-option--selected:hover),
      .pretui-selectwrap :deep(.pretui-select-dropdown li.ember-power-select-option--selected.ember-power-select-option--highlighted) {
        font-weight: 600;
        color: var(--pretui-primary-ink, var(--primary));
      }
      .pretui-selectwrap :deep(.pretui-select-dropdown li.ember-power-select-option--selected:hover),
      .pretui-selectwrap :deep(.pretui-select-dropdown li.ember-power-select-option--selected.ember-power-select-option--highlighted) {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-selectwrap :deep(.pretui-select-dropdown .boxel-select-option-checkmark-container) {
        width: auto;
      }
      .pretui-selectwrap :deep(.pretui-select-dropdown .boxel-select-option-checkmark) {
        width: 12px;
        height: 12px;
      }
      /* search box (auto-enabled past 7 options) in the Pretui field dress */
      .pretui-selectwrap :deep(.pretui-select-dropdown .ember-power-select-search) {
        padding: 4px 4px 0;
        border-bottom: 0;
      }
      .pretui-selectwrap :deep(.pretui-select-dropdown input.ember-power-select-search-input) {
        height: 24px;
        padding: 0 8px;
        border: 0;
        border-radius: 6px;
        font: inherit;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        color: var(--foreground);
        background: var(--field, var(--boxel-light));
        box-shadow: 0 0 0 1px var(--input);
        width: 100%;
        box-sizing: border-box;
      }
      .pretui-selectwrap :deep(.pretui-select-dropdown input.ember-power-select-search-input:focus) {
        outline: 2px solid transparent;
        outline-offset: -1px;
        border: 0;
        box-shadow: 0 0 0 2px var(--primary);
      }
      .pretui-selectwrap :deep(.pretui-select-dropdown .ember-power-select-option--no-matches-message) {
        min-height: 28px;
        display: flex;
        align-items: center;
        padding: 0 8px;
        color: var(--ink-3, var(--boxel-400));
        font-style: normal;
        font-size: var(--text-ui-md, 12.5px);
        text-align: left;
      }
    </style>
  </template>
}

