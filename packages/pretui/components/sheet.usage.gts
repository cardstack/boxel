// Pretui — Sheet usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Sheet } from './sheet';
import { SheetToolbar } from './sheet-toolbar';
import type { SheetColumn, SheetDatum } from './sheet';
import { LEDGER_COLUMNS, buildLedger } from '../demo-surfaces-grid';
import type { Lot } from '../demo-surfaces-grid';

// ── Sheet ────────────────────────────────────────────────────────────────
const DENSITIES = ['compact', 'default', 'roomy'];

function money(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

// There is no upstream "usage.gts" to port from: boxel-grid ships example
// CARDS (grid-editable-table.gts, grid-preset-examples.gts) in the
// realistic-clownfish realm, and this page takes their shape — one real
// table, edited live — rather than a matrix of dead states. What it adds
// over those examples is the knob rail: density, zebra, the two master
// gates, and the pin, all settable while the same selection stays live.
class SheetUsage extends Component {
  ledger: Lot[] = buildLedger(16);

  @tracked label = 'Arrivals ledger';
  @tracked density = 'default';
  @tracked zebra = true;
  @tracked editable = true;
  @tracked sortable = true;
  @tracked pinFirstColumn = true;
  @tracked maxHeight = '17rem';
  @tracked rowCount = 16;
  @tracked lastEdit = '';
  @tracked rejected = '';

  setLabel = (v: string) => (this.label = v);
  setDensity = (v: string) => (this.density = v);
  setZebra = (v: boolean) => (this.zebra = v);
  setEditable = (v: boolean) => (this.editable = v);
  setSortable = (v: boolean) => (this.sortable = v);
  setPinFirstColumn = (v: boolean) => (this.pinFirstColumn = v);
  setMaxHeight = (v: string) => (this.maxHeight = v);
  setRowCount = (v: number | null) => (this.rowCount = v ?? 0);

  get densityVal() {
    return this.density as 'compact' | 'default' | 'roomy';
  }

  // Slicing is safe where rebuilding is not: `.slice()` hands back the
  // SAME row objects, so an edit committed at row 3 survives a change of
  // row count. A getter that rebuilt the objects would drop every edit.
  get rows(): SheetDatum[] {
    return this.ledger.slice(0, this.rowCount);
  }

  get columns(): SheetColumn[] {
    return LEDGER_COLUMNS;
  }

  /** Refuses a weight of zero or less, and a price above five figures —
   *  returning false keeps the editor open with the bad text intact so
   *  the reader can correct it instead of losing the keystroke. */
  validate = (next: unknown, column: SheetColumn, row: SheetDatum): boolean => {
    if (column.key === 'kilos' && typeof next === 'number' && next <= 0) {
      this.rejected = `A lot cannot weigh ${next} kg — ${String(row['lot'])} left unchanged.`;
      return false;
    }
    if (column.key === 'price' && typeof next === 'number' && next > 99999) {
      this.rejected = `${money(next)}/kg is past the ledger's ceiling.`;
      return false;
    }
    this.rejected = '';
    return true;
  };

  onCommit = (row: SheetDatum, key: string, next: unknown): void => {
    this.lastEdit = `${String(row['lot'])} · ${key} → ${String(next)}`;
  };

  get totalKilos(): number {
    return this.rows.reduce((sum, row) => sum + Number(row['kilos'] ?? 0), 0);
  }

  get totalValue(): number {
    return this.rows.reduce(
      (sum, row) => sum + Number(row['kilos'] ?? 0) * Number(row['price'] ?? 0),
      0,
    );
  }

  get totalValueLabel(): string {
    return money(this.totalValue);
  }

  get usage() {
    let bits = [
      `@label='${this.label}'`,
      '@rows={{this.rows}}',
      '@columns={{this.columns}}',
      `@density='${this.densityVal}'`,
    ];
    if (!this.zebra) bits.push('@zebra={{false}}');
    if (!this.editable) bits.push('@editable={{false}}');
    if (!this.sortable) bits.push('@sortable={{false}}');
    if (this.pinFirstColumn) bits.push('@pinFirstColumn={{true}}');
    if (this.maxHeight) bits.push(`@maxHeight='${this.maxHeight}'`);
    return `<Sheet\n  ${bits.join('\n  ')}\n  @validate={{this.validate}}\n  @onCommit={{this.onCommit}}\n>\n  <:toolbar as |api|>\n    <SheetToolbar @api={{api}} @title='Arrivals' />\n  </:toolbar>\n  <:footer as |api|>\n    …{{api.visibleCount}} of {{api.totalCount}}…\n  </:footer>\n</Sheet>`;
  }

  <template>
    <FreestyleUsage
      @name='Sheet'
      @description='A spreadsheet-grade editable data grid: boxel-grid’s headless runtime (cell selection, edit lifecycle, keyboard map, commit routing with retry) wearing Pretui cloth. Reach for it when values must be EDITED in place — DataGrid and Table are read-only presentations of the same kind of data. Click a cell, arrow around, Enter or F2 to edit, Tab to walk the row, Escape to leave the cell plane and hand Tab back to the page, Space to flip a checkbox. Pretui adds sort and quick filter (the engine builds its table with the core row model only, so it cannot sort on its own), the aria-rowcount/-colcount/-rowindex/-colindex set the engine omits, a real role="row" around the column headers, and a live status line. Honest limits: range selection is styled but not wired (SheetRuntime always resolves the range to the single current cell), there is no virtualisation — every visible row renders, which is fine to a few hundred rows and not a 100k-row grid — column resize and engine column pinning need TanStack state getSheet does not thread (@pinFirstColumn is honest position:sticky), and FieldDef-backed columns need a CardDef context this page has not got.'
      @source={{this.usage}}
    >
      <:example>
        <Sheet
          @rows={{this.rows}}
          @columns={{this.columns}}
          @label={{this.label}}
          @density={{this.densityVal}}
          @zebra={{this.zebra}}
          @editable={{this.editable}}
          @sortable={{this.sortable}}
          @pinFirstColumn={{this.pinFirstColumn}}
          @maxHeight={{this.maxHeight}}
          @validate={{this.validate}}
          @onCommit={{this.onCommit}}
        >
          <:toolbar as |api|>
            <SheetToolbar @api={{api}} @title='Arrivals' />
          </:toolbar>
          <:footer as |api|>
            <span class='sg-foot'>
              <span class='sg-foot-n'>{{this.totalKilos}}</span>
              kg ·
              <span class='sg-foot-n'>{{this.totalValueLabel}}</span>
              across
              {{api.visibleCount}}
              lots
            </span>
          </:footer>
        </Sheet>

        <p class='sg-readout' data-tone={{if this.rejected 'warn' 'quiet'}}>
          {{#if this.rejected}}
            Rejected —
            {{this.rejected}}
          {{else if this.lastEdit}}
            Last edit —
            <span class='sg-readout-mono'>{{this.lastEdit}}</span>
          {{else}}
            No edits yet. Double-click a cell, or select one and press Enter.
          {{/if}}
        </p>
      </:example>

      <:api as |Args|>
        <Args.Object
          @name='rows'
          @description='The data: an array of plain objects, mutated IN PLACE on commit. Pass a stable array — a getter that rebuilds the objects on every read throws each edit away — and give every row an id, because getSheet keys rows by row.id and falls back to the ordinal, which makes the selected cell jump when a sort reorders things. Sixteen deterministic tea lots here (seedFrom/pick from examples.gts).'
          @required={{true}}
          @hideControls={{true}}
        />
        <Args.Number
          @name='rows (count shown)'
          @description='Not a Sheet arg — a knob on this page, slicing the same array so you can watch the row model, the status line, and the empty state follow. Drag it to 0 for the default empty state.'
          @value={{this.rowCount}}
          @min={{0}}
          @max={{16}}
          @step={{1}}
          @onInput={{this.setRowCount}}
        />
        <Args.Object
          @name='columns'
          @description='Column definitions in display order. Per column: key, label, type (text | number | boolean | date), width (a CSS grid track), align, mono (machine-value typography — default on for number and date), editable, sortable, hint (a small unit note beside the label — chrome, suppressed below 30rem of sheet width, so nothing load-bearing goes there). This ledger sets lot as mono + editable:false and cleared as sortable:false, so you can see both gates act independently of the masters below.'
          @required={{true}}
          @hideControls={{true}}
        />
        <Args.String
          @name='label'
          @description='Accessible name for the grid. Always supply a real one — it is what a screen reader announces alongside "row 4 of 16".'
          @defaultValue='Data sheet'
          @value={{this.label}}
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='density'
          @description='Row height and cell padding scale. Drives --pretui-sheet-row-h / --pretui-sheet-cell-pad, which are threaded into the engine through the inline token bridge.'
          @defaultValue='default'
          @options={{DENSITIES}}
          @value={{this.density}}
          @onInput={{this.setDensity}}
        />
        <Args.Bool
          @name='zebra'
          @description='Stripe alternate rows. The stripe lives on the ROW, not the cell, so a pinned first column inherits it and stays opaque while the body scrolls sideways.'
          @defaultValue={{true}}
          @value={{this.zebra}}
          @onInput={{this.setZebra}}
        />
        <Args.Bool
          @name='editable'
          @description='Master edit gate; a column can still opt out with its own editable:false, never in. Turn it off and watch the boolean column keep its checkbox — disabled — instead of degrading to the engine’s readonly "true"/"false" text.'
          @defaultValue={{true}}
          @value={{this.editable}}
          @onInput={{this.setEditable}}
        />
        <Args.Bool
          @name='sortable'
          @description='Master sort gate. Off means no header buttons at all and no aria-sort — a column that cannot be sorted must not advertise the affordance.'
          @defaultValue={{true}}
          @value={{this.sortable}}
          @onInput={{this.setSortable}}
        />
        <Args.Bool
          @name='pinFirstColumn'
          @description='Sticks the first column to the left edge. Honest position:sticky, NOT the engine’s column pinning (which needs TanStack pinning state getSheet does not thread). Narrow the artboard until the body scrolls to see it hold.'
          @defaultValue={{false}}
          @value={{this.pinFirstColumn}}
          @onInput={{this.setPinFirstColumn}}
        />
        <Args.String
          @name='maxHeight'
          @description='CSS max-height for the scroll container, set as --pretui-sheet-max-height. The header stays stuck to the top of it.'
          @defaultValue='22rem'
          @value={{this.maxHeight}}
          @onInput={{this.setMaxHeight}}
        />
        <Args.String
          @name='defaultSort'
          @description='Initial sort, as { key, dir: "asc" | "desc" }. Unset here so the sheet opens in ledger order; click any header to cycle asc → desc → unsorted.'
          @hideControls={{true}}
        />
        <Args.String
          @name='filter'
          @description='Controlled quick-filter text. Omit it (as this page does) and the toolbar’s search field drives the filter itself; supply it and you own the value, with @onFilterChange as the write-back.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='validate'
          @description='(next, column, row) => boolean, run after type coercion and before the write. Returning false keeps the editor open with the bad text intact. This page refuses a weight of zero or less and a price above five figures — try typing 0 into a Weight cell.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onCommit'
          @description='(row, key, next) — fires after the value lands on the row object. The "last edit" line under the grid is nothing but this callback, which is how you can tell the edits are real.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onSortChange'
          @description='(sort | null) — fires as the header cycles asc → desc → unsorted.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onFilterChange'
          @description='(query) — fires on every quick-filter keystroke.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='<:toolbar>'
          @description='Chrome above the grid, yielded the SheetApi: { query, setQuery, sort, toggleSort, clearSort, visibleCount, totalCount, columns }. SheetToolbar is the stock filling; anything else you build gets the same handle.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='<:footer>'
          @description='Summary band below the grid, yielded the same SheetApi. It sits beside the live status line (role="status") that announces filter and sort results — the footer never replaces that announcement. Here: total weight and value across the visible lots.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='<:empty>'
          @description='Replaces the default EmptyState. The default already distinguishes "no rows yet" from "the filter matched nothing" — drag the row count to 0, then type into the filter, to see both. Rendered OUTSIDE the grid’s rowgroup, because role="rowgroup" admits only role="row" children.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .sg-foot {
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .sg-foot-n {
        font-family: var(--font-mono);
        font-variant-numeric: tabular-nums;
        color: var(--card-foreground);
      }
      .sg-readout {
        margin: var(--space-3, 8px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .sg-readout[data-tone='warn'] {
        color: color-mix(
          in oklch,
          var(--foreground) 16%,
          var(--warning, var(--boxel-warning))
        );
      }
      .sg-readout-mono {
        font-family: var(--font-mono);
        font-variant-numeric: tabular-nums;
        color: var(--card-foreground);
      }
    </style>
  </template>
}

export const DEMOS_SHEET: Record<string, unknown> = {
  Sheet: SheetUsage,
};
