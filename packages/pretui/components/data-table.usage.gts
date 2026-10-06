// Pretui — DataTable usage page. The lots come from examples-listing.gts.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { StatusChip } from './status-chip';
import { Token } from './token';
import { Menu } from './menu';
import type { MenuEntry } from '../internal/menu';
import { DataTable } from './data-table';
import { Descriptions } from './descriptions';
import type { DataColumn, FilterState } from './data-table';
import type { DescriptionsItem } from './descriptions';
import type { ListingSizeArg } from '../internal/reading-listing';
import type {
  RowKey,
  SelectionMode,
  SortState,
} from '../data-component';
import { GRADES, LOTS, MODES, SIZES, lotLabel } from '../examples-listing';
import type { Lot } from '../examples-listing';

const GRADE_OPTIONS = GRADES.map((g) => ({ value: g, label: g }));
const PLACE_OPTIONS = Array.from(new Set(LOTS.map((l) => l.place))).map(
  (p) => ({ value: p, label: p }),
);

const COLUMNS: DataColumn<Lot>[] = [
  { key: 'id', label: 'Lot', mono: true, width: '6.5em', alwaysVisible: true },
  { key: 'tea', label: 'Tea', filter: { kind: 'text' } },
  { key: 'supplier', label: 'Supplier' },
  {
    key: 'place',
    label: 'Origin',
    filter: { kind: 'options', options: PLACE_OPTIONS },
  },
  {
    key: 'grade',
    label: 'Grade',
    filter: { kind: 'options', options: GRADE_OPTIONS },
  },
  { key: 'kg', label: 'Weight', align: 'end', mono: true, width: '6em' },
  { key: 'price', label: 'Price', align: 'end', mono: true, width: '7em' },
];

const PINNED_COLUMNS: DataColumn<Lot>[] = COLUMNS.map((col) =>
  col.key === 'id' ? { ...col, pin: 'start' as const } : col,
);


class DataTableUsage extends Component {
  modes = MODES;
  sizes = SIZES;
  lots = LOTS;
  columns = COLUMNS;

  @tracked selectionMode: SelectionMode = 'multi';
  @tracked size: ListingSizeArg = 'm';
  @tracked pinFirst = false;
  @tracked striped = true;
  @tracked pageSize = 6;
  @tracked showDetail = true;
  @tracked lastSort = '—';
  @tracked lastSelection = '—';
  @tracked lastFilters = '—';

  setSelectionMode = (v: string) => (this.selectionMode = v as SelectionMode);
  setSize = (v: string) => (this.size = v as ListingSizeArg);
  setPinFirst = (v: boolean) => (this.pinFirst = v);
  setStriped = (v: boolean) => (this.striped = v);
  setPageSize = (v: number) => (this.pageSize = v);
  setShowDetail = (v: boolean) => (this.showDetail = v);

  get activeColumns(): DataColumn<Lot>[] {
    return this.pinFirst ? PINNED_COLUMNS : COLUMNS;
  }

  rowKey = (row: Lot): RowKey => row.id;
  rowLabel = (row: Lot): string => lotLabel(row);

  onSortChange = (sort: SortState | null) => {
    this.lastSort = sort ? sort.key + ' ' + sort.dir : 'unsorted';
  };
  onSelectionChange = (keys: RowKey[]) => {
    this.lastSelection = keys.length ? keys.join(', ') : 'none';
  };
  onFiltersChange = (filters: FilterState) => {
    let parts = Object.keys(filters)
      .map((key) => {
        let value = filters[key];
        let text = Array.isArray(value) ? value.join('+') : String(value);
        return text.length ? key + '=' + text : '';
      })
      .filter((s) => s.length > 0);
    this.lastFilters = parts.length ? parts.join(' · ') : 'none';
  };

  rowMenu = (row: Lot): MenuEntry[] => [
    { label: 'Open ' + row.id },
    { label: 'Duplicate' },
    '---',
    { label: 'Archive', destructive: true },
  ];

  isPriceCol = (key: string): boolean => key === 'price';
  isGradeCol = (key: string): boolean => key === 'grade';

  detailItems = (row: Lot): DescriptionsItem[] => [
    { label: 'Lot', value: row.id, mono: true },
    { label: 'Supplier', value: row.supplier },
    { label: 'Origin', value: row.place },
    { label: 'Grade', value: row.grade },
    { label: 'Weight', value: String(row.kg) + ' kg', mono: true },
    { label: 'Price', value: row.price, mono: true },
    { label: 'Cupping note', value: row.note, span: 'fill' },
  ];

  actionsLabel = (row: Lot): string => 'Actions for ' + lotLabel(row);

  <template>
    <FreestyleUsage
      @name='DataTable'
      @slug='data-table'
      @description='The record listing: sortable headers with real aria-sort, per-column filters in the toolbar, a column switcher, row selection, expandable detail rows, pinned columns and density. It is NOT the spreadsheet — that is Sheet — and it is not the markup primitive Table.'
    >
      <:example>
        <div class='dt-demo'>
          <div class='dt-readout'>
            <span>sort
              <strong>{{this.lastSort}}</strong></span>
            <span>selected
              <strong>{{this.lastSelection}}</strong></span>
            <span>filters
              <strong>{{this.lastFilters}}</strong></span>
          </div>

          {{#if this.showDetail}}
            <DataTable
              @columns={{this.activeColumns}}
              @rows={{this.lots}}
              @key={{this.rowKey}}
              @rowLabel={{this.rowLabel}}
              @caption='Lots booked this season'
              @size={{this.size}}
              @selectionMode={{this.selectionMode}}
              @striped={{this.striped}}
              @pageSize={{this.pageSize}}
              @itemNoun='lot'
              @minWidth='46rem'
              @onSortChange={{this.onSortChange}}
              @onSelectionChange={{this.onSelectionChange}}
              @onFiltersChange={{this.onFiltersChange}}
            >
              <:cell as |text row col|>
                {{#if (this.isGradeCol col.key)}}
                  <StatusChip @value={{row.grade}} />
                {{else if (this.isPriceCol col.key)}}
                  <Token @value={{row.price}} />
                {{else}}
                  {{text}}
                {{/if}}
              </:cell>
              <:expanded as |row|>
                <Descriptions
                  @items={{this.detailItems row}}
                  @columns={{3}}
                  @bordered={{true}}
                  @size='s'
                />
              </:expanded>
              <:actions as |row|>
                <Menu @items={{this.rowMenu row}} @label='Lot actions' @align='end'>
                  <:trigger as |isOpen toggle|>
                    <Button
                      @appearance='plain'
                      @size='s'
                      aria-label={{this.actionsLabel row}}
                      data-open={{if isOpen 'true'}}
                      {{on 'click' toggle}}
                    >⋯</Button>
                  </:trigger>
                </Menu>
              </:actions>
            </DataTable>
          {{else}}
            <DataTable
              @columns={{this.activeColumns}}
              @rows={{this.lots}}
              @key={{this.rowKey}}
              @rowLabel={{this.rowLabel}}
              @caption='Lots booked this season'
              @size={{this.size}}
              @selectionMode={{this.selectionMode}}
              @striped={{this.striped}}
              @pageSize={{this.pageSize}}
              @itemNoun='lot'
              @minWidth='46rem'
              @onSortChange={{this.onSortChange}}
              @onSelectionChange={{this.onSelectionChange}}
              @onFiltersChange={{this.onFiltersChange}}
            />
          {{/if}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='columns'
          @value={{this.columns}}
          @description='The column model, in display order. Each column carries key (identity, default field read and sort key), label, and optionally value(row), sortable, align, mono, width, pin, hidden, alwaysVisible and filter. Ant spellings land too: fixed:true means pin start.'
        />
        <Args.Object
          @name='rows'
          @value={{this.lots}}
          @description='The records. dataSource is accepted as an alias. Supply EITHER rows or load, never both. Filters run in the browser over whatever rows are in hand, eager or loaded; to filter at the source instead, hold filters yourself and feed them into loadKey.'
        />
        <Args.Action
          @name='key'
          @description='(row, index) => string | number. Pass it. A listing sorts, and without a key an index-keyed row loses its identity the moment it does — selection and expansion would follow the position rather than the record.'
        />
        <Args.String
          @name='size'
          @value={{this.size}}
          @options={{this.sizes}}
          @defaultValue='m'
          @description='Density. The house scale is xs|s|m|l|xl and it sets the host font-size only, so every internal dimension scales together. sm/md/lg/default/small/medium/large/middle are accepted spellings.'
          @onInput={{this.setSize}}
        />
        <Args.String
          @name='selectionMode'
          @value={{this.selectionMode}}
          @options={{this.modes}}
          @defaultValue='none'
          @description="'none', 'single' or 'multi'. multi adds a header select-all whose mixed state is a real indeterminate checkbox, so it announces aria-checked mixed. Every selected tr carries aria-selected as well as data-selected."
          @onInput={{this.setSelectionMode}}
        />
        <Args.Bool
          @name='pinFirst (demo knob)'
          @value={{this.pinFirst}}
          @defaultValue={{false}}
          @description='Pins the Lot column with pin start. A pinned column must declare a width — offsets are summed from declared widths, never measured — and a pinned column whose predecessors are unmeasurable is left unpinned rather than laid on top of one. Narrow the artboard to see it hold.'
          @onInput={{this.setPinFirst}}
        />
        <Args.Bool
          @name='striped'
          @value={{this.striped}}
          @defaultValue={{true}}
          @description='Zebra rows. Pinned cells take the row’s computed background, so striping, hover and selection all survive the pin.'
          @onInput={{this.setStriped}}
        />
        <Args.Number
          @name='pageSize'
          @value={{this.pageSize}}
          @min={{0}}
          @max={{12}}
          @step={{1}}
          @defaultValue={{0}}
          @description='Rows per page. 0 renders every row and no pager. Paging composes the kit’s Pagination; page / defaultPage / onPageChange drive it, and a filter change resets to page 1 because it is the only page guaranteed to exist in the new result set.'
          @onInput={{this.setPageSize}}
        />
        <Args.Bool
          @name='expanded block (demo knob)'
          @value={{this.showDetail}}
          @defaultValue={{true}}
          @description='Supplying the expanded named block turns on the expander column. Each toggle is a real button with aria-expanded and aria-controls pointing at the detail row.'
          @onInput={{this.setShowDetail}}
        />
        <Args.Object
          @name='sort'
          @description='Controlled sort ({ key, dir } or null); defaultSort seeds the uncontrolled case. Clicking a header cycles ascending → descending → unsorted, and aria-sort on the th follows. Every SORTABLE column carries aria-sort, none when it is not the active one, so the header row says which columns can be sorted as well as which one is.'
        />
        <Args.Object
          @name='filters'
          @description='Controlled filter state keyed by column: a string for a text filter, an array of values for an options filter. defaultFilters seeds it, onFiltersChange reports it, and a column filter’s own match(row, value) replaces the built-in matcher for dates, ranges or nested paths.'
        />
        <Args.Object
          @name='visibleColumns'
          @description='Controlled column visibility — the keys that are SHOWN. defaultVisibleColumns seeds it (every column without hidden), onVisibleColumnsChange reports it, and the Columns menu drives it. A column marked alwaysVisible never leaves.'
        />
        <Args.Object
          @name='expandedKeys'
          @description='Controlled expansion (array of row keys). defaultExpandedKeys seeds it; onExpandedChange reports it.'
        />
        <Args.String
          @name='caption / label'
          @description='caption renders a real table caption; label names the scroll region when there should be no visible caption. The scroll box is a named region with a tab stop, so a table wider than its pane can be scrolled from the keyboard — MUI, Tremor and shadcn all ship that box with neither.'
          @hideControls={{true}}
        />
        <Args.String
          @name='minWidth'
          @description='The width at which the table starts scrolling instead of squeezing. Mantine’s ScrollContainer requires this and is right to: a table with no floor silently crushes its columns to unreadable slivers.'
          @hideControls={{true}}
        />
        <Args.Yield
          @description='Named blocks: cell (text, row, col) where text is the printed value and row is your own fully typed record — a caller should never have to narrow unknown inside a template; expanded (row) for the detail row; actions (row) for the row menu; toolbar for extra toolbar content; and loading / empty / error, which replace DataShell’s defaults. The filtered-empty state is separate from empty — it means your filters matched nothing and it offers a way out.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .dt-demo {
        display: grid;
        gap: var(--space-4, 11px);
        min-width: 0;
      }
      .dt-readout {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4, 11px);
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .dt-readout strong {
        color: var(--foreground);
        font-weight: 500;
      }
    </style>
  </template>
}

export const DEMOS_DATA_TABLE: Record<string, unknown> = {
  DataTable: DataTableUsage,
};
