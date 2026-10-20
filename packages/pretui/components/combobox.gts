// Pretui — Combobox: a text input with a filtered option list.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { guidFor } from '@ember/object/internals';
import { PoweredValuePicker, SelectedValue } from '../internal/forms-picker';
import type { PickerSelectApi } from '../internal/forms-picker';

// ── Combobox ─────────────────────────────────────────────────────────────
// A free-text input over a filtering listbox, on power-select's engine, for closed sets that are too long to scroll and
// too short to need a server. Where `Select` puts the search
// box INSIDE the dropdown — power-select resolves `searchFieldPosition` to
// 'before-options' for single selects — a combobox must have the text field
// BE the control, which is what the multiple trigger gives. So Combobox
// rides the same multiple engine and caps the selection at one.
//
// ARIA pattern: editable combobox + listbox + aria-activedescendant,
// supplied by power-select. Documented delta: `aria-multiselectable='true'`
// rides along on the listbox.
//
// Not supported, deliberately: accepting a value that is NOT in @options
// ("create on the fly"). That is power-select-with-create, a separate addon
// the realm cannot import.
export interface ComboboxOption {
  /** Stable value emitted through @onValueChange. */
  value: string;
  /** Visible text, and what the local filter matches. */
  label: string;
  /** Optional secondary line in the dropdown row. */
  meta?: string;
}

export interface ComboboxSignature {
  Args: {
    /** The full candidate list. Filtering is local — no fetching here. */
    options: ComboboxOption[];
    /** Controlled value. Omit to let the component hold it. */
    value?: string;
    /** Uncontrolled initial value; ignored once @value is supplied. */
    defaultValue?: string;
    /** Input placeholder. */
    placeholder?: string;
    /** Accessible name for the combobox input. */
    label?: string;
    /** Blocks every interaction. */
    disabled?: boolean;
    /** Error dress plus aria-invalid. */
    invalid?: boolean;
    /** Emitted on every keystroke with the current search text. */
    onSearch?: (query: string) => void;
    /** Emitted with the chosen value, or '' when the value is cleared. */
    onValueChange?: (value: string) => void;
    /** Emitted when the dropdown opens or closes. */
    onOpenChange?: (open: boolean) => void;
  };
  Blocks: {
    /** Replace the default row. Yields the option and the current term. */
    option: [option: ComboboxOption, state: { term: string }];
  };
  Element: HTMLDivElement;
}

export class Combobox extends Component<ComboboxSignature> {
  uid = guidFor(this);
  @tracked internal = this.args.defaultValue ?? '';
  @tracked term = '';

  get value() {
    return this.args.value ?? this.internal;
  }
  get options() {
    return this.args.options ?? [];
  }
  get selectedOptions(): ComboboxOption[] {
    let hit = this.options.find((o) => o.value === this.value);
    return hit ? [hit] : [];
  }
  get label() {
    return this.args.label ?? 'Choose an option';
  }
  get placeholder() {
    return this.args.placeholder ?? 'Type to filter…';
  }
  optionState = () => ({ term: this.term });
  registerApi = (select: PickerSelectApi) => {
    let next = select?.searchText ?? '';
    if (next !== this.term) {
      this.term = next;
      this.args.onSearch?.(next);
    }
  };
  handleChange = (selection: ComboboxOption[]) => {
    let last = selection[selection.length - 1];
    let next = last ? last.value : '';
    if (this.args.value === undefined) {
      this.internal = next;
    }
    this.args.onValueChange?.(next);
  };
  handleOpen = () => {
    this.args.onOpenChange?.(true);
  };
  handleClose = () => {
    this.args.onOpenChange?.(false);
  };

  <template>
    <div
      class='pretui-combobox'
      data-disabled={{if @disabled 'true'}}
      data-invalid={{if @invalid 'true'}}
      data-test-pretui-combobox
      ...attributes
    >
      <PoweredValuePicker
        class='pretui-pickertrigger'
        aria-invalid={{if @invalid 'true'}}
        @options={{this.options}}
        @selected={{this.selectedOptions}}
        @onChange={{this.handleChange}}
        @placeholder={{this.placeholder}}
        @disabled={{@disabled}}
        @searchEnabled={{true}}
        @searchField='label'
        @closeOnSelect={{true}}
        @matchTriggerWidth={{true}}
        @renderInPlace={{true}}
        @dropdownClass='pretui-picker-dropdown'
        @ariaLabel={{this.label}}
        @registerAPI={{this.registerApi}}
        @onOpen={{this.handleOpen}}
        @onClose={{this.handleClose}}
        @selectedItemComponent={{SelectedValue}}
        as |option|
      >
        {{#if (has-block 'option')}}
          {{yield option (this.optionState)}}
        {{else}}
          <span class='pretui-cbx-row'>
            <span class='pretui-cbx-label'>{{option.label}}</span>
            {{#if option.meta}}
              <span class='pretui-cbx-meta'>{{option.meta}}</span>
            {{/if}}
          </span>
        {{/if}}
      </PoweredValuePicker>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-combobox {
          position: relative;
          display: block;
          min-width: 0;
          --boxel-form-control-border-radius: calc(var(--radius) - 0.125rem);
          --boxel-border-radius-sm: calc(var(--radius) - 0.125rem);
          --boxel-select-trigger-padding: 0;
          --boxel-dropdown-background-color: var(--popover);
          --boxel-dropdown-text-color: var(--foreground);
          --boxel-dropdown-hover-color: var(--hover);
          --boxel-dropdown-highlight-color: var(--hover);
          /* the trigger's edge, which invalid repoints */
          --pretui-cbx-edge: var(--input);
        }
        /* the invalid edge marks the field at rest; hover and focus draw the
           field's usual edge, as on Input */
        .pretui-combobox[data-invalid] {
          --pretui-cbx-edge: var(--destructive-ink);
        }
        @media (hover: hover) {
          .pretui-combobox[data-invalid]:hover {
            --pretui-cbx-edge: var(--input);
          }
        }
        .pretui-combobox[data-invalid]:focus-within {
          --pretui-cbx-edge: var(--input);
        }
        .pretui-cbx-row {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
          min-width: 0;
        }
        .pretui-cbx-label {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-cbx-meta {
          margin-left: auto;
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
          white-space: nowrap;
        }
      }
      /* Unlayered: BoxelMultiSelect's power-select rules are unlayered, and
         unlayered CSS beats any layer, so these overrides only win from outside one. */
      .pretui-combobox :deep(.pretui-pickertrigger.ember-power-select-trigger) {
        display: flex;
        align-items: center;
        min-height: var(--boxel-form-control-height-sm);
        /* the content box of a 1.75rem field with a 1px border */
        padding-block: calc(0.125rem - 1px);
        padding-inline: calc(0.25rem - 1px) calc(0.5rem - 1px);
        border: 1px solid var(--pretui-cbx-edge);
        border-radius: calc(var(--radius) - 0.125rem);
        background-color: var(--field);
        color: var(--foreground);
        font-size: var(--boxel-font-size-xs);
        letter-spacing: var(--boxel-lsp-xs);
        /* power-select's 1.75 line-height outgrows the height at 16px */
        line-height: var(--boxel-form-control-line-height-sm);
        width: 100%;
      }
      /* iOS zooms into inputs under 16px on focus */
      @media (pointer: coarse) {
        .pretui-combobox :deep(.pretui-pickertrigger.ember-power-select-trigger) {
          font-size: var(--boxel-form-control-touch-font-size);
        }
      }
      .pretui-combobox
        :deep(.pretui-pickertrigger.ember-power-select-trigger[aria-expanded='true']),
      .pretui-combobox
        :deep(.pretui-pickertrigger.ember-power-select-trigger:focus-within) {
        outline: 2px solid var(--ring);
        outline-offset: -1px;
      }
      .pretui-combobox[data-disabled]
        :deep(.pretui-pickertrigger.ember-power-select-trigger) {
        opacity: 0.45;
        cursor: default;
      }
      .pretui-combobox :deep(ul.ember-power-select-multiple-options) {
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        gap: 4px;
        list-style: none;
        margin: 0;
        padding: 0;
        width: 100%;
        min-width: 0;
      }
      /* single value: the chosen label reads as text, not a capsule */
      .pretui-combobox :deep(li.ember-power-select-multiple-option) {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin: 0;
        padding: 0 0 0 5px;
        border: 0;
        background: none;
        color: var(--foreground);
        max-width: 60%;
        overflow: hidden;
      }
      .pretui-combobox :deep(.ember-power-select-multiple-remove-btn) {
        order: 2;
        display: inline-grid;
        place-content: center;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        color: var(--ink-3, var(--boxel-400));
        cursor: pointer;
        opacity: 1;
        font-size: 12px;
        line-height: 1;
      }
      .pretui-combobox :deep(.ember-power-select-multiple-remove-btn:hover) {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      .pretui-combobox
        :deep(li.ember-power-select-trigger-multiple-input-container) {
        flex: 1 1 6ch;
        min-width: 4ch;
        margin: 0;
      }
      .pretui-combobox :deep(input.ember-power-select-trigger-multiple-input) {
        width: 100%;
        height: 24px;
        margin: 0;
        padding: 0 5px;
        border: 0;
        background: transparent;
        font: inherit;
        letter-spacing: inherit;
        color: var(--foreground);
      }
      .pretui-combobox
        :deep(input.ember-power-select-trigger-multiple-input:focus) {
        outline: none;
      }
      .pretui-combobox
        :deep(input.ember-power-select-trigger-multiple-input::placeholder) {
        color: var(--muted-foreground);
      }
      .pretui-combobox
        :deep(.pretui-picker-dropdown.ember-power-select-dropdown) {
        background: var(--popover);
        border: 0;
        border-radius: 10px;
        box-shadow: var(
          --pretui-shadow-overlay,
          0 0 0 1px var(--border),
          0 8px 28px rgb(0 0 0 / 0.16)
        );
        overflow: hidden;
      }
      .pretui-combobox :deep(.pretui-picker-dropdown ul) {
        padding: 4px;
        gap: 1px;
        max-height: var(--pretui-combobox-max-height, 15rem);
      }
      .pretui-combobox
        :deep(.pretui-picker-dropdown li.ember-power-select-option) {
        min-height: 28px;
        margin: 0;
        padding: 3px 8px;
        align-items: center;
        border-radius: var(--radius-chip, 6px);
        background: transparent;
        color: var(--foreground);
        font-size: var(--text-ui-md, 12.5px);
        transition: none;
      }
      .pretui-combobox
        :deep(.pretui-picker-dropdown li.ember-power-select-option--highlighted),
      .pretui-combobox
        :deep(.pretui-picker-dropdown li.ember-power-select-option:hover) {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-combobox
        :deep(.pretui-picker-dropdown li.ember-power-select-option[aria-selected='true']) {
        font-weight: 600;
        color: var(--pretui-primary-ink, var(--primary));
      }
      .pretui-combobox
        :deep(.pretui-picker-dropdown .ember-power-select-option--no-matches-message) {
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
