// Pretui — StatementTable usage page: live example, a knob for every arg, and the API table.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { StatementTable } from './statement-table';
import type {
  StatementColumn,
  StatementRow,
  StatementTableSignature,
} from './statement-table';

// A tea house's quarter, in cents, the way the books hold it.
export const TEA_HOUSE_COLUMNS: StatementColumn[] = [
  { key: 'code', label: 'No.', kind: 'code', width: '4.5rem' },
  { key: 'name', label: 'Account' },
  { key: 'q1', label: 'Q1', kind: 'amount' },
  { key: 'q2', label: 'Q2', kind: 'amount', priority: 'secondary' },
];
export const TEA_HOUSE_ROWS: StatementRow[] = [
  { key: 'h-income', role: 'heading', cells: { code: 'Income' } },
  {
    key: '4000',
    depth: 1,
    cells: { code: '4000', name: 'Loose-leaf sales', q1: 4812000, q2: 5126500 },
    data: { row: true, key: '4000' },
    children: [
      {
        key: 'online',
        cells: { name: 'Online orders', q1: 2950000, q2: 3180500 },
      },
      {
        key: 'counter',
        cells: { name: 'Shop counter', q1: 1862000, q2: 1946000 },
      },
    ],
  },
  {
    key: '4100',
    depth: 1,
    cells: { code: '4100', name: 'Tasting room', q1: 1960000, q2: 2240000 },
    data: { row: true, key: '4100' },
  },
  {
    key: 't-income',
    role: 'subtotal',
    cells: { name: 'Total income', q1: 6772000, q2: 7366500 },
  },
  { key: 'h-cogs', role: 'heading', cells: { code: 'Cost of goods sold' } },
  {
    key: '5000',
    depth: 1,
    cells: { code: '5000', name: 'Leaf purchases', q1: 2830000, q2: 3012000 },
    data: { row: true, key: '5000' },
  },
  {
    key: '5200',
    depth: 1,
    cells: { code: '5200', name: 'Stock count adjustment', q1: 0, q2: -45000 },
    data: { row: true, key: '5200' },
  },
  {
    key: 't-cogs',
    role: 'subtotal',
    cells: { name: 'Total cost of goods sold', q1: 2830000, q2: 2967000 },
  },
  {
    key: 'gross',
    role: 'subtotal',
    cells: { name: 'Gross profit', q1: 3942000, q2: 4399500 },
  },
  { key: 'h-exp', role: 'heading', cells: { code: 'Expenses' } },
  {
    key: '6200',
    depth: 1,
    cells: {
      code: '6200',
      name: 'Rent — tasting room',
      q1: 1800000,
      q2: 1800000,
    },
    data: { row: true, key: '6200' },
  },
  {
    key: '6400',
    depth: 1,
    cells: { code: '6400', name: 'Wages', q1: 2310000, q2: 2390000 },
    data: { row: true, key: '6400' },
  },
  {
    key: 't-exp',
    role: 'subtotal',
    cells: { name: 'Total expenses', q1: 4110000, q2: 4190000 },
  },
  {
    key: 'net',
    role: 'total',
    cells: { name: 'Net income', q1: -168000, q2: 209500 },
  },
];

const NEGATIVES = ['parentheses', 'minus'];
const ZEROS = ['blank', 'dash', 'show'];
const DENSITIES = ['regular', 'compact'];

// The source line the usage page shows: a string, so its braces are text, not template.
const SOURCE =
  '<StatementTable @label="Profit and loss" @columns={{this.columns}} @rows={{this.rows}} />';

class StatementTableUsage extends Component {
  columns = TEA_HOUSE_COLUMNS;
  rows = TEA_HOUSE_ROWS;
  @tracked negative: StatementTableSignature['Args']['negative'] =
    'parentheses';
  @tracked zero: StatementTableSignature['Args']['zero'] = 'blank';
  @tracked density: StatementTableSignature['Args']['density'] = 'regular';
  @tracked framed = true;
  @tracked drill = false;
  @tracked opened = '';
  setNegative = (v: string) =>
    (this.negative = v as StatementTableSignature['Args']['negative']);
  setZero = (v: string) =>
    (this.zero = v as StatementTableSignature['Args']['zero']);
  setDensity = (v: string) =>
    (this.density = v as StatementTableSignature['Args']['density']);
  setFramed = (v: boolean) => (this.framed = v);
  setDrill = (v: boolean) => (this.drill = v);
  open = (row: StatementRow) =>
    (this.opened = String(row.cells['name'] ?? row.key));
  get onRowSelect() {
    return this.drill ? this.open : undefined;
  }
  <template>
    <FreestyleUsage
      @name='StatementTable'
      @description='Figures in sections, with subtotals and totals, set the way an accountant sets them: amounts held in cents, negatives in parentheses, zero blank, a rule over each subtotal and a double rule under the total. Rows say what they are; the table decides how they look. A row with children opens in place (4000 opens to its two channels).'
      @source={{SOURCE}}
      @viewportMode='wide'
    >
      <:example>
        <StatementTable
          @label='Tea house profit and loss'
          @columns={{this.columns}}
          @rows={{this.rows}}
          @negative={{this.negative}}
          @zero={{this.zero}}
          @density={{this.density}}
          @framed={{this.framed}}
          @onRowSelect={{this.onRowSelect}}
        />
        {{#if this.opened}}<p>Opened: {{this.opened}}</p>{{/if}}
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='columns'
          @value={{this.columns}}
          @description='StatementColumn[]: key, label, kind (text, code, amount, number, percent, quantity, custom), scale, sign, whole, digits, priority, width.'
        />
        <Args.Object
          @name='rows'
          @value={{this.rows}}
          @description='StatementRow[]: key, role (line, heading, subtotal, total), depth 0–3, cells by column key, and data for test hooks on the row.'
        />
        <Args.String
          @name='label'
          @defaultValue=''
          @description='The name when it is nowhere on screen. Names the table, and makes its scroll box a reachable region.'
        />
        <Args.String
          @name='caption'
          @defaultValue=''
          @description='A visible name, rendered as a real caption. Wins over label and labelledBy.'
        />
        <Args.String
          @name='currency'
          @defaultValue='USD'
          @description='ISO 4217 code for amount columns.'
        />
        <Args.String
          @name='negative'
          @value={{this.negative}}
          @options={{NEGATIVES}}
          @defaultValue='parentheses'
          @description='How a negative balance is set. A column with sign change always shows its sign instead.'
          @onInput={{this.setNegative}}
        />
        <Args.String
          @name='zero'
          @value={{this.zero}}
          @options={{ZEROS}}
          @defaultValue='blank'
          @description='How a zero amount is set: blank as on a printed statement, a dash, or $0.00.'
          @onInput={{this.setZero}}
        />
        <Args.String
          @name='density'
          @value={{this.density}}
          @options={{DENSITIES}}
          @defaultValue='regular'
          @description='Compact takes the xs type size and tighter rows.'
          @onInput={{this.setDensity}}
        />
        <Args.Bool
          @name='framed'
          @value={{this.framed}}
          @defaultValue={{true}}
          @description='Off drops the frame, for a table seated in a panel.'
          @onInput={{this.setFramed}}
        />
        <Args.Bool
          @name='onRowSelect (demo knob)'
          @value={{this.drill}}
          @defaultValue={{false}}
          @description='A callback makes each line’s select column a link-style Button that hands back the row. Headings, subtotals and totals never drill.'
          @onInput={{this.setDrill}}
        />
        <Args.Action @name='onRowSelect' @description='(row) => void.' />
        <Args.String
          @name='selectColumn'
          @description='The column that carries the drill-in. Defaults to the first.'
        />
        <Args.Object
          @name='expanded'
          @description='The keys of the expanded rows, controlled. A child’s key is parentKey/childKey. Omit it and the table keeps its own (seeded by defaultExpanded).'
        />
        <Args.Action
          @name='onExpandedChange'
          @description='(keys) => void, when a row is opened or closed: the new set of expanded keys.'
        />
        <Args.Action
          @name='expandLabel'
          @description='(row) => string: the disclosure button’s name, e.g. “Show Loose-leaf sales by channel”.'
        />
        <Args.Yield
          @name='cell'
          @description='(value, row, column) for every column of kind custom: a status chip, a link, an icon.'
        />
        <Args.Yield
          @name='caption'
          @description='A rich caption. Wins over @caption.'
        />
        <Args.Yield
          @name='empty'
          @description='Replaces the empty state when there are no rows.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_STATEMENT_TABLE: Record<string, unknown> = {
  StatementTable: StatementTableUsage,
};
