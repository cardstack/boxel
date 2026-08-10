import GlimmerComponent from '@glimmer/component';
import type Owner from '@ember/owner';
import {
  identifyCard,
  realmURL,
  type getCards,
} from '@cardstack/runtime-common';
import type { Account } from './account';
import { Invoice } from './invoice';
import { Subscription } from './subscription';
import { formatMoney, outstandingBalance, sumLineItems } from './money';

const OPEN_STATUSES = ['sent', 'viewed', 'partial', 'overdue'];

interface AccountMetricsSignature {
  Args: {
    account: Account | undefined;
    context?: any;
  };
  Element: HTMLElement;
}

export class AccountMetrics extends GlimmerComponent<AccountMetricsSignature> {
  private invoiceList: ReturnType<getCards> | undefined;
  private subscriptionList: ReturnType<getCards> | undefined;

  constructor(owner: Owner, args: AccountMetricsSignature['Args']) {
    super(owner, args);
    this.invoiceList = this.args.context?.getCards(
      this,
      () => {
        let ref = identifyCard(Invoice);
        return ref ? { filter: { type: ref } } : undefined;
      },
      () => this.realms,
      { isLive: true },
    );
    this.subscriptionList = this.args.context?.getCards(
      this,
      () => {
        let ref = identifyCard(Subscription);
        return ref ? { filter: { type: ref } } : undefined;
      },
      () => this.realms,
      { isLive: true },
    );
  }

  private get realms(): string[] | undefined {
    let url = (this.args.account as any)?.[realmURL];
    return url ? [url.href] : undefined;
  }

  private get accountId() {
    return this.args.account?.id;
  }

  private get invoices(): Invoice[] {
    let id = this.accountId;
    if (!id) return [];
    return ((this.invoiceList?.instances ?? []) as Invoice[]).filter(
      (inv) => inv?.account?.id === id,
    );
  }

  private get subscriptions(): Subscription[] {
    let id = this.accountId;
    if (!id) return [];
    return ((this.subscriptionList?.instances ?? []) as Subscription[]).filter(
      (sub) => sub?.account?.id === id,
    );
  }

  private sumInvoices(list: Invoice[]): { total: number; code?: string } {
    let total = 0;
    let code: string | undefined;
    for (let inv of list) {
      let { total: t, code: c } = sumLineItems(inv.lineItems);
      total += t;
      code = code ?? c;
    }
    return { total, code };
  }

  get mrr(): { amount: number; code?: string } {
    let amount = 0;
    let code: string | undefined;
    for (let sub of this.subscriptions) {
      if (!['active', 'trial'].includes(sub.status ?? '')) continue;
      let price = sub.price?.amount ?? 0;
      amount += sub.billingCycle === 'yearly' ? price / 12 : price;
      code = code ?? sub.price?.currency?.code ?? undefined;
    }
    return { amount, code };
  }

  get metrics() {
    let { amount: mrr, code: mrrCode } = this.mrr;
    let code = mrrCode ?? 'USD';
    let open = this.invoices.filter((i) =>
      OPEN_STATUSES.includes(i.status ?? ''),
    );
    let paid = this.invoices.filter((i) => i.status === 'paid');
    let outstanding = {
      total: open.reduce(
        (acc, i) => acc + outstandingBalance(i.lineItems, i.payments),
        0,
      ),
      code: this.sumInvoices(open).code,
    };
    let collected = this.sumInvoices(paid);
    let overdueCount = this.invoices.filter(
      (i) => (i.daysOverdue ?? 0) > 0,
    ).length;
    return [
      { label: 'MRR', value: formatMoney(mrr, code) },
      { label: 'ARR', value: formatMoney(mrr * 12, code) },
      {
        label: 'Outstanding',
        value: formatMoney(outstanding.total, outstanding.code ?? code),
      },
      {
        label: 'Collected',
        value: formatMoney(collected.total, collected.code ?? code),
      },
      { label: 'Overdue invoices', value: String(overdueCount) },
    ];
  }

  <template>
    <div class='metrics' ...attributes>
      {{#each this.metrics as |metric|}}
        <div class='metric'>
          <span class='label'>{{metric.label}}</span>
          <span class='value'>{{metric.value}}</span>
        </div>
      {{/each}}
    </div>
    <style scoped>
      .metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
        gap: 0.75rem;
        width: 100%;
      }
      .metric {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 0.75rem;
        padding: 0.875rem 1rem;
        background: var(--card, #ffffff);
      }
      .label {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--muted-foreground, #6b7280);
      }
      .value {
        font-size: 1.375rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        line-height: 1.1;
      }
    </style>
  </template>
}
