// Pretui — DuelingPicklist usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import {
  PLACES,
  TEAS,
  pick,
  seedFrom,
} from '../examples';
import { DuelingPicklist } from './dueling-picklist';
import type { PickerRecord } from '../internal/forms-picker';

// ── DuelingPicklist ← slds dueling-picklist/ ─────────────────────────────
const LOTS: PickerRecord[] = TEAS.slice(0, 9).map((name, i) => ({
  id: `a0X00000${String(i + 31).padStart(2, '0')}`,
  label: name,
  meta: `${pick(seedFrom(name), i, PLACES)} · lot ${1200 + i * 37}`,
  // the house control tea anchors every flight and cannot leave it
  locked: i === 2,
}));

const LOT_IDS = LOTS.map((r) => r.id);

// Dropped SLDS surface: native HTML5 `draggable` on the options (pointer-only,
// no keyboard equivalent, and a rotate(3deg) grabbed transform that ignores
// reduced motion), the modal Space-to-grab reorder mode (replaced by modeless
// Alt+Arrow), and the `dataSet`/snapshot prop shape, whose per-option
// tabIndex/isSelected/isGrabbed flags were authored by hand because nothing
// upstream computed them.
class DuelingPicklistUsage extends Component {
  lots = LOTS;
  lotIds = LOT_IDS;
  @tracked value: string[] = [
    LOTS[1]?.id as string,
    LOTS[2]?.id as string,
    LOTS[5]?.id as string,
  ];
  @tracked availableLabel = 'Cellar lots';
  @tracked selectedLabel = 'Flight order';
  @tracked rows: number | null = 6;
  @tracked reorder = true;
  @tracked disabled = false;
  @tracked required = true;

  setValue = (ids: string[]) => (this.value = ids);
  setAvailableLabel = (v: string) => (this.availableLabel = v);
  setSelectedLabel = (v: string) => (this.selectedLabel = v);
  setRows = (v: number | null) => (this.rows = v);
  setReorder = (v: boolean) => (this.reorder = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setRequired = (v: boolean) => (this.required = v);

  get rowCount() {
    return this.rows ?? 6;
  }
  get usage() {
    let bits = [
      '@options={{this.lots}}',
      '@value={{this.value}}',
      "@label='Cupping flight'",
      `@availableLabel='${this.availableLabel}'`,
      `@selectedLabel='${this.selectedLabel}'`,
      `@rows={{${this.rowCount}}}`,
    ];
    if (!this.reorder) {
      bits.push('@reorder={{false}}');
    }
    if (this.required) {
      bits.push('@required={{true}}');
    }
    if (this.disabled) {
      bits.push('@disabled={{true}}');
    }
    bits.push('@onValueChange={{this.setValue}}');
    return `<DuelingPicklist ${bits.join('\n  ')}\n/>`;
  }

  <template>
    <FreestyleUsage
      @name='DuelingPicklist'
      @description='The two-column transfer control: an available list, a selected list, move and move-all buttons in both directions, and up/down reorder on the selected side. Reach for it when a field is a SET whose ORDER is part of the answer — a cupping flight tasted light to dark, report columns, an approval chain — and when the user needs to see what is NOT chosen as clearly as what is. Both lists are multi-select listboxes with roving tabindex: arrows move the active option, Space toggles, Shift extends, Ctrl/Cmd+A selects all, Ctrl/Cmd plus left/right transfers between lists, and Alt plus up/down reorders. Every move is announced ("Gyokuro and Silver Needle: moved to Flight order.") and focus follows the moved records into the destination list rather than falling to the body. Records marked locked cannot be transferred out. Honest limits: no drag-and-drop (the keyboard and button paths are the complete ones), no grouping or search inside either list, and no virtualization — past a few hundred options, filter before you hand them over.'
      @source={{this.usage}}
    >
      <:example>
        <DuelingPicklist
          @options={{this.lots}}
          @value={{this.value}}
          @label='Cupping flight'
          @availableLabel={{this.availableLabel}}
          @selectedLabel={{this.selectedLabel}}
          @rows={{this.rowCount}}
          @reorder={{this.reorder}}
          @required={{this.required}}
          @disabled={{this.disabled}}
          @onValueChange={{this.setValue}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @required={{true}}
          @description='Every record in play: {id, label, meta?, icon?, locked?}. The two lists are derived from this plus @value — you never hand over two arrays that can drift apart.'
          @value={{this.lots}}
        />
        <Args.Array
          @name='value'
          @description='Controlled selection as an ORDERED list of ids. The order IS the payload — that is the whole reason this control exists rather than a MultiSelect.'
          @value={{this.value}}
          @onInput={{this.setValue}}
        />
        <Args.Base
          @name='defaultValue'
          @type='String[]'
          @description='Uncontrolled initial selection. Ignored once @value is supplied.'
        />
        <Args.Base
          @name='label'
          @type='String'
          @defaultValue='Select options'
          @description='Visible legend, and the accessible name of the whole role=group.'
        />
        <Args.String
          @name='availableLabel'
          @value={{this.availableLabel}}
          @defaultValue='Available'
          @description='Heading over the left list. Also the noun in every "moved to …" announcement and in the move buttons’ accessible names.'
          @onInput={{this.setAvailableLabel}}
        />
        <Args.String
          @name='selectedLabel'
          @value={{this.selectedLabel}}
          @defaultValue='Selected'
          @description='Heading over the right list, same double duty as availableLabel.'
          @onInput={{this.setSelectedLabel}}
        />
        <Args.Number
          @name='rows'
          @value={{this.rows}}
          @min={{3}}
          @max={{12}}
          @defaultValue={{7}}
          @description='Visible rows per list before it scrolls.'
          @onInput={{this.setRows}}
        />
        <Args.Bool
          @name='reorder'
          @defaultValue={{true}}
          @description='Show the up/down reorder column and enable Alt+Arrow reordering. Turn it off when the selection is a set, not a sequence.'
          @value={{this.reorder}}
          @onInput={{this.setReorder}}
        />
        <Args.Bool
          @name='required'
          @defaultValue={{false}}
          @description='Renders the required marker beside the legend. It marks; it never validates.'
          @value={{this.required}}
          @onInput={{this.setRequired}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @description='Blocks every move and dims both lists.'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Action
          @name='onValueChange'
          @description='Fires with the full ordered id list after every transfer or reorder.'
        />
        <Args.Yield
          @name=':option'
          @description='Replaces the option row in BOTH lists. Yields (record, {selected, side}). Defaults to a RecordFace.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_DUELING_PICKLIST: Record<string, unknown> = {
  DuelingPicklist: DuelingPicklistUsage,
};
