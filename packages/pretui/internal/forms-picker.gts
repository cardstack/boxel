// Pretui — the picker record shape and the power-select engine record and value pickers ride; Combobox uses the value side.
import Component from '@glimmer/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { BoxelMultiSelectBasic } from '@cardstack/boxel-ui/components';
import type { ComboboxOption } from '../components/combobox';
import { RecordFace } from '../components/record-face';

// ── PickerRecord ─────────────────────────────────────────────────────────
/**
 * One selectable record. Deliberately a PLAIN VALUE, not a CardDef/FieldDef
 * instance — a picker must be usable before a schema exists (the lesson from
 * the minimum-otter attempt). Salesforce shapes map onto it directly:
 * `id` ← the 18-char record id, `label` ← the Name field, `meta` ← the
 * secondary line SLDS renders as "Account • San Francisco".
 */
export interface PickerRecord {
  /** Stable identity. Selection, ordering and dedupe all key on this. */
  id: string;
  /** Primary line. The only part the term highlight searches. */
  label: string;
  /** Secondary line — object type, owner, location, whatever disambiguates. */
  meta?: string;
  /** Icon NAME from icon-registry (`iconFor`). Falls back to an initials Avatar. */
  icon?: string;
  /**
   * What the dropdown's local filter matches against. Defaults to
   * `label meta id`. Set it when the server matched on something the visible
   * text does not contain (synonyms, account numbers, fuzzy hits) — otherwise
   * power-select's local pass would hide the row the server just returned.
   */
  search?: string;
  /** DuelingPicklist only: the record cannot be transferred out of its list. */
  locked?: boolean;
}

export function phraseFor(labels: string[]): string {
  if (labels.length === 0) {
    return 'No items';
  }
  if (labels.length === 1) {
    return labels[0] as string;
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  if (labels.length <= 4) {
    return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  }
  return `${labels.length} items`;
}
// ── The power-select engine ──────────────────────────────────────────────
// Type-only cast, mirroring Select's `PoweredSelect`: the CLI's
// bundled boxel-ui types import PowerSelectArgs from ember-power-select,
// which the realm type env cannot resolve, so BoxelMultiSelectBasic's
// visible args collapse. Re-assert the surface we actually use; runtime is
// the real BoxelMultiSelectBasic.
//
// `@triggerComponent` is deliberately NOT in this list and never passed —
// leaving it unset is what makes power-select render its own multiple
// trigger, the one with the combobox <input> in the field.

/** The slice of power-select's public API this file reads. */
export interface PickerSelectApi {
  searchText?: string;
  isOpen?: boolean;
  actions?: { close?: () => void; open?: () => void };
}

interface PoweredPickerSignature<T> {
  Args: {
    options: T[];
    selected: T[];
    onChange: (selection: T[], select: PickerSelectApi, event?: Event) => void;
    placeholder?: string;
    disabled?: boolean;
    searchEnabled?: boolean;
    searchField?: string;
    closeOnSelect?: boolean;
    matchTriggerWidth?: boolean;
    renderInPlace?: boolean;
    dropdownClass?: string;
    ariaLabel?: string;
    registerAPI?: (select: PickerSelectApi) => void;
    onOpen?: (select: PickerSelectApi, event?: Event) => void;
    onClose?: (select: PickerSelectApi, event?: Event) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the
    // component arg is a power-select subcomponent contract the realm type
    // env cannot express; runtime shape is checked by the engine.
    selectedItemComponent?: any;
  };
  Blocks: { default: [T, PickerSelectApi] };
  Element: HTMLElement;
}

export const PoweredRecordPicker = BoxelMultiSelectBasic as unknown as new (
  owner: unknown,
  args: PoweredPickerSignature<PickerRecord>['Args'],
) => Component<PoweredPickerSignature<PickerRecord>>;

export const PoweredValuePicker = BoxelMultiSelectBasic as unknown as new (
  owner: unknown,
  args: PoweredPickerSignature<ComboboxOption>['Args'],
) => Component<PoweredPickerSignature<ComboboxOption>>;

// The selected-item component power-select renders inside each trigger pill.
// Given as a component (not a block) so the pill dress differs from the
// option-row dress; power-select yields the same block to both otherwise.
interface SelectedRecordSignature {
  Args: { selected: PickerRecord; select?: PickerSelectApi };
}
export const SelectedRecord: TemplateOnlyComponent<SelectedRecordSignature> = <template>
  <RecordFace @record={{@selected}} @size='sm' />
</template>;

interface SelectedValueSignature {
  Args: { selected: ComboboxOption; select?: PickerSelectApi };
}
export const SelectedValue: TemplateOnlyComponent<SelectedValueSignature> = <template>
  <span class='pretui-cbx-pilltext'>{{@selected.label}}</span>
  <style scoped>
    @layer PretComponent {
      .pretui-cbx-pilltext {
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: 500;
        white-space: nowrap;
      }
    }
  </style>
</template>;
