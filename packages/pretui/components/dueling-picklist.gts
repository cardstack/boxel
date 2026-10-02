// Pretui — DuelingPicklist: move items between an available and a selected list.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { concat, fn, hash } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import { IconButton } from './icon-button';
import { cssNumber } from '../pretui-css';
import { RecordFace } from './record-face';
import { phraseFor } from '../internal/forms-picker';
import type { PickerRecord } from '../internal/forms-picker';

// ── DuelingPicklist ──────────────────────────────────────────────────────
// ARIA pattern: **two multi-select listboxes (`role='listbox'` +
// `aria-multiselectable='true'`) with roving tabindex**, wrapped in a
// `role='group'` named by a visible legend, plus a shared instructions node
// referenced by both lists through `aria-describedby` and an assertive
// `role='status'` region that reports every move.
//
// Keyboard model (implemented, not merely described):
//   ArrowUp / ArrowDown       move the active option and select it alone
//   Shift + ArrowUp/Down      extend the selection from the anchor
//   Home / End                jump to first / last
//   Space                     toggle the active option's selection
//   Ctrl or Cmd + A           select every option in the focused list
//   Ctrl or Cmd + ArrowRight  move the selection to the right-hand list
//   Ctrl or Cmd + ArrowLeft   move the selection to the left-hand list
//   Enter                     move the selection to the other list
//   Alt + ArrowUp/Down        reorder the selection inside the right list

type PicklistSide = 'available' | 'selected';

interface PicklistColumnSignature {
  Args: {
    side: PicklistSide;
    listId: string;
    labelId: string;
    label: string;
    describedBy: string;
    records: PickerRecord[];
    marks: string[];
    activeId: string;
    pendingFocus: string;
    rows: number;
    disabled?: boolean;
    emptyText: string;
    onOptionClick: (record: PickerRecord, e: MouseEvent) => void;
    onKeydown: (e: KeyboardEvent) => void;
  };
  Blocks: {
    default: [record: PickerRecord, state: { selected: boolean; side: PicklistSide }];
  };
  Element: HTMLDivElement;
}

// One labelled listbox column. File-local: the DuelingPicklist is the only
// legitimate composition of it, and keeping it a component (rather than
// duplicating the markup twice) means one keyboard surface, not two.
class PicklistColumn extends Component<PicklistColumnSignature> {
  // focuses its element the moment the pending token names it. A modifier is
  // the realm-legal way to focus AFTER render — no timers, no rAF.
  focusPending = modifier(
    (el: HTMLElement, [token, pending]: [string, string]) => {
      if (token && token === pending) {
        el.focus();
      }
    },
  );
  get boxStyle() {
    return htmlSafe(`--pretui-dl-rows: ${cssNumber(this.args.rows, 1, 64) ?? 7}`);
  }
  /** Roving tabindex needs exactly one reachable option — fall back to the first. */
  get effectiveActiveId() {
    let records = this.args.records ?? [];
    if (records.some((r) => r.id === this.args.activeId)) {
      return this.args.activeId;
    }
    return records[0]?.id ?? '';
  }
  isMarked = (record: PickerRecord) =>
    (this.args.marks ?? []).includes(record.id);
  isActive = (record: PickerRecord) => record.id === this.effectiveActiveId;
  /** Accessible name for the option overlay — children are presentational. */
  nameFor = (record: PickerRecord) => {
    let base = record.meta ? `${record.label}, ${record.meta}` : record.label;
    return record.locked ? `${base}, locked` : base;
  };
  click = (record: PickerRecord, e: Event) => {
    this.args.onOptionClick(record, e as MouseEvent);
  };
  keydown = (e: Event) => {
    this.args.onKeydown(e as KeyboardEvent);
  };
  <template>
    <div class='pretui-dlcol' data-side={{@side}} ...attributes>
      <span class='pretui-dlcol-label' id={{@labelId}}>{{@label}}</span>
      <div
        class='pretui-dlcol-box'
        data-disabled={{if @disabled 'true'}}
        style={{this.boxStyle}}
      >
        <div
          id={{@listId}}
          class='pretui-dlcol-list'
          role='listbox'
          aria-labelledby={{@labelId}}
          aria-describedby={{@describedBy}}
          aria-multiselectable='true'
          aria-disabled={{if @disabled 'true' 'false'}}
        >
          {{#each @records key='id' as |record|}}
            {{! same children-presentational split as Lookup: visible layer
                aria-hidden, option overlay carries name, state and focus }}
            <div class='pretui-dlrow' role='presentation'>
              <span class='pretui-dlrow-face' aria-hidden='true'>
                {{yield
                  record
                  (hash selected=(this.isMarked record) side=@side)
                }}
                {{#if record.locked}}
                  <span class='pretui-dlrow-lock'>
                    <svg
                      width='11'
                      height='11'
                      viewBox='0 0 12 12'
                    ><rect
                        x='2.5'
                        y='5'
                        width='7'
                        height='5.2'
                        rx='1.2'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='1.2'
                      /><path
                        d='M4.2 5V3.8a1.8 1.8 0 0 1 3.6 0V5'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='1.2'
                      /></svg>
                  </span>
                {{/if}}
              </span>
              <div
                class='pretui-dlopt'
                role='option'
                aria-selected={{if (this.isMarked record) 'true' 'false'}}
                aria-disabled={{if record.locked 'true' 'false'}}
                aria-label={{this.nameFor record}}
                tabindex={{if (this.isActive record) '0' '-1'}}
                data-test-pretui-picklist-option={{record.id}}
                {{this.focusPending (concat @side ':' record.id) @pendingFocus}}
                {{on 'click' (fn this.click record)}}
                {{on 'keydown' this.keydown}}
              ></div>
            </div>
          {{/each}}
          {{#unless @records.length}}
            <p class='pretui-dlcol-empty'>{{@emptyText}}</p>
          {{/unless}}
        </div>
      </div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-dlcol {
          display: flex;
          flex-direction: column;
          gap: var(--space-2, 5px);
          min-width: 0;
          flex: 1 1 0;
        }
        .pretui-dlcol-label {
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 500;
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--muted-foreground);
        }
        /* Law 1: depth is hairline + shadow, never a contrast box */
        .pretui-dlcol-box {
          border-radius: var(--radius);
          background: var(--field, var(--boxel-light));
          box-shadow: var(
            --pretui-shadow-control,
            0 0 0 1px var(--input)
          );
          padding: 4px;
          height: calc(var(--pretui-dl-rows, 7) * var(--pretui-dl-row-h, 30px) + 8px);
          overflow: hidden;
        }
        .pretui-dlcol-box[data-disabled] {
          opacity: 0.55;
        }
        .pretui-dlcol-list {
          height: 100%;
          overflow-y: auto;
          display: block;
        }
        .pretui-dlcol-list:focus-visible {
          outline: none;
        }
        .pretui-dlrow {
          position: relative;
          display: block;
          border-radius: var(--radius-chip, 6px);
        }
        .pretui-dlrow-face {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: var(--space-2, 5px);
          min-height: var(--pretui-dl-row-h, 30px);
          padding: 3px 7px;
          pointer-events: none;
          color: var(--foreground);
        }
        .pretui-dlopt {
          position: absolute;
          inset: 0;
          z-index: 0;
          border-radius: var(--radius-chip, 6px);
          cursor: pointer;
          transition: background var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease);
        }
        .pretui-dlrow:hover .pretui-dlopt {
          background: var(--hover, var(--boxel-100));
        }
        /* Law 2: one hue in — fill, hairline and ink all derive from --primary */
        .pretui-dlopt[aria-selected='true'] {
          background: color-mix(
            in oklch,
            var(--primary) 14%,
            var(--card)
          );
          box-shadow: 0 0 0 1px
            color-mix(in oklch, var(--primary) 40%, var(--border));
        }
        .pretui-dlopt:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -1px;
        }
        .pretui-dlopt[aria-disabled='true'] {
          cursor: not-allowed;
        }
        .pretui-dlrow-lock {
          margin-left: auto;
          flex: none;
          display: inline-flex;
          color: var(--ink-3, var(--boxel-400));
        }
        .pretui-dlcol-empty {
          margin: 0;
          padding: var(--space-4, 11px) 7px;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--ink-3, var(--boxel-400));
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-dlopt {
            transition: none;
          }
        }
      }
    </style>
  </template>
}

export interface DuelingPicklistSignature {
  Args: {
    /** Every record in play. The two lists are derived from this + @value. */
    options: PickerRecord[];
    /** Controlled selection as an ORDERED list of ids. Order is the payload. */
    value?: string[];
    /** Uncontrolled initial selection; ignored once @value is supplied. */
    defaultValue?: string[];
    /** Visible group legend and the accessible name of the whole control. */
    label?: string;
    /** Heading over the left list. */
    availableLabel?: string;
    /** Heading over the right list. */
    selectedLabel?: string;
    /** Show the up/down reorder column — true by default. */
    reorder?: boolean;
    /** Blocks every move and dims both lists. */
    disabled?: boolean;
    /** Renders the required marker beside the legend. */
    required?: boolean;
    /** Visible rows per list before it scrolls. Default 7. */
    rows?: number;
    /** Emitted with the full ordered id list after every move. */
    onValueChange?: (ids: string[]) => void;
  };
  Blocks: {
    /** Replace the option row. Yields the record and its state. */
    option: [
      record: PickerRecord,
      state: { selected: boolean; side: PicklistSide },
    ];
  };
  Element: HTMLDivElement;
}

export class DuelingPicklist extends Component<DuelingPicklistSignature> {
  uid = guidFor(this);
  @tracked internal: string[] = this.args.defaultValue ?? [];
  @tracked marksAvailable: string[] = [];
  @tracked marksSelected: string[] = [];
  @tracked activeAvailable = '';
  @tracked activeSelected = '';
  @tracked anchorAvailable = '';
  @tracked anchorSelected = '';
  @tracked message = '';
  @tracked pendingFocus = '';

  get label() {
    return this.args.label ?? 'Select options';
  }
  get availableLabel() {
    return this.args.availableLabel ?? 'Available';
  }
  get selectedLabel() {
    return this.args.selectedLabel ?? 'Selected';
  }
  get rows() {
    return this.args.rows ?? 7;
  }
  get showReorder() {
    return this.args.reorder ?? true;
  }
  get legendId() {
    return `${this.uid}-legend`;
  }
  get instructionsId() {
    return `${this.uid}-instructions`;
  }
  get availableListId() {
    return `${this.uid}-available`;
  }
  get selectedListId() {
    return `${this.uid}-selected`;
  }
  get availableLabelId() {
    return `${this.uid}-available-label`;
  }
  get selectedLabelId() {
    return `${this.uid}-selected-label`;
  }
  get ids(): string[] {
    return this.args.value ?? this.internal;
  }
  get options() {
    return this.args.options ?? [];
  }
  get selectedRecords(): PickerRecord[] {
    let out: PickerRecord[] = [];
    for (let id of this.ids) {
      let record = this.options.find((o) => o.id === id);
      if (record) {
        out.push(record);
      }
    }
    return out;
  }
  get availableRecords(): PickerRecord[] {
    return this.options.filter((o) => !this.ids.includes(o.id));
  }
  get moveRightLabel() {
    return `Move selection to ${this.selectedLabel}`;
  }
  get moveLeftLabel() {
    return `Move selection to ${this.availableLabel}`;
  }
  get moveAllRightLabel() {
    return `Move all to ${this.selectedLabel}`;
  }
  get moveAllLeftLabel() {
    return `Move all to ${this.availableLabel}`;
  }
  get instructions() {
    return (
      'Use the up and down arrow keys to move through a list. ' +
      'Space toggles selection; Shift plus arrows extends it. ' +
      'Command or Control plus the left and right arrow keys move the selection between lists. ' +
      (this.showReorder
        ? 'Option or Alt plus the up and down arrow keys reorder the selected list.'
        : '')
    );
  }
  get canMoveRight() {
    return !this.args.disabled && this.movableIds('available').length > 0;
  }
  get canMoveLeft() {
    return !this.args.disabled && this.movableIds('selected').length > 0;
  }
  get canMoveAllRight() {
    return (
      !this.args.disabled &&
      this.availableRecords.some((r) => !r.locked)
    );
  }
  get canMoveAllLeft() {
    return !this.args.disabled && this.selectedRecords.some((r) => !r.locked);
  }
  get reorderIndexes(): number[] {
    let out: number[] = [];
    for (let id of this.marksSelected) {
      let at = this.ids.indexOf(id);
      if (at >= 0) {
        out.push(at);
      }
    }
    return out.sort((a, b) => a - b);
  }
  get canMoveUp() {
    let idx = this.reorderIndexes;
    return !this.args.disabled && idx.length > 0 && (idx[0] as number) > 0;
  }
  get canMoveDown() {
    let idx = this.reorderIndexes;
    return (
      !this.args.disabled &&
      idx.length > 0 &&
      (idx[idx.length - 1] as number) < this.ids.length - 1
    );
  }

  recordsFor = (side: PicklistSide) =>
    side === 'available' ? this.availableRecords : this.selectedRecords;
  marksFor = (side: PicklistSide) =>
    side === 'available' ? this.marksAvailable : this.marksSelected;
  activeFor = (side: PicklistSide) =>
    side === 'available' ? this.activeAvailable : this.activeSelected;
  anchorFor = (side: PicklistSide) =>
    side === 'available' ? this.anchorAvailable : this.anchorSelected;
  labelFor = (side: PicklistSide) =>
    side === 'available' ? this.availableLabel : this.selectedLabel;
  setMarks = (side: PicklistSide, ids: string[]) => {
    if (side === 'available') {
      this.marksAvailable = ids;
    } else {
      this.marksSelected = ids;
    }
  };
  setActive = (side: PicklistSide, id: string) => {
    if (side === 'available') {
      this.activeAvailable = id;
    } else {
      this.activeSelected = id;
    }
  };
  setAnchor = (side: PicklistSide, id: string) => {
    if (side === 'available') {
      this.anchorAvailable = id;
    } else {
      this.anchorSelected = id;
    }
  };
  focusOn = (side: PicklistSide, id: string) => {
    this.pendingFocus = `${side}:${id}`;
  };
  movableIds = (side: PicklistSide) =>
    this.recordsFor(side)
      .filter((r) => this.marksFor(side).includes(r.id) && !r.locked)
      .map((r) => r.id);
  commit = (next: string[]) => {
    if (this.args.value === undefined) {
      this.internal = next;
    }
    this.args.onValueChange?.(next);
  };

  optionClick = (side: PicklistSide, record: PickerRecord, e: MouseEvent) => {
    if (this.args.disabled) {
      return;
    }
    let records = this.recordsFor(side);
    let marks = this.marksFor(side);
    let anchor = this.anchorFor(side);
    let next: string[];
    if (e.shiftKey && anchor) {
      next = this.rangeIds(records, anchor, record.id);
    } else if (e.metaKey || e.ctrlKey) {
      next = marks.includes(record.id)
        ? marks.filter((id) => id !== record.id)
        : [...marks, record.id];
      this.setAnchor(side, record.id);
    } else {
      next = [record.id];
      this.setAnchor(side, record.id);
    }
    this.setMarks(side, next);
    this.setActive(side, record.id);
  };

  rangeIds = (records: PickerRecord[], fromId: string, toId: string) => {
    let a = records.findIndex((r) => r.id === fromId);
    let b = records.findIndex((r) => r.id === toId);
    if (b < 0) {
      return [];
    }
    if (a < 0) {
      a = b;
    }
    let lo = Math.min(a, b);
    let hi = Math.max(a, b);
    return records.slice(lo, hi + 1).map((r) => r.id);
  };

  transfer = (from: PicklistSide) => {
    if (this.args.disabled) {
      return;
    }
    let moving = this.recordsFor(from).filter(
      (r) => this.marksFor(from).includes(r.id) && !r.locked,
    );
    if (!moving.length) {
      this.message = `Nothing to move from ${this.labelFor(from)}.`;
      return;
    }
    this.applyTransfer(from, moving);
  };

  transferAll = (from: PicklistSide) => {
    if (this.args.disabled) {
      return;
    }
    let moving = this.recordsFor(from).filter((r) => !r.locked);
    if (!moving.length) {
      this.message = `Nothing to move from ${this.labelFor(from)}.`;
      return;
    }
    this.applyTransfer(from, moving);
  };

  applyTransfer = (from: PicklistSide, moving: PickerRecord[]) => {
    let movingIds = moving.map((r) => r.id);
    let to: PicklistSide = from === 'available' ? 'selected' : 'available';
    let next =
      from === 'available'
        ? [...this.ids, ...movingIds]
        : this.ids.filter((id) => !movingIds.includes(id));
    this.commit(next);
    this.setMarks(from, []);
    this.setMarks(to, movingIds);
    let landing = movingIds[0] as string;
    this.setActive(to, landing);
    this.setAnchor(to, landing);
    this.message = `${phraseFor(moving.map((r) => r.label))}: moved to ${this.labelFor(to)}.`;
    // focus follows the records; it is never left on a button that the move
    // just disabled (the failure everyone ships)
    this.focusOn(to, landing);
  };

  reorderSelection = (delta: number) => {
    if (this.args.disabled) {
      return;
    }
    let indexes = this.reorderIndexes;
    if (!indexes.length) {
      this.message = `Select an item in ${this.selectedLabel} first.`;
      return;
    }
    let ids = [...this.ids];
    if (delta < 0) {
      if ((indexes[0] as number) === 0) {
        return;
      }
      for (let at of indexes) {
        let prev = ids[at - 1] as string;
        ids[at - 1] = ids[at] as string;
        ids[at] = prev;
      }
    } else {
      if ((indexes[indexes.length - 1] as number) >= ids.length - 1) {
        return;
      }
      for (let k = indexes.length - 1; k >= 0; k--) {
        let at = indexes[k] as number;
        let nextItem = ids[at + 1] as string;
        ids[at + 1] = ids[at] as string;
        ids[at] = nextItem;
      }
    }
    this.commit(ids);
    let marks = this.marksSelected;
    if (marks.length === 1) {
      let only = marks[0] as string;
      let record = this.options.find((o) => o.id === only);
      this.message = `${record?.label ?? 'Item'}: position ${ids.indexOf(only) + 1} of ${ids.length}.`;
    } else {
      this.message = `${marks.length} items moved ${delta < 0 ? 'up' : 'down'}.`;
    }
    this.focusOn('selected', marks[0] as string);
  };

  moveRight = () => this.transfer('available');
  moveLeft = () => this.transfer('selected');
  moveAllRight = () => this.transferAll('available');
  moveAllLeft = () => this.transferAll('selected');
  moveUp = () => this.reorderSelection(-1);
  moveDown = () => this.reorderSelection(1);

  handleKeydown = (side: PicklistSide, e: KeyboardEvent) => {
    if (this.args.disabled) {
      return;
    }
    let records = this.recordsFor(side);
    if (!records.length) {
      return;
    }
    let found = records.findIndex((r) => r.id === this.activeFor(side));
    let at = found < 0 ? 0 : found;
    let mod = e.metaKey || e.ctrlKey;
    let key = e.key;

    if (mod && (key === 'ArrowRight' || key === 'ArrowLeft')) {
      e.preventDefault();
      let want: PicklistSide = key === 'ArrowRight' ? 'selected' : 'available';
      if (want !== side) {
        this.transfer(side);
      }
      return;
    }
    if (e.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      if (side === 'selected' && this.showReorder) {
        e.preventDefault();
        this.reorderSelection(key === 'ArrowUp' ? -1 : 1);
      }
      return;
    }
    if (mod && (key === 'a' || key === 'A')) {
      e.preventDefault();
      this.setMarks(side, records.map((r) => r.id));
      this.message = `All ${records.length} items in ${this.labelFor(side)} selected.`;
      return;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      let to =
        key === 'ArrowDown'
          ? Math.min(records.length - 1, at + 1)
          : Math.max(0, at - 1);
      let record = records[to];
      if (!record) {
        return;
      }
      this.setActive(side, record.id);
      if (e.shiftKey) {
        let anchor = this.anchorFor(side) || (records[at] as PickerRecord).id;
        this.setAnchor(side, anchor);
        this.setMarks(side, this.rangeIds(records, anchor, record.id));
      } else {
        this.setMarks(side, [record.id]);
        this.setAnchor(side, record.id);
      }
      this.focusOn(side, record.id);
      return;
    }
    if (key === 'Home' || key === 'End') {
      e.preventDefault();
      let record = key === 'Home' ? records[0] : records[records.length - 1];
      if (!record) {
        return;
      }
      this.setActive(side, record.id);
      if (e.shiftKey) {
        let anchor = this.anchorFor(side) || (records[at] as PickerRecord).id;
        this.setMarks(side, this.rangeIds(records, anchor, record.id));
      } else {
        this.setMarks(side, [record.id]);
        this.setAnchor(side, record.id);
      }
      this.focusOn(side, record.id);
      return;
    }
    if (key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      let record = records[at];
      if (!record) {
        return;
      }
      let marks = this.marksFor(side);
      let on = marks.includes(record.id);
      this.setMarks(
        side,
        on ? marks.filter((id) => id !== record.id) : [...marks, record.id],
      );
      this.setAnchor(side, record.id);
      this.message = `${record.label} ${on ? 'unselected' : 'selected'}.`;
      return;
    }
    if (key === 'Enter') {
      e.preventDefault();
      this.transfer(side);
    }
  };

  availableKeydown = (e: KeyboardEvent) => this.handleKeydown('available', e);
  selectedKeydown = (e: KeyboardEvent) => this.handleKeydown('selected', e);
  availableClick = (record: PickerRecord, e: MouseEvent) =>
    this.optionClick('available', record, e);
  selectedClick = (record: PickerRecord, e: MouseEvent) =>
    this.optionClick('selected', record, e);

  <template>
    <div
      class='pretui-dueling'
      role='group'
      aria-labelledby={{this.legendId}}
      data-disabled={{if @disabled 'true'}}
      data-test-pretui-dueling-picklist
      ...attributes
    >
      <span class='pretui-dueling-legend' id={{this.legendId}}>
        {{this.label}}
        {{#if @required}}
          <span class='pretui-dueling-req' aria-hidden='true'>*</span><span class='pretui-dueling-sr'> (required)</span>
        {{/if}}
      </span>

      <p
        class='pretui-dueling-sr'
        id={{this.instructionsId}}
      >{{this.instructions}}</p>

      <div class='pretui-dueling-grid'>
        <PicklistColumn
          @side='available'
          @listId={{this.availableListId}}
          @labelId={{this.availableLabelId}}
          @label={{this.availableLabel}}
          @describedBy={{this.instructionsId}}
          @records={{this.availableRecords}}
          @marks={{this.marksAvailable}}
          @activeId={{this.activeAvailable}}
          @pendingFocus={{this.pendingFocus}}
          @rows={{this.rows}}
          @disabled={{@disabled}}
          @emptyText='Everything has been selected.'
          @onOptionClick={{this.availableClick}}
          @onKeydown={{this.availableKeydown}}
        >
          <:default as |record state|>
            {{#if (has-block 'option')}}
              {{yield record state to='option'}}
            {{else}}
              <RecordFace @record={{record}} />
            {{/if}}
          </:default>
        </PicklistColumn>

        <div class='pretui-dueling-actions' data-axis='horizontal'>
          <IconButton
            @label={{this.moveRightLabel}}
            @variant='secondary'
            disabled={{unless this.canMoveRight true}}
            data-test-pretui-picklist-move-right
            {{on 'click' this.moveRight}}
          >
            <svg
              width='12'
              height='12'
              viewBox='0 0 12 12'
              aria-hidden='true'
            ><path
                d='M4 2.5 7.5 6 4 9.5'
                fill='none'
                stroke='currentColor'
                stroke-width='1.5'
                stroke-linecap='round'
                stroke-linejoin='round'
              /></svg>
          </IconButton>
          <IconButton
            @label={{this.moveLeftLabel}}
            @variant='secondary'
            disabled={{unless this.canMoveLeft true}}
            data-test-pretui-picklist-move-left
            {{on 'click' this.moveLeft}}
          >
            <svg
              width='12'
              height='12'
              viewBox='0 0 12 12'
              aria-hidden='true'
            ><path
                d='M8 2.5 4.5 6 8 9.5'
                fill='none'
                stroke='currentColor'
                stroke-width='1.5'
                stroke-linecap='round'
                stroke-linejoin='round'
              /></svg>
          </IconButton>
          <IconButton
            @label={{this.moveAllRightLabel}}
            @variant='ghost'
            disabled={{unless this.canMoveAllRight true}}
            data-test-pretui-picklist-move-all-right
            {{on 'click' this.moveAllRight}}
          >
            <svg
              width='12'
              height='12'
              viewBox='0 0 12 12'
              aria-hidden='true'
            ><path
                d='M2 2.5 5.5 6 2 9.5 M6.5 2.5 10 6 6.5 9.5'
                fill='none'
                stroke='currentColor'
                stroke-width='1.5'
                stroke-linecap='round'
                stroke-linejoin='round'
              /></svg>
          </IconButton>
          <IconButton
            @label={{this.moveAllLeftLabel}}
            @variant='ghost'
            disabled={{unless this.canMoveAllLeft true}}
            data-test-pretui-picklist-move-all-left
            {{on 'click' this.moveAllLeft}}
          >
            <svg
              width='12'
              height='12'
              viewBox='0 0 12 12'
              aria-hidden='true'
            ><path
                d='M10 2.5 6.5 6 10 9.5 M5.5 2.5 2 6 5.5 9.5'
                fill='none'
                stroke='currentColor'
                stroke-width='1.5'
                stroke-linecap='round'
                stroke-linejoin='round'
              /></svg>
          </IconButton>
        </div>

        <PicklistColumn
          @side='selected'
          @listId={{this.selectedListId}}
          @labelId={{this.selectedLabelId}}
          @label={{this.selectedLabel}}
          @describedBy={{this.instructionsId}}
          @records={{this.selectedRecords}}
          @marks={{this.marksSelected}}
          @activeId={{this.activeSelected}}
          @pendingFocus={{this.pendingFocus}}
          @rows={{this.rows}}
          @disabled={{@disabled}}
          @emptyText='Nothing selected yet.'
          @onOptionClick={{this.selectedClick}}
          @onKeydown={{this.selectedKeydown}}
        >
          <:default as |record state|>
            {{#if (has-block 'option')}}
              {{yield record state to='option'}}
            {{else}}
              <RecordFace @record={{record}} />
            {{/if}}
          </:default>
        </PicklistColumn>

        {{#if this.showReorder}}
          <div class='pretui-dueling-actions' data-axis='vertical'>
            <IconButton
              @label='Move selection up'
              @variant='secondary'
              disabled={{unless this.canMoveUp true}}
              data-test-pretui-picklist-move-up
              {{on 'click' this.moveUp}}
            >
              <svg
                width='12'
                height='12'
                viewBox='0 0 12 12'
                aria-hidden='true'
              ><path
                  d='M2.5 8 6 4.5 9.5 8'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='1.5'
                  stroke-linecap='round'
                  stroke-linejoin='round'
                /></svg>
            </IconButton>
            <IconButton
              @label='Move selection down'
              @variant='secondary'
              disabled={{unless this.canMoveDown true}}
              data-test-pretui-picklist-move-down
              {{on 'click' this.moveDown}}
            >
              <svg
                width='12'
                height='12'
                viewBox='0 0 12 12'
                aria-hidden='true'
              ><path
                  d='M2.5 4.5 6 8 9.5 4.5'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='1.5'
                  stroke-linecap='round'
                  stroke-linejoin='round'
                /></svg>
            </IconButton>
          </div>
        {{/if}}
      </div>

      {{! assertive, and deliberately WITHOUT role='status' — status implies
          polite, and the two together are handled inconsistently. Position
          feedback during a reorder has to interrupt to be useful; SLDS makes
          the same assertive call for its drag live region. }}
      <div
        class='pretui-dueling-sr'
        aria-live='assertive'
        aria-atomic='true'
        data-test-pretui-picklist-live
      >{{this.message}}</div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-dueling {
          /* unnamed container query only — the named forms silently drop every
             later rule in the file through the scoped-CSS transpiler */
          container-type: inline-size;
          display: flex;
          flex-direction: column;
          gap: var(--space-2, 5px);
          min-width: 0;
        }
        .pretui-dueling-legend {
          font-size: var(--text-ui-md, 12.5px);
          font-weight: 500;
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
        }
        .pretui-dueling-req {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
          text-decoration: none;
          margin-left: 2px;
        }
        .pretui-dueling-grid {
          display: flex;
          align-items: flex-start;
          gap: var(--space-3, 8px);
          min-width: 0;
        }
        .pretui-dueling-actions {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: none;
          /* drop past the column heading so the buttons sit beside the boxes */
          padding-top: calc(var(--text-ui-sm, 11.5px) + var(--space-2, 5px) + 6px);
        }
        /* screen-reader-only: instructions + the move announcements. Never
           display:none — a hidden live region never speaks. */
        .pretui-dueling-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
          border: 0;
        }
        @container (max-width: 34rem) {
          .pretui-dueling-grid {
            flex-direction: column;
            align-items: stretch;
          }
          .pretui-dueling-actions {
            flex-direction: row;
            justify-content: center;
            padding-top: 0;
          }
        }
      }
    </style>
  </template>
}

// The Ant name for DuelingPicklist.
