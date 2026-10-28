import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import DateField from '@cardstack/base/date';
import TextAreaField from '@cardstack/base/text-area';
import BooleanField from '@cardstack/base/boolean';
import enumField from '@cardstack/base/enum';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { eq, gt, lt, not } from '@cardstack/boxel-ui/helpers';
import { formatCurrency, formatDateTime } from '@cardstack/boxel-ui/helpers';
import WalletIcon from '@cardstack/boxel-icons/wallet';
import ReceiptIcon from '@cardstack/boxel-icons/receipt';
import BookIcon from '@cardstack/boxel-icons/book-open';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const CATEGORY_OPTIONS = [
  { value: 'housing', label: 'Housing' },
  { value: 'groceries', label: 'Groceries' },
  { value: 'dining', label: 'Dining out' },
  { value: 'transport', label: 'Transport' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'health', label: 'Health' },
  { value: 'kids', label: 'Kids' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'travel', label: 'Travel' },
  { value: 'gifts', label: 'Gifts' },
  { value: 'savings', label: 'Savings' },
  { value: 'income', label: 'Income' },
  { value: 'other', label: 'Other' },
];

export const CATEGORY_COLORS: Record<string, string> = {
  housing: 'var(--chart-1, #4f6bed)',
  groceries: 'var(--chart-2, #2fa36b)',
  dining: 'var(--chart-3, #e3884b)',
  transport: 'var(--chart-4, #8b5cf6)',
  utilities: 'var(--chart-5, #0ea5b7)',
  health: 'var(--chart-1, #d9467a)',
  kids: 'var(--chart-2, #c9a227)',
  entertainment: 'var(--chart-3, #5b8def)',
  travel: 'var(--chart-4, #19a1a1)',
  gifts: 'var(--chart-5, #b8578e)',
  savings: 'var(--chart-1, #3c9d4f)',
  income: 'var(--chart-2, #1f7a4d)',
  other: 'var(--muted-foreground, #7a7f87)',
};

export const ACCOUNT_KIND_OPTIONS = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit card' },
  { value: 'cash', label: 'Cash' },
];

export const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'One-off' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function categoryLabel(value: string | undefined): string {
  if (!value) {
    return 'Uncategorized';
  }
  return CATEGORY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function categoryColor(value: string | undefined): string {
  return CATEGORY_COLORS[value ?? 'other'] ?? CATEGORY_COLORS.other;
}

export function accountKindLabel(value: string | undefined): string {
  if (!value) {
    return 'Account';
  }
  return ACCOUNT_KIND_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function monthKey(date: Date | string | undefined): string {
  if (!date) {
    return 'unknown';
  }
  let d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return 'unknown';
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(key: string): string {
  if (key === 'unknown') {
    return 'Undated';
  }
  let [year, month] = key.split('-');
  let index = Number(month) - 1;
  return `${MONTH_NAMES[index] ?? month} ${year}`;
}

export function signedAmount(
  amount: number | undefined,
  isIncome: boolean | undefined,
): number {
  let value = Math.abs(amount ?? 0);
  return isIncome ? value : -value;
}

export function sum(values: number[]): number {
  return values.reduce((total, v) => total + (Number.isFinite(v) ? v : 0), 0);
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function percentOf(part: number, whole: number): number {
  if (!whole) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

interface TransactionLike {
  amount?: number;
  isIncome?: boolean;
  category?: string;
  date?: Date | string;
  merchant?: string;
}

export interface CategoryTotal {
  category: string;
  label: string;
  total: number;
  percent: number;
  color: string;
}

export function spendingByCategory(
  transactions: TransactionLike[],
): CategoryTotal[] {
  let totals = new Map<string, number>();
  for (let t of transactions) {
    if (t.isIncome) {
      continue;
    }
    let key = t.category ?? 'other';
    totals.set(key, (totals.get(key) ?? 0) + Math.abs(t.amount ?? 0));
  }
  let grand = sum([...totals.values()]);
  return [...totals.entries()]
    .map(([category, total]) => ({
      category,
      label: categoryLabel(category),
      total: roundMoney(total),
      percent: percentOf(total, grand),
      color: categoryColor(category),
    }))
    .sort((a, b) => b.total - a.total);
}

export interface MonthSummary {
  key: string;
  label: string;
  income: number;
  spending: number;
  net: number;
}

export function summarizeByMonth(
  transactions: TransactionLike[],
): MonthSummary[] {
  let months = new Map<string, { income: number; spending: number }>();
  for (let t of transactions) {
    let key = monthKey(t.date);
    let entry = months.get(key) ?? { income: 0, spending: 0 };
    if (t.isIncome) {
      entry.income += Math.abs(t.amount ?? 0);
    } else {
      entry.spending += Math.abs(t.amount ?? 0);
    }
    months.set(key, entry);
  }
  return [...months.entries()]
    .map(([key, v]) => ({
      key,
      label: monthLabel(key),
      income: roundMoney(v.income),
      spending: roundMoney(v.spending),
      net: roundMoney(v.income - v.spending),
    }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}

export function topMerchants(
  transactions: TransactionLike[],
  limit = 5,
): { merchant: string; total: number; count: number }[] {
  let totals = new Map<string, { total: number; count: number }>();
  for (let t of transactions) {
    if (t.isIncome || !t.merchant) {
      continue;
    }
    let entry = totals.get(t.merchant) ?? { total: 0, count: 0 };
    entry.total += Math.abs(t.amount ?? 0);
    entry.count += 1;
    totals.set(t.merchant, entry);
  }
  return [...totals.entries()]
    .map(([merchant, v]) => ({
      merchant,
      total: roundMoney(v.total),
      count: v.count,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function savingsRate(income: number, spending: number): number {
  if (income <= 0) {
    return 0;
  }
  return Math.round(((income - spending) / income) * 100);
}

// ---------------------------------------------------------------------------
// Field definitions
// ---------------------------------------------------------------------------

export const CategoryField = enumField(StringField, {
  options: CATEGORY_OPTIONS,
});

export const AccountKindField = enumField(StringField, {
  options: ACCOUNT_KIND_OPTIONS,
});

export const RecurrenceField = enumField(StringField, {
  options: RECURRENCE_OPTIONS,
});

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export class Account extends CardDef {
  static displayName = 'Account';
  static icon = WalletIcon;

  @field accountName = contains(StringField);
  @field institution = contains(StringField);
  @field kind = contains(AccountKindField);
  @field openingBalance = contains(NumberField);
  @field lastFour = contains(StringField);
  @field notes = contains(TextAreaField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Account) {
      return this.cardInfo?.name ?? this.accountName ?? 'Untitled Account';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get kindLabel() {
      return accountKindLabel(this.args.model.kind);
    }

    get maskedNumber() {
      let lastFour = this.args.model.lastFour;
      return lastFour ? `•••• ${lastFour}` : 'No number on file';
    }

    get isCredit() {
      return this.args.model.kind === 'credit';
    }

    <template>
      <article class='account'>
        <header class='hero'>
          <div class='hero-text'>
            <p class='eyebrow'>{{this.kindLabel}}</p>
            <h1><@fields.cardTitle /></h1>
            <p class='institution'>
              {{if @model.institution @model.institution 'Unknown bank'}}
              ·
              {{this.maskedNumber}}
            </p>
          </div>
          <div class='balance'>
            <span class='balance-label'>
              {{if this.isCredit 'Opening balance owed' 'Opening balance'}}
            </span>
            <span class='balance-value'>
              {{formatCurrency @model.openingBalance currency='USD'}}
            </span>
          </div>
        </header>
        <section class='details'>
          <h2>Details</h2>
          <dl>
            <div>
              <dt>Type</dt>
              <dd>{{this.kindLabel}}</dd>
            </div>
            <div>
              <dt>Institution</dt>
              <dd>{{if @model.institution @model.institution '—'}}</dd>
            </div>
            <div>
              <dt>Number</dt>
              <dd>{{this.maskedNumber}}</dd>
            </div>
          </dl>
        </section>
        {{#if @model.notes}}
          <section class='notes'>
            <h2>Notes</h2>
            <p>{{@model.notes}}</p>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .account {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-xl);
          max-width: 760px;
          margin: 0 auto;
          color: var(--foreground);
          background: var(--background);
        }
        .hero {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: flex-end;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-lg);
          border-radius: var(--radius, 16px);
          background: var(--card);
          border: 1px solid var(--border);
        }
        .eyebrow {
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
        }
        h1 {
          margin: var(--boxel-sp-4xs) 0;
          font-size: var(--boxel-font-size-xl);
        }
        .institution {
          margin: 0;
          color: var(--muted-foreground);
        }
        .balance {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }
        .balance-label {
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground);
        }
        .balance-value {
          font-size: var(--boxel-font-size-xxl);
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .details,
        .notes {
          padding: var(--boxel-sp-lg);
          border-radius: var(--radius, 16px);
          border: 1px solid var(--border);
          background: var(--card);
        }
        h2 {
          margin: 0 0 var(--boxel-sp-sm);
          font-size: var(--boxel-font-size-md);
        }
        dl {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: var(--boxel-sp);
          margin: 0;
        }
        dt {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
        }
        dd {
          margin: 0;
          font-weight: 600;
        }
        .notes p {
          margin: 0;
          white-space: pre-wrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get kindLabel() {
      return accountKindLabel(this.args.model.kind);
    }

    <template>
      <div class='account-row'>
        <div class='name'>
          <strong><@fields.cardTitle /></strong>
          <span class='meta'>
            {{this.kindLabel}}
            {{#if @model.lastFour}}· •••• {{@model.lastFour}}{{/if}}
          </span>
        </div>
        <span class='balance'>
          {{formatCurrency @model.openingBalance currency='USD' size='short'}}
        </span>
      </div>
      <style scoped>
        .account-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-sm) var(--boxel-sp);
        }
        .name {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .meta {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
        }
        .balance {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get kindLabel() {
      return accountKindLabel(this.args.model.kind);
    }

    <template>
      <div class='fit'>
        <span class='kind'>{{this.kindLabel}}</span>
        <span class='title'><@fields.cardTitle /></span>
        <span class='balance'>
          {{formatCurrency @model.openingBalance currency='USD' size='short'}}
        </span>
      </div>
      <style scoped>
        .fit {
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          height: 100%;
          padding: var(--boxel-sp-xs);
          gap: var(--boxel-sp-5xs);
          overflow: hidden;
        }
        .kind {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground);
        }
        .title {
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .balance {
          font-variant-numeric: tabular-nums;
        }
        @container fitted-card (height < 60px) {
          .kind,
          .balance {
            display: none;
          }
        }
        @container fitted-card (width > 250px) and (height > 120px) {
          .title {
            font-size: var(--boxel-font-size-lg);
            white-space: normal;
          }
          .balance {
            font-size: var(--boxel-font-size-lg);
          }
        }
      </style>
    </template>
  };
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

export class Transaction extends CardDef {
  static displayName = 'Transaction';
  static icon = ReceiptIcon;

  @field merchant = contains(StringField);
  @field date = contains(DateField);
  @field amount = contains(NumberField);
  @field isIncome = contains(BooleanField);
  @field category = contains(CategoryField);
  @field recurrence = contains(RecurrenceField);
  @field account = linksTo(() => Account);
  @field memo = contains(TextAreaField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Transaction) {
      return this.cardInfo?.name ?? this.merchant ?? 'Untitled Transaction';
    },
  });

  @field signedValue = contains(NumberField, {
    computeVia: function (this: Transaction) {
      return signedAmount(this.amount, this.isIncome);
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get categoryText() {
      return categoryLabel(this.args.model.category);
    }

    get swatchStyle() {
      return htmlSafe(`--swatch: ${categoryColor(this.args.model.category)}`);
    }

    get recurrenceText() {
      let value = this.args.model.recurrence;
      return RECURRENCE_OPTIONS.find((o) => o.value === value)?.label ?? 'One-off';
    }

    <template>
      <article class='transaction' style={{this.swatchStyle}}>
        <header class='hero'>
          <span class='badge'>{{this.categoryText}}</span>
          <h1><@fields.cardTitle /></h1>
          <p class='amount {{if @model.isIncome "income" "expense"}}'>
            {{if @model.isIncome '+' '−'}}{{formatCurrency
              @model.amount
              currency='USD'
            }}
          </p>
          <p class='date'>
            {{formatDateTime @model.date preset='long' fallback='No date'}}
            · {{this.recurrenceText}}
          </p>
        </header>

        <section class='panel'>
          <h2>Paid from</h2>
          {{#if @model.account}}
            <@fields.account @format='embedded' />
          {{else}}
            <p class='empty'>No account linked yet.</p>
          {{/if}}
        </section>

        {{#if @model.memo}}
          <section class='panel'>
            <h2>Memo</h2>
            <p class='memo'>{{@model.memo}}</p>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .transaction {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-xl);
          max-width: 720px;
          margin: 0 auto;
          color: var(--foreground);
          background: var(--background);
        }
        .hero {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-lg);
          border-radius: var(--radius, 16px);
          border: 1px solid var(--border);
          border-top: 6px solid var(--swatch);
          background: var(--card);
        }
        .badge {
          align-self: flex-start;
          padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
          border-radius: 999px;
          background: color-mix(in srgb, var(--swatch) 18%, transparent);
          color: var(--foreground);
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
        }
        .amount {
          margin: 0;
          font-size: var(--boxel-font-size-xxl);
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .amount.income {
          color: var(--chart-2, #1f7a4d);
        }
        .date {
          margin: 0;
          color: var(--muted-foreground);
        }
        .panel {
          padding: var(--boxel-sp-lg);
          border-radius: var(--radius, 16px);
          border: 1px solid var(--border);
          background: var(--card);
        }
        h2 {
          margin: 0 0 var(--boxel-sp-sm);
          font-size: var(--boxel-font-size-md);
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground);
        }
        .memo {
          margin: 0;
          white-space: pre-wrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get swatchStyle() {
      return htmlSafe(`--swatch: ${categoryColor(this.args.model.category)}`);
    }

    get categoryText() {
      return categoryLabel(this.args.model.category);
    }

    <template>
      <div class='txn-row' style={{this.swatchStyle}}>
        <span class='swatch' aria-hidden='true'></span>
        <div class='main'>
          <strong><@fields.cardTitle /></strong>
          <span class='meta'>
            {{this.categoryText}}
            ·
            {{formatDateTime @model.date preset='short' fallback='No date'}}
          </span>
        </div>
        <span class='amount {{if @model.isIncome "income"}}'>
          {{if @model.isIncome '+' '−'}}{{formatCurrency
            @model.amount
            currency='USD'
            size='short'
          }}
        </span>
      </div>
      <style scoped>
        .txn-row {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-xs) var(--boxel-sp);
        }
        .swatch {
          width: 10px;
          height: 32px;
          border-radius: 4px;
          background: var(--swatch);
        }
        .main {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .main strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
        }
        .amount {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        .amount.income {
          color: var(--chart-2, #1f7a4d);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get swatchStyle() {
      return htmlSafe(`--swatch: ${categoryColor(this.args.model.category)}`);
    }

    get categoryText() {
      return categoryLabel(this.args.model.category);
    }

    <template>
      <div class='fit' style={{this.swatchStyle}}>
        <span class='category'>{{this.categoryText}}</span>
        <span class='title'><@fields.cardTitle /></span>
        <span class='amount'>
          {{if @model.isIncome '+' '−'}}{{formatCurrency
            @model.amount
            currency='USD'
            size='short'
          }}
        </span>
      </div>
      <style scoped>
        .fit {
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          height: 100%;
          padding: var(--boxel-sp-xs);
          border-left: 4px solid var(--swatch);
          overflow: hidden;
        }
        .category {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
        }
        .title {
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .amount {
          font-variant-numeric: tabular-nums;
        }
        @container fitted-card (height < 60px) {
          .category {
            display: none;
          }
        }
        @container fitted-card (width > 250px) and (height > 120px) {
          .title {
            font-size: var(--boxel-font-size-lg);
            white-space: normal;
          }
          .amount {
            font-size: var(--boxel-font-size-lg);
          }
        }
      </style>
    </template>
  };
}

// ---------------------------------------------------------------------------
// Ledger (the app card)
// ---------------------------------------------------------------------------

class HomeLedgerIsolated extends Component<typeof HomeLedger> {
  @tracked activeTab: 'overview' | 'transactions' | 'accounts' = 'overview';
  @tracked categoryFilter: string | undefined;
  @tracked showIncome = true;

  get allTransactions(): Transaction[] {
    return (this.args.model.transactions ?? []).filter(
      Boolean,
    ) as Transaction[];
  }

  get allAccounts(): Account[] {
    return (this.args.model.accounts ?? []).filter(Boolean) as Account[];
  }

  get filteredTransactions(): Transaction[] {
    let list = this.allTransactions;
    if (this.categoryFilter) {
      list = list.filter((t) => t.category === this.categoryFilter);
    }
    if (!this.showIncome) {
      list = list.filter((t) => !t.isIncome);
    }
    return [...list].sort((a, b) => {
      let ad = a.date ? new Date(a.date).getTime() : 0;
      let bd = b.date ? new Date(b.date).getTime() : 0;
      return bd - ad;
    });
  }

  get months(): MonthSummary[] {
    return summarizeByMonth(this.allTransactions);
  }

  get currentMonth(): MonthSummary | undefined {
    return this.months[0];
  }

  get previousMonth(): MonthSummary | undefined {
    return this.months[1];
  }

  get categories(): CategoryTotal[] {
    let current = this.currentMonth;
    if (!current) {
      return [];
    }
    return spendingByCategory(
      this.allTransactions.filter((t) => monthKey(t.date) === current.key),
    );
  }

  get merchants() {
    return topMerchants(this.allTransactions, 6);
  }

  get budget(): number {
    return this.args.model.monthlyBudget ?? 0;
  }

  get spentThisMonth(): number {
    return this.currentMonth?.spending ?? 0;
  }

  get incomeThisMonth(): number {
    return this.currentMonth?.income ?? 0;
  }

  get budgetPercent(): number {
    return percentOf(this.spentThisMonth, this.budget);
  }

  get budgetRemaining(): number {
    return roundMoney(this.budget - this.spentThisMonth);
  }

  get overBudget(): boolean {
    return this.budget > 0 && this.spentThisMonth > this.budget;
  }

  get budgetBarStyle() {
    return htmlSafe(`--fill: ${Math.min(this.budgetPercent, 100)}%`);
  }

  get rate(): number {
    return savingsRate(this.incomeThisMonth, this.spentThisMonth);
  }

  get spendingChange(): number {
    let current = this.currentMonth?.spending ?? 0;
    let previous = this.previousMonth?.spending ?? 0;
    return roundMoney(current - previous);
  }

  get spendingUp(): boolean {
    return this.spendingChange > 0;
  }

  get maxMonthValue(): number {
    return Math.max(
      1,
      ...this.months.map((m) => Math.max(m.income, m.spending)),
    );
  }

  barStyle = (value: number) => {
    return htmlSafe(
      `--height: ${Math.round((value / this.maxMonthValue) * 100)}%`,
    );
  };

  categoryStyle = (category: CategoryTotal) => {
    return htmlSafe(
      `--swatch: ${category.color}; --width: ${category.percent}%`,
    );
  };

  accountTransactions = (account: Account) => {
    return this.allTransactions.filter((t) => t.account?.id === account.id);
  };

  accountBalance = (account: Account) => {
    let movements = this.accountTransactions(account).map((t) =>
      signedAmount(t.amount, t.isIncome),
    );
    return roundMoney((account.openingBalance ?? 0) + sum(movements));
  };

  accountCount = (account: Account) => {
    return this.accountTransactions(account).length;
  };

  get totalBalance(): number {
    return roundMoney(sum(this.allAccounts.map((a) => this.accountBalance(a))));
  }

  get categoryChips() {
    let used = new Set(this.allTransactions.map((t) => t.category ?? 'other'));
    return CATEGORY_OPTIONS.filter((o) => used.has(o.value));
  }

  setTab = (tab: 'overview' | 'transactions' | 'accounts') => {
    this.activeTab = tab;
  };

  setCategory = (category: string | undefined) => {
    this.categoryFilter =
      this.categoryFilter === category ? undefined : category;
  };

  toggleIncome = () => {
    this.showIncome = !this.showIncome;
  };

  get hasTransactions(): boolean {
    return this.allTransactions.length > 0;
  }

  get hasAccounts(): boolean {
    return this.allAccounts.length > 0;
  }

  get savingsGoal(): number {
    return this.args.model.savingsGoal ?? 0;
  }

  get savedSoFar(): number {
    return roundMoney(
      sum(
        this.allTransactions
          .filter((t) => t.category === 'savings')
          .map((t) => Math.abs(t.amount ?? 0)),
      ),
    );
  }

  get savingsPercent(): number {
    return percentOf(this.savedSoFar, this.savingsGoal);
  }

  get savingsBarStyle() {
    return htmlSafe(`--fill: ${this.savingsPercent}%`);
  }

  <template>
    <div class='ledger'>
      <header class='top'>
        <div class='title-block'>
          <p class='eyebrow'>Household ledger</p>
          <h1><@fields.cardTitle /></h1>
          {{#if this.currentMonth}}
            <p class='subtitle'>{{this.currentMonth.label}}</p>
          {{/if}}
        </div>
        <nav class='tabs' aria-label='Ledger sections'>
          <button
            type='button'
            class='tab {{if (eq this.activeTab "overview") "active"}}'
            {{on 'click' (fn this.setTab 'overview')}}
          >Overview</button>
          <button
            type='button'
            class='tab {{if (eq this.activeTab "transactions") "active"}}'
            {{on 'click' (fn this.setTab 'transactions')}}
          >Transactions</button>
          <button
            type='button'
            class='tab {{if (eq this.activeTab "accounts") "active"}}'
            {{on 'click' (fn this.setTab 'accounts')}}
          >Accounts</button>
        </nav>
      </header>

      {{#if (eq this.activeTab 'overview')}}
        <section class='stats'>
          <div class='stat'>
            <span class='stat-label'>Spent this month</span>
            <span class='stat-value'>
              {{formatCurrency this.spentThisMonth currency='USD'}}
            </span>
            {{#if this.previousMonth}}
              <span class='stat-delta {{if this.spendingUp "up" "down"}}'>
                {{if this.spendingUp '▲' '▼'}}
                {{formatCurrency this.spendingChange currency='USD'}}
                vs
                {{this.previousMonth.label}}
              </span>
            {{/if}}
          </div>
          <div class='stat'>
            <span class='stat-label'>Income this month</span>
            <span class='stat-value'>
              {{formatCurrency this.incomeThisMonth currency='USD'}}
            </span>
            <span class='stat-delta'>Savings rate {{this.rate}}%</span>
          </div>
          <div class='stat'>
            <span class='stat-label'>Across all accounts</span>
            <span class='stat-value'>
              {{formatCurrency this.totalBalance currency='USD'}}
            </span>
            <span class='stat-delta'>
              {{this.allAccounts.length}}
              accounts
            </span>
          </div>
        </section>

        <section class='grid'>
          <div class='panel budget'>
            <div class='panel-head'>
              <h2>Monthly budget</h2>
              <span class='panel-meta'>
                {{formatCurrency this.budget currency='USD'}}
              </span>
            </div>
            {{#if (gt this.budget 0)}}
              <div
                class='bar {{if this.overBudget "over"}}'
                style={{this.budgetBarStyle}}
                role='progressbar'
                aria-valuenow={{this.budgetPercent}}
                aria-valuemin='0'
                aria-valuemax='100'
                aria-label='Budget used'
              >
                <span class='fill'></span>
              </div>
              <p class='budget-text'>
                {{#if this.overBudget}}
                  Over budget by
                  {{formatCurrency
                    (this.absolute this.budgetRemaining)
                    currency='USD'
                  }}
                {{else}}
                  {{formatCurrency this.budgetRemaining currency='USD'}}
                  left ({{this.budgetPercent}}% used)
                {{/if}}
              </p>
            {{else}}
              <p class='empty'>Set a monthly budget to track it here.</p>
            {{/if}}
          </div>

          <div class='panel savings'>
            <div class='panel-head'>
              <h2>Savings goal</h2>
              <span class='panel-meta'>
                {{formatCurrency this.savingsGoal currency='USD'}}
              </span>
            </div>
            {{#if (gt this.savingsGoal 0)}}
              <div
                class='bar savings-bar'
                style={{this.savingsBarStyle}}
                role='progressbar'
                aria-valuenow={{this.savingsPercent}}
                aria-valuemin='0'
                aria-valuemax='100'
                aria-label='Savings progress'
              >
                <span class='fill'></span>
              </div>
              <p class='budget-text'>
                {{formatCurrency this.savedSoFar currency='USD'}}
                saved ({{this.savingsPercent}}%)
              </p>
            {{else}}
              <p class='empty'>Set a savings goal to track it here.</p>
            {{/if}}
          </div>

          <div class='panel categories'>
            <div class='panel-head'>
              <h2>Where it went</h2>
              {{#if this.currentMonth}}
                <span class='panel-meta'>{{this.currentMonth.label}}</span>
              {{/if}}
            </div>
            {{#if this.categories.length}}
              <ul class='category-list'>
                {{#each this.categories as |category|}}
                  <li style={{this.categoryStyle category}}>
                    <div class='category-head'>
                      <span class='swatch' aria-hidden='true'></span>
                      <span class='category-name'>{{category.label}}</span>
                      <span class='category-total'>
                        {{formatCurrency category.total currency='USD'}}
                      </span>
                    </div>
                    <div class='category-bar'>
                      <span class='category-fill'></span>
                    </div>
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class='empty'>No spending recorded this month.</p>
            {{/if}}
          </div>

          <div class='panel trend'>
            <div class='panel-head'>
              <h2>Month by month</h2>
            </div>
            {{#if this.months.length}}
              <div class='chart' role='img' aria-label='Income and spending by month'>
                {{#each this.months as |month|}}
                  <div class='chart-col'>
                    <div class='chart-bars'>
                      <span
                        class='chart-bar income'
                        style={{this.barStyle month.income}}
                      ></span>
                      <span
                        class='chart-bar spending'
                        style={{this.barStyle month.spending}}
                      ></span>
                    </div>
                    <span class='chart-label'>{{month.label}}</span>
                  </div>
                {{/each}}
              </div>
              <div class='legend'>
                <span class='legend-item'>
                  <span class='legend-swatch income'></span>Income
                </span>
                <span class='legend-item'>
                  <span class='legend-swatch spending'></span>Spending
                </span>
              </div>
            {{else}}
              <p class='empty'>No months to show yet.</p>
            {{/if}}
          </div>

          <div class='panel merchants'>
            <div class='panel-head'>
              <h2>Top merchants</h2>
            </div>
            {{#if this.merchants.length}}
              <ol class='merchant-list'>
                {{#each this.merchants as |merchant|}}
                  <li>
                    <span class='merchant-name'>{{merchant.merchant}}</span>
                    <span class='merchant-count'>
                      {{merchant.count}}
                      visits
                    </span>
                    <span class='merchant-total'>
                      {{formatCurrency merchant.total currency='USD'}}
                    </span>
                  </li>
                {{/each}}
              </ol>
            {{else}}
              <p class='empty'>No merchants yet.</p>
            {{/if}}
          </div>

          <div class='panel recent'>
            <div class='panel-head'>
              <h2>Recent activity</h2>
              <button
                type='button'
                class='link-button'
                {{on 'click' (fn this.setTab 'transactions')}}
              >See all</button>
            </div>
            {{#if this.hasTransactions}}
              <ul class='recent-list'>
                {{#each this.filteredTransactions as |txn index|}}
                  {{#if (lt index 5)}}
                    <li>
                      <span class='recent-name'>{{txn.cardTitle}}</span>
                      <span class='recent-category'>
                        {{this.categoryName txn.category}}
                      </span>
                      <span
                        class='recent-amount {{if txn.isIncome "income"}}'
                      >
                        {{if txn.isIncome '+' '−'}}{{formatCurrency
                          txn.amount
                          currency='USD'
                        }}
                      </span>
                    </li>
                  {{/if}}
                {{/each}}
              </ul>
            {{else}}
              <p class='empty'>No transactions yet.</p>
            {{/if}}
          </div>
        </section>
      {{/if}}

      {{#if (eq this.activeTab 'transactions')}}
        <section class='panel transactions'>
          <div class='panel-head'>
            <h2>Transactions</h2>
            <label class='toggle'>
              <input
                type='checkbox'
                checked={{this.showIncome}}
                {{on 'change' this.toggleIncome}}
              />
              Show income
            </label>
          </div>
          <div class='chips' role='group' aria-label='Filter by category'>
            {{#each this.categoryChips as |chip|}}
              <button
                type='button'
                class='chip {{if (eq this.categoryFilter chip.value) "active"}}'
                {{on 'click' (fn this.setCategory chip.value)}}
              >{{chip.label}}</button>
            {{/each}}
          </div>
          {{#if this.filteredTransactions.length}}
            <ul class='recent-list transaction-list'>
              {{#each this.filteredTransactions as |txn|}}
                <li>
                  <span class='recent-name'>{{txn.cardTitle}}</span>
                  <span class='recent-category'>
                    {{this.categoryName txn.category}}
                    ·
                    {{formatDateTime txn.date preset='short' fallback='No date'}}
                  </span>
                  <span class='recent-amount {{if txn.isIncome "income"}}'>
                    {{if txn.isIncome '+' '−'}}{{formatCurrency
                      txn.amount
                      currency='USD'
                    }}
                  </span>
                </li>
              {{/each}}
            </ul>
          {{else}}
            <p class='empty'>No transactions match this filter.</p>
          {{/if}}
        </section>
      {{/if}}

      {{#if (eq this.activeTab 'accounts')}}
        <section class='panel accounts'>
          <div class='panel-head'>
            <h2>Accounts</h2>
            <span class='panel-meta'>
              Total
              {{formatCurrency this.totalBalance currency='USD'}}
            </span>
          </div>
          {{#if this.hasAccounts}}
            <ul class='account-list'>
              {{#each this.allAccounts as |account|}}
                <li class='account-item'>
                  <div class='account-main'>
                    <strong>{{account.cardTitle}}</strong>
                    <span class='account-meta'>
                      {{this.kindName account.kind}}
                      ·
                      {{this.accountCount account}}
                      transactions
                    </span>
                  </div>
                  <span class='account-balance'>
                    {{formatCurrency
                      (this.accountBalance account)
                      currency='USD'
                    }}
                  </span>
                </li>
              {{/each}}
            </ul>
          {{else}}
            <p class='empty'>Link an account to see balances.</p>
          {{/if}}
        </section>
      {{/if}}
    </div>
    <style scoped>
      .ledger {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
        min-height: 100%;
        color: var(--foreground);
        background: var(--background);
        font-family: var(--font-sans, inherit);
      }
      .top {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: flex-end;
        gap: var(--boxel-sp);
      }
      .eyebrow {
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      h1 {
        margin: var(--boxel-sp-4xs) 0 0;
        font-size: var(--boxel-font-size-xxl);
        line-height: 1.1;
      }
      .subtitle {
        margin: var(--boxel-sp-4xs) 0 0;
        color: var(--muted-foreground);
      }
      .tabs {
        display: flex;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-5xs);
        border-radius: 999px;
        background: var(--muted);
      }
      .tab {
        border: none;
        background: transparent;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        border-radius: 999px;
        font: inherit;
        font-weight: 600;
        color: var(--muted-foreground);
        cursor: pointer;
        min-height: 40px;
      }
      .tab:hover {
        color: var(--foreground);
      }
      .tab:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .tab.active {
        background: var(--background);
        color: var(--foreground);
        box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.08));
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: var(--boxel-sp);
      }
      .stat {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-lg);
        border-radius: var(--radius, 16px);
        border: 1px solid var(--border);
        background: var(--card);
      }
      .stat-label {
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
      }
      .stat-value {
        font-size: var(--boxel-font-size-xxl);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .stat-delta {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .stat-delta.up {
        color: var(--destructive, #b42318);
      }
      .stat-delta.down {
        color: var(--chart-2, #1f7a4d);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: var(--boxel-sp);
      }
      .panel {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-lg);
        border-radius: var(--radius, 16px);
        border: 1px solid var(--border);
        background: var(--card);
        min-width: 0;
      }
      .panel-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: var(--boxel-sp-sm);
      }
      h2 {
        margin: 0;
        font-size: var(--boxel-font-size-md);
      }
      .panel-meta {
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
        font-variant-numeric: tabular-nums;
      }
      .bar {
        position: relative;
        height: 14px;
        border-radius: 999px;
        background: var(--muted);
        overflow: hidden;
      }
      .bar .fill {
        position: absolute;
        inset: 0 auto 0 0;
        width: var(--fill);
        border-radius: inherit;
        background: var(--primary);
        transition: width 300ms ease;
      }
      .bar.over .fill {
        background: var(--destructive, #b42318);
      }
      .savings-bar .fill {
        background: var(--chart-2, #2fa36b);
      }
      .budget-text {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        font-variant-numeric: tabular-nums;
      }
      .category-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .category-head {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .swatch {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--swatch);
      }
      .category-name {
        font-weight: 600;
      }
      .category-total {
        font-variant-numeric: tabular-nums;
      }
      .category-bar {
        height: 6px;
        margin-top: var(--boxel-sp-5xs);
        border-radius: 999px;
        background: var(--muted);
        overflow: hidden;
      }
      .category-fill {
        display: block;
        height: 100%;
        width: var(--width);
        background: var(--swatch);
      }
      .chart {
        display: flex;
        align-items: flex-end;
        gap: var(--boxel-sp-sm);
        height: 180px;
        padding-top: var(--boxel-sp-sm);
        overflow-x: auto;
      }
      .chart-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        height: 100%;
        min-width: 56px;
      }
      .chart-bars {
        flex: 1;
        display: flex;
        align-items: flex-end;
        gap: 4px;
        width: 100%;
        justify-content: center;
      }
      .chart-bar {
        width: 16px;
        height: var(--height);
        min-height: 2px;
        border-radius: 4px 4px 0 0;
      }
      .chart-bar.income,
      .legend-swatch.income {
        background: var(--chart-2, #2fa36b);
      }
      .chart-bar.spending,
      .legend-swatch.spending {
        background: var(--chart-1, #4f6bed);
      }
      .chart-label {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        white-space: nowrap;
      }
      .legend {
        display: flex;
        gap: var(--boxel-sp);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
      }
      .legend-swatch {
        width: 10px;
        height: 10px;
        border-radius: 2px;
      }
      .merchant-list,
      .recent-list,
      .account-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      .merchant-list li,
      .recent-list li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-xs) 0;
        border-bottom: 1px solid var(--border);
      }
      .merchant-list li:last-child,
      .recent-list li:last-child,
      .account-list li:last-child {
        border-bottom: none;
      }
      .merchant-name,
      .recent-name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .merchant-count,
      .recent-category {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .merchant-total,
      .recent-amount {
        font-variant-numeric: tabular-nums;
      }
      .recent-amount.income {
        color: var(--chart-2, #1f7a4d);
      }
      .link-button {
        border: none;
        background: none;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        font: inherit;
        font-size: var(--boxel-font-size-sm);
        color: var(--primary);
        cursor: pointer;
        min-height: 32px;
      }
      .link-button:hover {
        text-decoration: underline;
      }
      .link-button:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        font-size: var(--boxel-font-size-sm);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-4xs);
      }
      .chip {
        border: 1px solid var(--border);
        background: var(--background);
        border-radius: 999px;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-sm);
        font: inherit;
        font-size: var(--boxel-font-size-sm);
        cursor: pointer;
        min-height: 32px;
      }
      .chip:hover {
        border-color: var(--foreground);
      }
      .chip:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .chip.active {
        background: var(--primary);
        border-color: var(--primary);
        color: var(--primary-foreground);
      }
      .account-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-sm) 0;
        border-bottom: 1px solid var(--border);
      }
      .account-main {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .account-meta {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .account-balance {
        font-size: var(--boxel-font-size-lg);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .empty {
        margin: 0;
        color: var(--muted-foreground);
      }
      @media (max-width: 640px) {
        .ledger {
          padding: var(--boxel-sp);
        }
        .grid {
          grid-template-columns: 1fr;
        }
        .tabs {
          width: 100%;
        }
        .tab {
          flex: 1;
        }
      }
    </style>
  </template>

  absolute = (value: number) => Math.abs(value);

  categoryName = (value: string | undefined) => categoryLabel(value);

  kindName = (value: string | undefined) => accountKindLabel(value);
}

export class HomeLedger extends CardDef {
  static displayName = 'Home Ledger';
  static icon = BookIcon;
  static prefersWideFormat = true;

  @field householdName = contains(StringField);
  @field monthlyBudget = contains(NumberField);
  @field savingsGoal = contains(NumberField);
  @field accounts = linksToMany(() => Account);
  @field transactions = linksToMany(() => Transaction);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: HomeLedger) {
      return (
        this.cardInfo?.name ??
        (this.householdName ? `${this.householdName} Ledger` : 'Home Ledger')
      );
    },
  });

  static isolated = HomeLedgerIsolated;

  static embedded = class Embedded extends Component<typeof this> {
    get transactions(): Transaction[] {
      return (this.args.model.transactions ?? []).filter(
        Boolean,
      ) as Transaction[];
    }

    get current(): MonthSummary | undefined {
      return summarizeByMonth(this.transactions)[0];
    }

    get budget(): number {
      return this.args.model.monthlyBudget ?? 0;
    }

    get percent(): number {
      return percentOf(this.current?.spending ?? 0, this.budget);
    }

    get barStyle() {
      return htmlSafe(`--fill: ${Math.min(this.percent, 100)}%`);
    }

    <template>
      <div class='ledger-row'>
        <div class='main'>
          <strong><@fields.cardTitle /></strong>
          {{#if this.current}}
            <span class='meta'>
              {{this.current.label}}
              ·
              {{formatCurrency this.current.spending currency='USD'}}
              spent
            </span>
          {{else}}
            <span class='meta'>No activity yet</span>
          {{/if}}
        </div>
        {{#if (gt this.budget 0)}}
          <div
            class='bar'
            style={{this.barStyle}}
            role='progressbar'
            aria-valuenow={{this.percent}}
            aria-valuemin='0'
            aria-valuemax='100'
            aria-label='Budget used'
          >
            <span class='fill'></span>
          </div>
        {{/if}}
      </div>
      <style scoped>
        .ledger-row {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-sm) var(--boxel-sp);
        }
        .main {
          display: flex;
          justify-content: space-between;
          gap: var(--boxel-sp);
          flex-wrap: wrap;
        }
        .meta {
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground);
          font-variant-numeric: tabular-nums;
        }
        .bar {
          position: relative;
          height: 8px;
          border-radius: 999px;
          background: var(--muted);
          overflow: hidden;
        }
        .fill {
          position: absolute;
          inset: 0 auto 0 0;
          width: var(--fill);
          background: var(--primary);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get transactions(): Transaction[] {
      return (this.args.model.transactions ?? []).filter(
        Boolean,
      ) as Transaction[];
    }

    get current(): MonthSummary | undefined {
      return summarizeByMonth(this.transactions)[0];
    }

    get isEmpty(): boolean {
      return !this.current;
    }

    <template>
      <div class='fit'>
        <span class='eyebrow'>Ledger</span>
        <span class='title'><@fields.cardTitle /></span>
        {{#if (not this.isEmpty)}}
          <span class='spent'>
            {{formatCurrency this.current.spending currency='USD' size='short'}}
            spent
          </span>
        {{/if}}
      </div>
      <style scoped>
        .fit {
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          height: 100%;
          padding: var(--boxel-sp-xs);
          overflow: hidden;
        }
        .eyebrow {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground);
        }
        .title {
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .spent {
          font-variant-numeric: tabular-nums;
        }
        @container fitted-card (height < 60px) {
          .eyebrow,
          .spent {
            display: none;
          }
        }
        @container fitted-card (width > 250px) and (height > 120px) {
          .title {
            font-size: var(--boxel-font-size-lg);
            white-space: normal;
          }
        }
      </style>
    </template>
  };
}
