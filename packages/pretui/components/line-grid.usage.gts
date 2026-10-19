// Pretui — LineGrid usage page: live example, a knob for every arg, and the API table.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { LineGrid } from './line-grid';
import type { LineGridColumn, LineGridRow } from './line-grid';

// A tea house's chart, as the options of the account column.
export const TEA_ACCOUNTS = [
  { value: '1000', label: '1000 · Operating cash', meta: 'bank' },
  { value: '1200', label: '1200 · Leaf inventory', meta: 'inventory' },
  { value: '2000', label: '2000 · Owed to suppliers', meta: 'payable' },
  { value: '2600', label: '2600 · Accrued expenses', meta: 'liability' },
  { value: '5000', label: '5000 · Leaf purchases', meta: 'cost of goods' },
  { value: '6200', label: '6200 · Rent — tasting room', meta: 'expense' },
  { value: '6950', label: '6950 · Other operating expenses', meta: 'expense' },
];
export const ENTRY_COLUMNS: LineGridColumn[] = [
  {
    key: 'account',
    label: 'Account',
    kind: 'choice',
    options: TEA_ACCOUNTS,
    required: true,
    placeholder: 'Account',
  },
  {
    key: 'debit',
    label: 'Debit',
    kind: 'amount',
    pairsWith: 'credit',
    total: true,
    width: '9.5rem',
  },
  {
    key: 'credit',
    label: 'Credit',
    kind: 'amount',
    pairsWith: 'debit',
    total: true,
    width: '9.5rem',
  },
  { key: 'memo', label: 'Memo', placeholder: 'Optional' },
];
export const seedEntry = (): LineGridRow[] => [
  {
    account: '6950',
    debit: 42000,
    credit: 0,
    memo: 'Window cleaning, December',
  },
  { account: '2600', debit: 0, credit: 42000 },
];

// The source line the usage page shows: a string, so its braces are text, not template.
const SOURCE =
  '<LineGrid @label="Journal lines" @columns={{this.columns}} @rows={{this.rows}} @balance={{array "debit" "credit"}} @onChange={{this.change}} @onAdd={{this.add}} @onRemove={{this.remove}} />';

class LineGridUsage extends Component {
  columns = ENTRY_COLUMNS;
  @tracked rows: LineGridRow[] = seedEntry();
  @tracked balanced = true;
  @tracked removable = true;
  @tracked disabled = false;
  @tracked minRows = 2;
  // The usage page holds the lines itself, as a card would hold them in its fields.
  change = (index: number, key: string, value: unknown) => {
    this.rows = this.rows.map((r, i) =>
      i === index ? { ...r, [key]: value } : r,
    );
  };
  add = () => {
    this.rows = [...this.rows, { debit: 0, credit: 0 }];
  };
  remove = (index: number) => {
    this.rows = this.rows.filter((_, i) => i !== index);
  };
  get balance(): [string, string] | undefined {
    return this.balanced ? ['debit', 'credit'] : undefined;
  }
  get onRemove() {
    return this.removable ? this.remove : undefined;
  }
  setBalanced = (v: boolean) => (this.balanced = v);
  setRemovable = (v: boolean) => (this.removable = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setMinRows = (v: number) => (this.minRows = v);
  <template>
    <FreestyleUsage
      @name='LineGrid'
      @description='The grid where an entry is written: account, debit, credit, memo, or any short list of figure lines. Controlled: it reports each cell in stored units (cents) and never holds the lines, so a record saves as it is typed. Totals and the balance are derived; a debit clears the line’s credit.'
      @source={{SOURCE}}
      @viewportMode='wide'
    >
      <:example>
        <LineGrid
          @label='Journal lines'
          @columns={{this.columns}}
          @rows={{this.rows}}
          @balance={{this.balance}}
          @minRows={{this.minRows}}
          @disabled={{this.disabled}}
          @onChange={{this.change}}
          @onAdd={{this.add}}
          @onRemove={{this.onRemove}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='columns'
          @value={{this.columns}}
          @description='LineGridColumn[]: key, label, kind (text, code, amount, number, choice), options, scale, pairsWith, total, required, width, placeholder.'
        />
        <Args.Object
          @name='rows'
          @value={{this.rows}}
          @description='The lines, values in their stored units. The grid reads them and never writes them.'
        />
        <Args.String
          @name='label'
          @value='Journal lines'
          @description='The grid’s accessible name. Every control is named from it: Line 2, Debit.'
        />
        <Args.Action
          @name='onChange'
          @description='(index, key, value) => void: one cell changed, value in stored units (cents for money), undefined when cleared.'
        />
        <Args.Action
          @name='onAdd'
          @description='() => void. Without it there is no Add button and Enter on the last line stops.'
        />
        <Args.Bool
          @name='onRemove (demo knob)'
          @value={{this.removable}}
          @defaultValue={{true}}
          @description='(index) => void. Without it lines can’t be removed.'
          @onInput={{this.setRemovable}}
        />
        <Args.Bool
          @name='balance (demo knob)'
          @value={{this.balanced}}
          @defaultValue={{false}}
          @description='[keyA, keyB]: two figure columns whose sums must be equal. The footer says Balanced or Out of balance by …, announced politely.'
          @onInput={{this.setBalanced}}
        />
        <Args.Number
          @name='minRows'
          @value={{this.minRows}}
          @defaultValue={{0}}
          @description='This many leading lines can’t be removed.'
          @onInput={{this.setMinRows}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @defaultValue={{false}}
          @description='Every control dimmed and inert.'
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='currency'
          @defaultValue='USD'
          @description='ISO 4217 code for amount columns and the totals.'
        />
        <Args.String
          @name='addLabel'
          @defaultValue='Add line'
          @description='The Add button’s label.'
        />
        <Args.Yield
          @name='footer'
          @description='(state: { totals, balanced, difference }) replaces the balance status.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_LINE_GRID: Record<string, unknown> = {
  LineGrid: LineGridUsage,
};
