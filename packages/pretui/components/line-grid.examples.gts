// Pretui — LineGrid example gallery: real compositions worn at the foot of the workbench page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FormatNumber } from './format-number';
import { SUPPLIERS, TEAS, pick, seedFrom } from '../examples-kit';
import type { ExampleSpec } from '../examples-kit';
import { LineGrid } from './line-grid';
import type { LineGridColumn, LineGridRow, LineGridState } from './line-grid';
import { ENTRY_COLUMNS } from './line-grid.usage';

const SEED = seedFrom('LineGrid');
const supplier = pick(SEED, 0, SUPPLIERS),
  t1 = pick(SEED, 1, TEAS),
  t2 = pick(SEED, 2, TEAS),
  t3 = pick(SEED, 3, TEAS);
const BILL_LABEL = `Bill from ${supplier}`;
const centsToMajor = (cents: number) => cents / 100;

// Each example holds its own lines, as a record would.
class Lines extends Component<{ Args: { seed: LineGridRow[] } }> {
  @tracked rows: LineGridRow[] = this.args.seed.map((r) => ({ ...r }));
  change = (index: number, key: string, value: unknown) => {
    this.rows = this.rows.map((r, i) =>
      i === index ? { ...r, [key]: value } : r,
    );
  };
  add = () => {
    this.rows = [...this.rows, {}];
  };
  remove = (index: number) => {
    this.rows = this.rows.filter((_, i) => i !== index);
  };
}

// ── A journal entry that doesn't balance yet: the footer says by how much ───────────────────────
class UnbalancedEntry extends Lines {
  columns = ENTRY_COLUMNS;
  balance: [string, string] = ['debit', 'credit'];
  <template>
    <LineGrid
      @label='Accrual being written'
      @columns={{this.columns}}
      @rows={{this.rows}}
      @balance={{this.balance}}
      @minRows={{2}}
      @onChange={{this.change}}
      @onAdd={{this.add}}
      @onRemove={{this.remove}}
    />
  </template>
}

// ── A supplier bill's lines: quantity, price and amount, with a total and no balance pair ─────
const BILL_COLUMNS: LineGridColumn[] = [
  { key: 'tea', label: 'Tea', required: true },
  { key: 'kg', label: 'Kg', kind: 'number', scale: 1, width: '6rem' },
  {
    key: 'amount',
    label: 'Amount',
    kind: 'amount',
    total: true,
    width: '9.5rem',
  },
];
class SupplierBill extends Lines {
  columns = BILL_COLUMNS;
  <template>
    <LineGrid
      @label={{BILL_LABEL}}
      @columns={{this.columns}}
      @rows={{this.rows}}
      @onChange={{this.change}}
      @onAdd={{this.add}}
      @onRemove={{this.remove}}
      @addLabel='Add a tea'
    />
  </template>
}

// ── A footer of the caller's own: the share of the total still to allocate ──────────────────────
const SPLIT_COLUMNS: LineGridColumn[] = [
  { key: 'room', label: 'Tasting room', required: true },
  {
    key: 'amount',
    label: 'Share of rent',
    kind: 'amount',
    total: true,
    width: '9.5rem',
  },
];
const RENT = 1800000;
const leftOf = (s: LineGridState) => RENT - (s.totals['amount'] ?? 0);
class RentSplit extends Lines {
  columns = SPLIT_COLUMNS;
  <template>
    <LineGrid
      @label='Rent split by room'
      @columns={{this.columns}}
      @rows={{this.rows}}
      @onChange={{this.change}}
      @onAdd={{this.add}}
      @onRemove={{this.remove}}
    >
      <:footer as |state|>Still to allocate:
        <FormatNumber
          @value={{centsToMajor (leftOf state)}}
          @style='currency'
          @currency='USD'
        /></:footer>
    </LineGrid>
  </template>
}

const ENTRY_SEED: LineGridRow[] = [
  { account: '6950', debit: 42000, credit: 0, memo: 'Window cleaning' },
  { account: '2600', debit: 0, credit: 40000 },
];
const BILL_SEED: LineGridRow[] = [
  { tea: t1, kg: 120, amount: 384000 },
  { tea: t2, kg: 45, amount: 207000 },
  { tea: t3, kg: 30, amount: 96000 },
];
const SPLIT_SEED: LineGridRow[] = [
  { room: 'Front room', amount: 1080000 },
  { room: 'Tasting bar', amount: 540000 },
];

const UnbalancedEntryExample = <template>
  <UnbalancedEntry @seed={{ENTRY_SEED}} />
</template>;
const SupplierBillExample = <template>
  <SupplierBill @seed={{BILL_SEED}} />
</template>;
const RentSplitExample = <template>
  <RentSplit @seed={{SPLIT_SEED}} />
</template>;

export const EXAMPLES_LINE_GRID: Record<string, ExampleSpec[]> = {
  LineGrid: [
    {
      title: 'An accrual that doesn’t balance yet',
      note: 'The credit is $20.00 short, and the footer says so in words, announced as it changes. Type a debit on the credit line and its credit clears.',
      component: UnbalancedEntryExample,
    },
    {
      title: `A bill from ${supplier}`,
      note: `${t1}, ${t2} and ${t3} by the kilogram, with a total and no balance pair. Enter on the last line adds the next tea.`,
      component: SupplierBillExample,
    },
    {
      title: 'A footer of your own',
      note: 'The <:footer> slot gets the totals; here it shows how much of the $18,000.00 rent is still to allocate across the rooms.',
      component: RentSplitExample,
    },
  ],
};
