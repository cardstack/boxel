// Pretui — StatementTable example gallery: real compositions worn at the foot of the workbench page,
// not knob rigs.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { StatusChip } from './status-chip';
import { SUPPLIERS, TEAS, pick, seedFrom } from '../examples-kit';
import type { ExampleSpec } from '../examples-kit';
import { StatementTable } from './statement-table';
import type { StatementColumn, StatementRow } from './statement-table';
import { TEA_HOUSE_COLUMNS, TEA_HOUSE_ROWS } from './statement-table.usage';

const SEED = seedFrom('StatementTable');
const s1 = pick(SEED, 0, SUPPLIERS),
  s2 = pick(SEED, 1, SUPPLIERS),
  s3 = pick(SEED, 2, SUPPLIERS);
const t1 = pick(SEED, 3, TEAS),
  t2 = pick(SEED, 4, TEAS),
  t3 = pick(SEED, 5, TEAS);

// ── A quarter's profit and loss: headings, indented lines, subtotals, a double-ruled total ─────
const ProfitAndLoss: TemplateOnlyComponent = <template>
  <StatementTable
    @label='Profit and loss, Q1 and Q2'
    @columns={{TEA_HOUSE_COLUMNS}}
    @rows={{TEA_HOUSE_ROWS}}
  />
</template>;

// ── What the tea house owes its suppliers, by how late: an aging with a total ──────────────────
const AGING_COLUMNS: StatementColumn[] = [
  { key: 'who', label: 'Supplier' },
  { key: 'current', label: 'Current', kind: 'amount' },
  { key: 'd30', label: '1–30', kind: 'amount' },
  { key: 'd60', label: '31–60', kind: 'amount', priority: 'secondary' },
  { key: 'over', label: 'Over 60', kind: 'amount' },
  { key: 'total', label: 'Total', kind: 'amount' },
];
const AGING_ROWS: StatementRow[] = [
  {
    key: 's1',
    cells: {
      who: s1,
      current: 1284000,
      d30: 0,
      d60: 0,
      over: 0,
      total: 1284000,
    },
  },
  {
    key: 's2',
    cells: {
      who: s2,
      current: 412500,
      d30: 386000,
      d60: 0,
      over: 0,
      total: 798500,
    },
  },
  {
    key: 's3',
    cells: {
      who: s3,
      current: 0,
      d30: 0,
      d60: 154000,
      over: 92000,
      total: 246000,
    },
  },
  {
    key: 'total',
    role: 'total',
    cells: {
      who: 'Total',
      current: 1696500,
      d30: 386000,
      d60: 154000,
      over: 92000,
      total: 2328500,
    },
  },
];
const SupplierAging: TemplateOnlyComponent = <template>
  <StatementTable
    @caption='Owed to suppliers, by days past due'
    @columns={{AGING_COLUMNS}}
    @rows={{AGING_ROWS}}
    @zero='dash'
  />
</template>;

// ── Budget against actuals: a variance column that always shows its sign, and a flag in a slot ───
const VARIANCE_COLUMNS: StatementColumn[] = [
  { key: 'name', label: 'Line' },
  { key: 'budget', label: 'Budget', kind: 'amount', whole: true },
  { key: 'actual', label: 'Actual', kind: 'amount', whole: true },
  {
    key: 'variance',
    label: 'Variance',
    kind: 'amount',
    whole: true,
    sign: 'change',
  },
  { key: 'pct', label: '%', kind: 'percent', scale: 4 },
  { key: 'flag', label: 'Flag', kind: 'custom' },
];
const VARIANCE_ROWS: StatementRow[] = [
  {
    key: 'sales',
    cells: {
      name: `${t1} sales`,
      budget: 2400000,
      actual: 2652000,
      variance: 252000,
      pct: 1050,
    },
  },
  {
    key: 'leaf',
    cells: {
      name: `${t2} leaf`,
      budget: 980000,
      actual: 1137000,
      variance: -157000,
      pct: -1602,
      flag: 'Over budget',
    },
  },
  {
    key: 'tins',
    cells: {
      name: `${t3} tins and labels`,
      budget: 210000,
      actual: 198500,
      variance: 11500,
      pct: 548,
    },
  },
  {
    key: 'net',
    role: 'total',
    cells: {
      name: 'Contribution',
      budget: 1210000,
      actual: 1316500,
      variance: 106500,
      pct: 880,
    },
  },
];
const text = (value: unknown) => String(value ?? '');
const BudgetVariance: TemplateOnlyComponent = <template>
  <StatementTable
    @label='Budget against actuals, this month'
    @columns={{VARIANCE_COLUMNS}}
    @rows={{VARIANCE_ROWS}}
    @density='compact'
  >
    <:cell as |value|>{{#if value}}<StatusChip
          @value={{text value}}
          @tone='danger'
        />{{/if}}</:cell>
  </StatementTable>
</template>;

export const EXAMPLES_STATEMENT_TABLE: Record<string, ExampleSpec[]> = {
  StatementTable: [
    {
      title: 'A quarter’s profit and loss',
      note: 'Headings, indented lines, a rule over each subtotal and a double rule under net income. Q1’s loss sits in parentheses, and the zero adjustment is left blank. Q2 folds away when the table is narrow.',
      component: ProfitAndLoss,
    },
    {
      title: 'What the tea house owes',
      note: `${s1}, ${s2} and ${s3}, aged by days past due. Zero is a dash here, so an empty bucket reads as checked rather than missing.`,
      component: SupplierAging,
    },
    {
      title: 'Budget against actuals',
      note: `A variance column always shows its sign; the flag is a StatusChip in a custom column. ${t2} leaf ran over.`,
      component: BudgetVariance,
    },
  ],
};
