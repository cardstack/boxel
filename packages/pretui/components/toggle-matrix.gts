// Pretui — ToggleMatrix: a grid of toggles with row, column and bulk controls.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { focusWhen, listen, rovingTabindex } from '../focus';
import type { PretuiSize, PretuiTone } from '../pretui-primitives';
import { bulkStateOf, clampIndex, indeterminateWhen, spanBetween } from '../internal/toggle-controls';
import type { BulkState } from '../internal/toggle-controls';

// ─────────────────────────────────────────────────────────────────────────
// ToggleMatrix
// ─────────────────────────────────────────────────────────────────────────

export interface ToggleMatrixRow {
  id: string;
  label: string;
  /** second line under the row label — a role's description, a shift's time */
  hint?: string;
  disabled?: boolean;
}

export interface ToggleMatrixColumn {
  id: string;
  label: string;
  /** short form drawn in the header when the full label will not fit; the
   * full label is still what assistive tech announces */
  abbr?: string;
  disabled?: boolean;
}

/** One switched-on intersection. The public value is an array of these
 * rather than the source's interpolated row-dash-column string keys:
 * stringly-typed coordinates cannot survive an id containing the separator,
 * and they make every consumer write the same split. */
export interface ToggleCell {
  row: string;
  column: string;
}

/**
 * The separator for internal lookup keys. U+001F INFORMATION SEPARATOR ONE —
 * written as an escape, never as a literal, because a raw control character
 * in a realm source file makes the lint endpoint 500 with a Postgres stack
 * trace (bug report 2026-08-13). The source used `-`, which collides with
 * every id that contains one.
 */
export const CELL_SEPARATOR = '\u001f';

/** Internal lookup key for one intersection. */
export function cellKey(row: string, column: string): string {
  return row + CELL_SEPARATOR + column;
}

export function cellKeySet(cells: readonly ToggleCell[]): Set<string> {
  return new Set(cells.map((cell) => cellKey(cell.row, cell.column)));
}

export interface CellView {
  key: string;
  rowId: string;
  columnId: string;
  r: number;
  c: number;
  on: boolean;
  off: boolean;
  label: string;
  roving: boolean;
  focusTarget: boolean;
  /** first column of a scanning group — draws the heavier rule */
  groupEdge: boolean;
  current: boolean;
}

export interface HeadView {
  key: string;
  c: number;
  label: string;
  shown: string;
  abbreviated: boolean;
  state: BulkState;
  checked: boolean;
  mixed: boolean;
  off: boolean;
  roving: boolean;
  focusTarget: boolean;
  bulkLabel: string;
  groupEdge: boolean;
  current: boolean;
}

export interface CornerView {
  state: BulkState;
  checked: boolean;
  mixed: boolean;
  off: boolean;
  roving: boolean;
  focusTarget: boolean;
  bulkLabel: string;
}

export interface RowView {
  key: string;
  r: number;
  label: string;
  hint: string | undefined;
  state: BulkState;
  checked: boolean;
  mixed: boolean;
  off: boolean;
  roving: boolean;
  focusTarget: boolean;
  bulkLabel: string;
  cells: CellView[];
}

export interface ToggleMatrixSignature {
  Args: {
    rows: ToggleMatrixRow[];
    columns: ToggleMatrixColumn[];
    /** the grid's accessible name — required, for the same reason as
     * ToggleGroup's */
    label: string;
    /** controlled value: every switched-on intersection */
    value?: readonly ToggleCell[];
    /** uncontrolled seed */
    defaultValue?: readonly ToggleCell[];
    /** fires with the whole next value, always in rows × columns order */
    onValueChange?: (cells: ToggleCell[]) => void;
    /** fires once per cell that actually changed, including inside a bulk or
     * span operation — so an audit log gets individual grants, not a diff */
    onToggle?: (row: string, column: string, on: boolean) => void;
    /** name for the header of the row axis, e.g. `'Role'` (default `''`) */
    rowAxisLabel?: string;
    /** show the row / column / whole-matrix select-all checkboxes
     * (default `true`) */
    bulk?: boolean;
    /** draw a heavier rule before every Nth column — the scanning aid the
     * beat-maker hardcoded as three `(eq step 4)` comparisons */
    groupEvery?: number;
    /** id of a column to mark as current (a playhead, today, the live shift).
     * Marked with `aria-current` and a caret, never with colour alone. */
    activeColumn?: string;
    /** dims and inerts the whole grid */
    disabled?: boolean;
    /** size scale for the cells */
    size?: PretuiSize;
    /** hue for switched-on cells (Appendix E), default `primary` */
    tone?: PretuiTone;
  };
  Blocks: {
    /** replaces the built-in "nothing to show" line */
    empty: [];
  };
  Element: HTMLDivElement;
}

// **From:** `d8403b-beat-maker-studio-card/beat-maker.gts` (the step grid),
// with the music thrown away.
//
// **Better than the inspiration**, on every count the audit raised:
//
//  * **Data-driven.** Rows and columns are arrays with ids; the 4-column
//    scanning accent is `@groupEvery`, not three hardcoded comparisons.
//  * **Every cell has a name and a state.** The source's pads were empty
//    `<button>`s whose only signal was a class — unnamed buttons with
//    colour-only state. Here each carries `aria-pressed` and a computed
//    `"row, column"` name, plus a drawn check that survives greyscale.
//  * **Real header semantics.** `<table role='grid'>` with `<th scope>`, so a
//    reader browsing the table hears which row and column a cell belongs to;
//    the computed cell name carries the same two facts in focus mode, where
//    header association is not announced. The redundancy is deliberate —
//    `@cellLabel`-style renaming is the caller's job via `@rows`/`@columns`.
//  * **Two-axis keyboard.** Arrows in both directions, Home/End along the
//    row, Ctrl+Home/End to the corners, one tab stop for the whole grid.
//    The headers are row −1 and column −1 of the same navigation space, so
//    the select-all controls are reachable by arrowing rather than by Tab.
//  * **Shift to extend, in both input modes.** Drag-to-paint was considered
//    and rejected: `{{on 'pointerdown'}}` is forbidden by realm lint, a
//    `mousedown` fallback is dead on touch, and a drag has no keyboard
//    equivalent. Shift-activate paints the rectangle from the anchor with the
//    anchor's value — which is the spreadsheet idiom readers already know,
//    is precise rather than approximate, and is **identical from the
//    keyboard** (Shift+Arrow). Strictly better than the gesture it replaces.
//  * `Math.random()` is gone (realm law), the two viewport `@media` queries
//    are a container query, the three `outline: none`s are `:focus-visible`
//    rings, and no `any` appears outside the icon registry's own contract.
export class ToggleMatrix extends Component<ToggleMatrixSignature> {
  @tracked private internal: ToggleCell[] = [
    ...(this.args.defaultValue ?? []),
  ];
  /** navigation cursor. −1 on either axis is the header lane. */
  @tracked private cursorRow = 0;
  @tracked private cursorCol = 0;
  /** the origin of a shift-extend, set by every un-shifted activation */
  @tracked private anchorRow: number | undefined;
  @tracked private anchorCol: number | undefined;
  @tracked private navigating = false;

  get rows(): ToggleMatrixRow[] {
    return this.args.rows ?? [];
  }
  get columns(): ToggleMatrixColumn[] {
    return this.args.columns ?? [];
  }
  get hasGrid(): boolean {
    return this.rows.length > 0 && this.columns.length > 0;
  }
  get bulk(): boolean {
    return this.args.bulk ?? true;
  }
  get tone(): PretuiTone {
    return this.args.tone ?? 'primary';
  }
  get cells(): readonly ToggleCell[] {
    return this.args.value ?? this.internal;
  }
  private get keys(): Set<string> {
    return cellKeySet(this.cells);
  }
  /** the first navigable index on each axis: −1 when the select-all lane
   * exists, 0 when it does not */
  private get lowIndex(): number {
    return this.bulk ? -1 : 0;
  }

  private rowAt(r: number): ToggleMatrixRow | undefined {
    return this.rows[r];
  }
  private columnAt(c: number): ToggleMatrixColumn | undefined {
    return this.columns[c];
  }
  private cellOff(r: number, c: number): boolean {
    return Boolean(
      this.args.disabled || this.rowAt(r)?.disabled || this.columnAt(c)?.disabled,
    );
  }
  private isOn(r: number, c: number): boolean {
    let row = this.rowAt(r);
    let column = this.columnAt(c);
    if (!row || !column) {
      return false;
    }
    return this.keys.has(cellKey(row.id, column.id));
  }
  private isRoving(r: number, c: number): boolean {
    return this.cursorRow === r && this.cursorCol === c;
  }
  private isFocusTarget(r: number, c: number): boolean {
    return this.navigating && this.isRoving(r, c);
  }

  /** The whole render model, computed once per change. Keeping the geometry
   * in TypeScript is what lets the template stay free of index arithmetic —
   * and of the numeric path segments Glimmer's transpiler rejects. */
  get corner(): CornerView {
    let live = this.keys;
    let total = 0;
    let lit = 0;
    let off = true;
    for (let r = 0; r < this.rows.length; r++) {
      for (let c = 0; c < this.columns.length; c++) {
        if (this.cellOff(r, c)) {
          continue;
        }
        off = false;
        total++;
        if (live.has(cellKey(this.rows[r].id, this.columns[c].id))) {
          lit++;
        }
      }
    }
    let state = bulkStateOf(lit, total);
    return {
      state,
      checked: state === 'all',
      mixed: state === 'some',
      off,
      roving: this.isRoving(-1, -1),
      focusTarget: this.isFocusTarget(-1, -1),
      bulkLabel:
        state === 'all' ? 'Clear every cell' : 'Select every cell',
    };
  }

  get heads(): HeadView[] {
    let live = this.keys;
    let every = this.args.groupEvery ?? 0;
    return this.columns.map((column, c) => {
      let total = 0;
      let lit = 0;
      let off = true;
      for (let r = 0; r < this.rows.length; r++) {
        if (this.cellOff(r, c)) {
          continue;
        }
        off = false;
        total++;
        if (live.has(cellKey(this.rows[r].id, column.id))) {
          lit++;
        }
      }
      let state = bulkStateOf(lit, total);
      return {
        key: column.id,
        c,
        label: column.label,
        shown: column.abbr ?? column.label,
        abbreviated: column.abbr !== undefined,
        state,
        checked: state === 'all',
        mixed: state === 'some',
        off,
        roving: this.isRoving(-1, c),
        focusTarget: this.isFocusTarget(-1, c),
        bulkLabel:
          (state === 'all' ? 'Clear column ' : 'Select column ') + column.label,
        groupEdge: every > 0 && c > 0 && c % every === 0,
        current: this.args.activeColumn === column.id,
      };
    });
  }

  get body(): RowView[] {
    let live = this.keys;
    let every = this.args.groupEvery ?? 0;
    return this.rows.map((row, r) => {
      let total = 0;
      let lit = 0;
      let off = true;
      let cells: CellView[] = this.columns.map((column, c) => {
        let cellIsOff = this.cellOff(r, c);
        let isLive = live.has(cellKey(row.id, column.id));
        if (!cellIsOff) {
          off = false;
          total++;
          if (isLive) {
            lit++;
          }
        }
        return {
          key: row.id + '/' + column.id,
          rowId: row.id,
          columnId: column.id,
          r,
          c,
          on: isLive,
          off: cellIsOff,
          label: row.label + ', ' + column.label,
          roving: this.isRoving(r, c),
          focusTarget: this.isFocusTarget(r, c),
          groupEdge: every > 0 && c > 0 && c % every === 0,
          current: this.args.activeColumn === column.id,
        };
      });
      let state = bulkStateOf(lit, total);
      return {
        key: row.id,
        r,
        label: row.label,
        hint: row.hint,
        state,
        checked: state === 'all',
        mixed: state === 'some',
        off,
        roving: this.isRoving(r, -1),
        focusTarget: this.isFocusTarget(r, -1),
        bulkLabel: (state === 'all' ? 'Clear row ' : 'Select row ') + row.label,
        cells,
      };
    });
  }

  // ── mutation ───────────────────────────────────────────────────────────

  /** Rebuilds the public value from a key set, in rows × columns order, so
   * two identical selections always serialize identically. */
  private commit(next: Set<string>) {
    let out: ToggleCell[] = [];
    for (let row of this.rows) {
      for (let column of this.columns) {
        if (next.has(cellKey(row.id, column.id))) {
          out.push({ row: row.id, column: column.id });
        }
      }
    }
    if (this.args.value === undefined) {
      this.internal = out;
    }
    this.args.onValueChange?.(out);
  }

  /** Sets every enabled cell in an inclusive rectangle to `want`, emits one
   * `onToggle` per real change and one `onValueChange` for the batch. */
  private paint(r0: number, c0: number, r1: number, c1: number, want: boolean) {
    let [rLow, rHigh] = spanBetween(r0, r1);
    let [cLow, cHigh] = spanBetween(c0, c1);
    let next = this.keys;
    let changed: ToggleCell[] = [];
    for (let r = rLow; r <= rHigh; r++) {
      for (let c = cLow; c <= cHigh; c++) {
        let row = this.rowAt(r);
        let column = this.columnAt(c);
        if (!row || !column || this.cellOff(r, c)) {
          continue;
        }
        let key = cellKey(row.id, column.id);
        if (want === next.has(key)) {
          continue;
        }
        if (want) {
          next.add(key);
        } else {
          next.delete(key);
        }
        changed.push({ row: row.id, column: column.id });
      }
    }
    if (!changed.length) {
      return;
    }
    this.commit(next);
    for (let cell of changed) {
      this.args.onToggle?.(cell.row, cell.column, want);
    }
  }

  private setAnchor(r: number, c: number) {
    this.anchorRow = r;
    this.anchorCol = c;
  }

  private extendFromAnchor(r: number, c: number) {
    let ar = this.anchorRow;
    let ac = this.anchorCol;
    if (ar === undefined || ac === undefined) {
      this.setAnchor(r, c);
      return;
    }
    this.paint(ar, ac, r, c, this.isOn(ar, ac));
  }

  activateCell = (cell: CellView, event: Event) => {
    if (cell.off) {
      return;
    }
    let ev = event as MouseEvent;
    this.navigating = false;
    this.cursorRow = cell.r;
    this.cursorCol = cell.c;
    if (ev.shiftKey && this.anchorRow !== undefined) {
      this.extendFromAnchor(cell.r, cell.c);
      return;
    }
    this.setAnchor(cell.r, cell.c);
    this.paint(cell.r, cell.c, cell.r, cell.c, !cell.on);
  };

  // The bulk boxes are `aria-disabled`, never `disabled`: they hold navigation
  // stops in the header lane, and a natively disabled control cannot be
  // focused — the roving tab stop would land somewhere unreachable and the
  // grid would have no way in. Cancelling the click is what keeps an inert
  // box from flipping its own checkmark; a checkbox reverts its checkedness
  // when its activation behaviour is cancelled, which is exactly the hook the
  // platform provides for this.
  toggleRow = (view: RowView, event: Event) => {
    this.navigating = false;
    this.cursorRow = view.r;
    this.cursorCol = -1;
    if (view.off) {
      event.preventDefault();
      return;
    }
    this.paint(view.r, 0, view.r, this.columns.length - 1, view.state !== 'all');
    this.resync(event, this.body[view.r]?.checked);
  };

  toggleColumn = (head: HeadView, event: Event) => {
    this.navigating = false;
    this.cursorRow = -1;
    this.cursorCol = head.c;
    if (head.off) {
      event.preventDefault();
      return;
    }
    this.paint(0, head.c, this.rows.length - 1, head.c, head.state !== 'all');
    this.resync(event, this.heads[head.c]?.checked);
  };

  toggleAll = (event: Event) => {
    let corner = this.corner;
    this.navigating = false;
    this.cursorRow = -1;
    this.cursorCol = -1;
    if (corner.off) {
      event.preventDefault();
      return;
    }
    this.paint(
      0,
      0,
      this.rows.length - 1,
      this.columns.length - 1,
      corner.state !== 'all',
    );
    this.resync(event, this.corner.checked);
  };

  // The browser has already flipped the bulk checkbox; with a controlled
  // @value the owner may not take the change, so set it from the state.
  private resync(event: Event, checked: boolean | undefined) {
    if (checked !== undefined) {
      (event.target as HTMLInputElement).checked = checked;
    }
  }

  // ── keyboard ───────────────────────────────────────────────────────────

  private moveTo(r: number, c: number, extend: boolean) {
    let low = this.lowIndex;
    let nextR = clampIndex(r, low, this.rows.length - 1);
    let nextC = clampIndex(c, low, this.columns.length - 1);
    this.navigating = true;
    this.cursorRow = nextR;
    this.cursorCol = nextC;
    // extending only means anything between two real cells; a header is a
    // command, not a corner of a rectangle
    if (extend && nextR >= 0 && nextC >= 0) {
      this.extendFromAnchor(nextR, nextC);
    }
  }

  onKeydown = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (ev.altKey) {
      return;
    }
    let jump = ev.ctrlKey || ev.metaKey;
    let key = ev.key;
    let r = this.cursorRow;
    let c = this.cursorCol;
    let low = this.lowIndex;
    if (jump && key !== 'Home' && key !== 'End') {
      return;
    }
    if (key === 'ArrowRight') {
      this.moveTo(r, c + 1, ev.shiftKey);
    } else if (key === 'ArrowLeft') {
      this.moveTo(r, c - 1, ev.shiftKey);
    } else if (key === 'ArrowDown') {
      this.moveTo(r + 1, c, ev.shiftKey);
    } else if (key === 'ArrowUp') {
      this.moveTo(r - 1, c, ev.shiftKey);
    } else if (key === 'Home') {
      this.moveTo(jump ? low : r, low, ev.shiftKey);
    } else if (key === 'End') {
      this.moveTo(
        jump ? this.rows.length - 1 : r,
        this.columns.length - 1,
        ev.shiftKey,
      );
    } else {
      return;
    }
    // Space/Enter are never intercepted — the focused element is a real
    // <button> or <input type=checkbox> and the platform already owns them
    ev.preventDefault();
  };

  onFocusIn = (event: Event) => {
    let target = event.target as HTMLElement | null;
    let holder = target?.closest('[data-tm-r]') as HTMLElement | null;
    if (!holder) {
      return;
    }
    let r = Number(holder.dataset.tmR);
    let c = Number(holder.dataset.tmC);
    if (Number.isNaN(r) || Number.isNaN(c)) {
      return;
    }
    if (r === this.cursorRow && c === this.cursorCol) {
      return;
    }
    this.navigating = false;
    this.cursorRow = r;
    this.cursorCol = c;
  };

  <template>
    <div
      class='pretui-tm'
      data-tone={{this.tone}}
      data-size={{@size}}
      data-disabled={{if @disabled 'true'}}
      data-test-pretui-toggle-matrix
      ...attributes
    >
      {{#if this.hasGrid}}
        <div class='pretui-tm-scroll'>
          <table
            class='pretui-tm-grid'
            role='grid'
            aria-label={{@label}}
            aria-disabled={{if @disabled 'true'}}
            {{listen 'keydown' this.onKeydown}}
            {{listen 'focusin' this.onFocusIn}}
          >
            <thead>
              <tr>
                <th
                  scope='col'
                  class='pretui-tm-corner'
                  aria-label={{if @rowAxisLabel @rowAxisLabel 'Row'}}
                >
                  {{#if this.bulk}}
                    {{#let this.corner as |corner|}}
                      <input
                        type='checkbox'
                        class='pretui-tm-bulk'
                        aria-label={{corner.bulkLabel}}
                        aria-disabled={{if corner.off 'true'}}
                        checked={{corner.checked}}
                        data-tm-r='-1'
                        data-tm-c='-1'
                        data-test-pretui-toggle-matrix-all
                        {{indeterminateWhen corner.mixed}}
                        {{rovingTabindex corner.roving}}
                        {{focusWhen corner.focusTarget}}
                        {{on 'click' this.toggleAll}}
                      />
                    {{/let}}
                  {{/if}}
                  {{#if @rowAxisLabel}}
                    <span class='pretui-tm-axis' aria-hidden='true'>
                      {{@rowAxisLabel}}
                    </span>
                  {{/if}}
                </th>
                {{#each this.heads key='key' as |head|}}
                  <th
                    scope='col'
                    class='pretui-tm-head'
                    aria-label={{head.label}}
                    aria-current={{if head.current 'true'}}
                    data-group-edge={{if head.groupEdge 'true'}}
                    data-current={{if head.current 'true'}}
                  >
                    {{#if head.current}}
                      <span class='pretui-tm-caret' aria-hidden='true'></span>
                    {{/if}}
                    <span class='pretui-tm-headtext' aria-hidden='true'>
                      {{head.shown}}
                    </span>
                    {{#if this.bulk}}
                      <input
                        type='checkbox'
                        class='pretui-tm-bulk'
                        aria-label={{head.bulkLabel}}
                        aria-disabled={{if head.off 'true'}}
                        checked={{head.checked}}
                        data-tm-r='-1'
                        data-tm-c={{head.c}}
                        data-test-pretui-toggle-matrix-col={{head.key}}
                        {{indeterminateWhen head.mixed}}
                        {{rovingTabindex head.roving}}
                        {{focusWhen head.focusTarget}}
                        {{on 'click' (fn this.toggleColumn head)}}
                      />
                    {{/if}}
                  </th>
                {{/each}}
              </tr>
            </thead>
            <tbody>
              {{#each this.body key='key' as |line|}}
                <tr>
                  <th scope='row' class='pretui-tm-rowhead' aria-label={{line.label}}>
                    {{#if this.bulk}}
                      <input
                        type='checkbox'
                        class='pretui-tm-bulk'
                        aria-label={{line.bulkLabel}}
                        aria-disabled={{if line.off 'true'}}
                        checked={{line.checked}}
                        data-tm-r={{line.r}}
                        data-tm-c='-1'
                        data-test-pretui-toggle-matrix-row={{line.key}}
                        {{indeterminateWhen line.mixed}}
                        {{rovingTabindex line.roving}}
                        {{focusWhen line.focusTarget}}
                        {{on 'click' (fn this.toggleRow line)}}
                      />
                    {{/if}}
                    <span class='pretui-tm-rowtext' aria-hidden='true'>
                      <span class='pretui-tm-rowname'>{{line.label}}</span>
                      {{#if line.hint}}
                        <span class='pretui-tm-rowhint'>{{line.hint}}</span>
                      {{/if}}
                    </span>
                  </th>
                  {{#each line.cells key='key' as |cell|}}
                    <td
                      class='pretui-tm-cell'
                      data-group-edge={{if cell.groupEdge 'true'}}
                      data-current={{if cell.current 'true'}}
                    >
                      <button
                        type='button'
                        class='pretui-tm-pad'
                        aria-pressed={{if cell.on 'true' 'false'}}
                        aria-disabled={{if cell.off 'true'}}
                        aria-label={{cell.label}}
                        data-tm-r={{cell.r}}
                        data-tm-c={{cell.c}}
                        data-state={{if cell.on 'on' 'off'}}
                        data-test-pretui-toggle-matrix-cell={{cell.key}}
                        {{rovingTabindex cell.roving}}
                        {{focusWhen cell.focusTarget}}
                        {{on 'click' (fn this.activateCell cell)}}
                      >
                        <span class='pretui-tm-mark' aria-hidden='true'></span>
                      </button>
                    </td>
                  {{/each}}
                </tr>
              {{/each}}
            </tbody>
          </table>
        </div>
      {{else}}
        {{#if (has-block 'empty')}}
          {{yield to='empty'}}
        {{else}}
          <p class='pretui-tm-none' data-test-pretui-toggle-matrix-empty>
            Nothing to show
          </p>
        {{/if}}
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-tm {
          container-type: inline-size;
          display: block;
          font-size: var(--pretui-size-m, var(--text-ui-md, 0.78rem));
          --pretui-tm-tone: var(--primary);
          --pretui-tm-on: var(--primary-foreground);
        }
        .pretui-tm[data-size='xs'] {
          font-size: var(--pretui-size-xs, var(--text-ui-xs, 0.66rem));
        }
        .pretui-tm[data-size='s'] {
          font-size: var(--pretui-size-s, var(--text-ui-sm, 0.72rem));
        }
        .pretui-tm[data-size='l'] {
          font-size: var(--pretui-size-l, var(--text-ui-lg, 0.875rem));
        }
        .pretui-tm[data-size='xl'] {
          font-size: var(--pretui-size-xl, var(--text-ui-xl, 1rem));
        }
        .pretui-tm[data-tone='neutral'] {
          --pretui-tm-tone: var(--foreground);
          --pretui-tm-on: var(--pretui-on-neutral, var(--background));
        }
        .pretui-tm[data-tone='info'] {
          --pretui-tm-tone: var(--pretui-info, var(--boxel-blue));
          --pretui-tm-on: var(--pretui-on-info, var(--background));
        }
        .pretui-tm[data-tone='success'] {
          --pretui-tm-tone: var(--success, var(--boxel-success));
          --pretui-tm-on: var(--pretui-on-success, var(--background));
        }
        .pretui-tm[data-tone='warning'] {
          --pretui-tm-tone: var(--warning, var(--boxel-warning));
          --pretui-tm-on: var(--pretui-on-warning, var(--background));
        }
        .pretui-tm[data-tone='danger'] {
          --pretui-tm-tone: var(--destructive);
          --pretui-tm-on: var(--destructive-foreground);
        }
        .pretui-tm[data-tone='attention'] {
          --pretui-tm-tone: var(--pretui-attention, var(--boxel-fuschia));
          --pretui-tm-on: var(--pretui-on-attention, var(--background));
        }
        .pretui-tm[data-disabled='true'] {
          opacity: 0.55;
        }
        /* A matrix is wider than its pane far more often than not, so the
           grid scrolls inside the component and the row header stays put —
           a permissions row is unreadable once its name has scrolled away. */
        .pretui-tm-scroll {
          overflow-x: auto;
          overscroll-behavior-x: contain;
        }
        .pretui-tm-grid {
          border-collapse: separate;
          border-spacing: 0;
          font: inherit;
        }
        .pretui-tm-corner,
        .pretui-tm-rowhead {
          position: sticky;
          inset-inline-start: 0;
          z-index: var(--pretui-z-raised, 1);
          background: var(--card);
          text-align: start;
          font-weight: 500;
          vertical-align: middle;
          padding: 0.3em 0.7em 0.3em 0.2em;
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }
        .pretui-tm-corner {
          border-bottom: 1px solid var(--border);
        }
        .pretui-tm-rowhead {
          border-bottom: 1px solid
            color-mix(in oklch, var(--border) 55%, transparent);
        }
        .pretui-tm-axis {
          margin-inline-start: 0.4em;
          font-size: 0.85em;
          text-transform: uppercase;
          letter-spacing: var(--track-eyebrow, 0.06em);
          color: var(--muted-foreground);
        }
        .pretui-tm-rowtext {
          display: inline-flex;
          flex-direction: column;
          gap: 0.1em;
          margin-inline-start: 0.4em;
          min-width: 0;
          vertical-align: middle;
        }
        .pretui-tm-rowname {
          color: var(--foreground);
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-tm-rowhint {
          font-size: 0.84em;
          font-weight: 400;
          color: var(--muted-foreground);
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-tm-head {
          padding: 0.3em 0.2em 0.5em;
          vertical-align: bottom;
          font-weight: 500;
          border-bottom: 1px solid var(--border);
        }
        .pretui-tm-headtext {
          display: block;
          font-size: 0.9em;
          color: var(--muted-foreground);
          font-variant-numeric: tabular-nums;
        }
        /* The current column is announced by aria-current and drawn as a
           caret — a tint alone would be invisible in greyscale and to anyone
           who cannot separate the two hues. */
        .pretui-tm-caret {
          display: block;
          margin: 0 auto 0.15em;
          width: 0;
          height: 0;
          border-inline: 0.34em solid transparent;
          border-block-start: 0.4em solid var(--pretui-tm-tone);
        }
        .pretui-tm-head[data-current='true'] .pretui-tm-headtext {
          color: var(--foreground);
          font-weight: 600;
        }
        .pretui-tm-cell {
          padding: 0.1em;
          text-align: center;
        }
        .pretui-tm-cell[data-current='true'] {
          background: color-mix(
            in oklch,
            var(--pretui-tm-tone) 7%,
            transparent
          );
        }
        .pretui-tm-cell[data-group-edge='true'],
        .pretui-tm-head[data-group-edge='true'] {
          border-inline-start: 1px solid var(--border);
        }
        .pretui-tm-pad {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: var(--pretui-togglematrix-cell, 2em);
          height: var(--pretui-togglematrix-cell, 2em);
          padding: 0;
          border: 0;
          border-radius: var(--pretui-togglematrix-radius, 0.42em);
          background: var(--inset, var(--boxel-100));
          box-shadow: inset 0 0 0 1px
            color-mix(in oklch, var(--border) 70%, transparent);
          cursor: pointer;
          transition: background 140ms var(--pretui-ease-snap, cubic-bezier(.3,.85,.3,1)),
            box-shadow 140ms var(--pretui-ease-snap, cubic-bezier(.3,.85,.3,1));
        }
        .pretui-tm-pad:hover {
          background: var(--hover, var(--boxel-100));
        }
        /* One consistent press, matching Button's `.pretui-btn:active`, so
           this file does not introduce a second press vocabulary. Excluded on
           aria-disabled, which stays focusable. */
        .pretui-tm-pad:active:not([aria-disabled='true']) {
          transform: translateY(0.5px);
        }
        .pretui-tm-pad:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-tm-pad[aria-disabled='true'] {
          cursor: default;
          opacity: 0.4;
        }
        .pretui-tm-pad[data-state='on'] {
          background: var(--pretui-tm-tone);
          box-shadow: inset 0 0 0 1px
            color-mix(in oklch, var(--pretui-tm-tone) 70%, var(--border));
        }
        /* The drawn check is the non-colour channel: a switched-on cell is a
           different SHAPE, not only a different hue. */
        .pretui-tm-mark {
          width: 0.62em;
          height: 0.34em;
          border-inline-start: 2px solid var(--pretui-tm-on);
          border-block-end: 2px solid var(--pretui-tm-on);
          transform: translateY(-0.08em) rotate(-45deg);
          opacity: 0;
          transition: opacity 120ms var(--pretui-ease-snap, cubic-bezier(.3,.85,.3,1));
        }
        .pretui-tm-pad[data-state='on'] .pretui-tm-mark {
          opacity: 1;
        }
        .pretui-tm-bulk {
          margin: 0;
          width: 0.95em;
          height: 0.95em;
          accent-color: var(--pretui-tm-tone);
          vertical-align: middle;
          cursor: pointer;
        }
        .pretui-tm-bulk:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-tm-none {
          margin: 0;
          font-size: var(--text-ui-sm, 11.5px);
          font-style: italic;
          color: var(--muted-foreground);
        }
        /* A card knows its pane, not the viewport (unnamed query only — the
           named form silently deletes every rule after it). */
        @container (max-width: 30rem) {
          .pretui-tm-rowhint {
            display: none;
          }
          .pretui-tm-axis {
            display: none;
          }
        }
        @media (any-pointer: coarse) {
          .pretui-tm-pad {
            width: var(--pretui-togglematrix-cell, 2.75em);
            height: var(--pretui-togglematrix-cell, 2.75em);
          }
          .pretui-tm-bulk {
            width: 1.3em;
            height: 1.3em;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-tm-pad,
          .pretui-tm-mark {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
