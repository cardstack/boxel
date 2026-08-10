import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { eq } from '@cardstack/boxel-ui/helpers';
import {
  identifyCard,
  realmURL,
  type getCards,
} from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import ChartAreaIcon from '@cardstack/boxel-icons/chart-area';
import { Board, type BoardColumn } from './board';
import { Table, type TableColumn } from './table';
import { LineChart, type ChartPoint } from './line-chart';
import { AccountMetrics } from './account-metrics';
import { Opportunity, PIPELINE_STAGES } from './opportunity';
import { Account } from './account';
import { Invoice } from './invoice';
import { Subscription } from './subscription';
import { Lead } from './lead';
import { Contact } from './contact';
import { Activity } from './activity';
import ConvertLeadCommand from './convert-lead';
import CloseWonCommand from './close-won';
import RecordPaymentCommand from './record-payment';
import { formatMoney, outstandingBalance, sumLineItems } from './money';

const OPEN_INVOICE_STATUSES = ['sent', 'viewed', 'partial', 'overdue'];
const OPEN_STAGES = PIPELINE_STAGES.filter(
  (s) => s !== 'closed won' && s !== 'closed lost',
);
const TABS = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'leads', label: 'Leads' },
];
const INVOICE_FILTERS = [
  { key: 'open', label: 'Unpaid' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
  { key: 'all', label: 'All' },
];

export class RevenueOs extends CardDef {
  static displayName = 'Revenue OS';
  static icon = ChartAreaIcon;

  @field orgName = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: RevenueOs) {
      return this.orgName?.trim()?.length
        ? `Revenue OS — ${this.orgName}`
        : 'Revenue OS';
    },
  });

  static isolated = class Isolated extends Component<typeof RevenueOs> {
    @tracked activeTab = 'pipeline';
    @tracked invoiceFilter = 'open';
    @tracked ownerFilter = 'all';
    @tracked accountQuery = '';
    @tracked selectedAccountId: string | undefined;
    @tracked statusMessage = '';
    @tracked busy = false;

    private opportunityList: ReturnType<getCards> | undefined;
    private accountList: ReturnType<getCards> | undefined;
    private invoiceList: ReturnType<getCards> | undefined;
    private subscriptionList: ReturnType<getCards> | undefined;
    private leadList: ReturnType<getCards> | undefined;
    private contactList: ReturnType<getCards> | undefined;
    private activityList: ReturnType<getCards> | undefined;

    constructor(owner: Owner, args: any) {
      super(owner, args);
      let live = { isLive: true };
      let realms = () => this.realms;
      let queryFor = (type: any) => () => {
        let ref = identifyCard(type);
        return ref ? { filter: { type: ref } } : undefined;
      };
      let ctx = this.args.context;
      this.opportunityList = ctx?.getCards(
        this,
        queryFor(Opportunity),
        realms,
        live,
      );
      this.accountList = ctx?.getCards(this, queryFor(Account), realms, live);
      this.invoiceList = ctx?.getCards(this, queryFor(Invoice), realms, live);
      this.subscriptionList = ctx?.getCards(
        this,
        queryFor(Subscription),
        realms,
        live,
      );
      this.leadList = ctx?.getCards(this, queryFor(Lead), realms, live);
      this.contactList = ctx?.getCards(this, queryFor(Contact), realms, live);
      this.activityList = ctx?.getCards(this, queryFor(Activity), realms, live);
    }

    private get realms(): string[] | undefined {
      let url = (this.args.model as any)?.[realmURL];
      return url ? [url.href] : undefined;
    }

    private get realm(): string | undefined {
      return this.realms?.[0];
    }

    private get commandContext() {
      return (this.args as any).context?.commandContext;
    }

    // ── data ──────────────────────────────────────────────────────────
    get opportunities(): Opportunity[] {
      return ((this.opportunityList?.instances ?? []) as Opportunity[]).filter(
        Boolean,
      );
    }
    get accounts(): Account[] {
      return ((this.accountList?.instances ?? []) as Account[]).filter(Boolean);
    }
    get invoices(): Invoice[] {
      return ((this.invoiceList?.instances ?? []) as Invoice[]).filter(Boolean);
    }
    get subscriptions(): Subscription[] {
      return (
        (this.subscriptionList?.instances ?? []) as Subscription[]
      ).filter(Boolean);
    }
    get leads(): Lead[] {
      return ((this.leadList?.instances ?? []) as Lead[]).filter(Boolean);
    }
    get contacts(): Contact[] {
      return ((this.contactList?.instances ?? []) as Contact[]).filter(Boolean);
    }
    get activities(): Activity[] {
      return ((this.activityList?.instances ?? []) as Activity[]).filter(
        Boolean,
      );
    }

    // ── pipeline ──────────────────────────────────────────────────────
    boardColumns: BoardColumn[] = PIPELINE_STAGES.map((s) => ({
      key: s,
      label: s,
    }));
    columnKeyFor = (item: CardDef) => (item as Opportunity)?.stage;

    get owners(): string[] {
      let names = new Set<string>();
      for (let o of this.opportunities) {
        let n = o.owner?.name?.trim();
        if (n) names.add(n);
      }
      return [...names].sort();
    }

    get boardItems(): Opportunity[] {
      if (this.ownerFilter === 'all') return this.opportunities;
      return this.opportunities.filter(
        (o) => o.owner?.name === this.ownerFilter,
      );
    }

    @action setOwnerFilter(event: Event) {
      this.ownerFilter = (event.target as HTMLSelectElement).value;
    }
    onMove = async (item: CardDef, columnKey: string) => {
      (item as Opportunity).stage = columnKey;
      if (this.commandContext && this.realm) {
        await new SaveCardCommand(this.commandContext).execute({
          card: item,
          realm: this.realm,
        } as any);
      }
    };

    get stageTotals() {
      let open = this.opportunities.filter((o) =>
        OPEN_STAGES.includes(o.stage as (typeof OPEN_STAGES)[number]),
      );
      let total = 0;
      let weighted = 0;
      let code: string | undefined;
      for (let o of open) {
        let v = o.value?.amount ?? 0;
        total += v;
        weighted += (v * (o.effectiveProbability ?? 0)) / 100;
        code = code ?? o.value?.currency?.code ?? undefined;
      }
      return {
        count: open.length,
        total: formatMoney(total, code) || '$0',
        weighted: formatMoney(weighted, code) || '$0',
      };
    }

    get negotiationDeals(): Opportunity[] {
      return this.opportunities.filter((o) => o.stage === 'negotiation');
    }

    @action async closeWon(deal: Opportunity) {
      if (!this.commandContext || !this.realm) return;
      this.busy = true;
      try {
        let result: any = await new CloseWonCommand(this.commandContext).execute(
          { deal, realm: this.realm } as any,
        );
        this.statusMessage = result?.message ?? `${deal.name} closed won`;
      } catch (e: any) {
        this.statusMessage = e?.message ?? 'Close won failed';
      } finally {
        this.busy = false;
      }
    }

    // ── dashboard ─────────────────────────────────────────────────────
    get dashboardMetrics() {
      let mrr = 0;
      let code: string | undefined;
      for (let s of this.subscriptions) {
        if (!['active', 'trial'].includes(s.status ?? '')) continue;
        let p = s.price?.amount ?? 0;
        mrr += s.billingCycle === 'yearly' ? p / 12 : p;
        code = code ?? s.price?.currency?.code ?? undefined;
      }
      let won = this.opportunities.filter((o) => o.stage === 'closed won');
      let lost = this.opportunities.filter((o) => o.stage === 'closed lost');
      let closed = won.length + lost.length;
      let open = this.invoices.filter((i) =>
        OPEN_INVOICE_STATUSES.includes(i.status ?? ''),
      );
      let paid = this.invoices.filter((i) => i.status === 'paid');
      let sumOf = (list: Invoice[]) =>
        list.reduce((acc, i) => acc + sumLineItems(i.lineItems).total, 0);
      return [
        { label: 'MRR', value: formatMoney(mrr, code) || '$0' },
        { label: 'ARR', value: formatMoney(mrr * 12, code) || '$0' },
        { label: 'Pipeline', value: this.stageTotals.total },
        { label: 'Weighted forecast', value: this.stageTotals.weighted },
        {
          label: 'Win rate',
          value: closed ? `${Math.round((won.length / closed) * 100)}%` : '—',
        },
        { label: 'Outstanding', value: formatMoney(sumOf(open), code) || '$0' },
        { label: 'Collected', value: formatMoney(sumOf(paid), code) || '$0' },
      ];
    }

    get mrrTrend(): ChartPoint[] {
      let now = new Date();
      let months: ChartPoint[] = [];
      for (let back = 7; back >= 0; back--) {
        let at = new Date(now.getFullYear(), now.getMonth() - back + 1, 0);
        let mrr = 0;
        for (let s of this.subscriptions) {
          if (!['active', 'trial'].includes(s.status ?? '')) continue;
          if (!s.startDate || new Date(s.startDate) > at) continue;
          let p = s.price?.amount ?? 0;
          mrr += s.billingCycle === 'yearly' ? p / 12 : p;
        }
        months.push({
          label: at.toLocaleDateString('en-US', { month: 'short' }),
          value: Math.round(mrr),
        });
      }
      return months;
    }
    chartMoney = (n: number) => formatMoney(n, 'USD');

    get stageBars() {
      let byStage = OPEN_STAGES.map((stage) => {
        let opps = this.opportunities.filter((o) => o.stage === stage);
        return {
          stage,
          count: opps.length,
          total: opps.reduce((acc, o) => acc + (o.value?.amount ?? 0), 0),
        };
      });
      let max = Math.max(...byStage.map((b) => b.total), 1);
      return byStage.map((b) => ({
        ...b,
        display: b.total ? formatMoney(b.total, 'USD') : '',
        widthStyle: htmlSafe(`width: ${Math.round((b.total / max) * 100)}%`),
      }));
    }

    // ── accounts / 360 ────────────────────────────────────────────────
    get filteredAccounts(): Account[] {
      let q = this.accountQuery.trim().toLowerCase();
      if (!q) return this.accounts;
      let matchingContactAccountIds = new Set(
        this.contacts
          .filter((c) => c.email?.toLowerCase().includes(q))
          .map((c) => c.account?.id)
          .filter(Boolean),
      );
      return this.accounts.filter(
        (a) =>
          a.name?.toLowerCase().includes(q) ||
          a.domain?.toLowerCase().includes(q) ||
          a.email?.toLowerCase().includes(q) ||
          (a.id && matchingContactAccountIds.has(a.id)),
      );
    }

    @action setAccountQuery(event: Event) {
      this.accountQuery = (event.target as HTMLInputElement).value;
    }

    @action async logActivity() {
      let account = this.selectedAccount;
      let ref = identifyCard(Activity);
      if (!ref || !account?.id) return;
      await (this.args as any).createCard?.(ref, undefined, {
        realmURL: this.realm ? new URL(this.realm) : undefined,
        doc: {
          data: {
            attributes: {
              activityType: 'note',
              occurredAt: new Date().toISOString(),
            },
            relationships: { about: { links: { self: account.id } } },
            meta: { adoptsFrom: ref },
          },
        },
      });
    }

    @action async newLead() {
      let ref = identifyCard(Lead);
      if (!ref) return;
      await (this.args as any).createCard?.(ref, undefined, {
        realmURL: this.realm ? new URL(this.realm) : undefined,
        doc: {
          data: {
            attributes: { status: 'new' },
            meta: { adoptsFrom: ref },
          },
        },
      });
    }

    get selectedAccount(): Account | undefined {
      return (
        this.filteredAccounts.find((a) => a.id === this.selectedAccountId) ??
        this.filteredAccounts[0]
      );
    }
    @action selectAccount(account: Account) {
      this.selectedAccountId = account.id;
    }
    get accountContacts(): Contact[] {
      let id = this.selectedAccount?.id;
      return this.contacts.filter((c) => c.account?.id === id);
    }
    get accountSubscriptions(): Subscription[] {
      let id = this.selectedAccount?.id;
      return this.subscriptions.filter((s) => s.account?.id === id);
    }
    get accountActivities(): Activity[] {
      let ids = new Set<string>();
      let id = this.selectedAccount?.id;
      if (id) ids.add(id);
      for (let inv of this.invoices) {
        if (inv.account?.id === id && inv.id) ids.add(inv.id);
      }
      for (let opp of this.opportunities) {
        if (opp.account?.id === id && opp.id) ids.add(opp.id);
      }
      return this.activities
        .filter((a) => a.about?.id && ids.has(a.about.id))
        .sort(
          (a, b) =>
            new Date(b.occurredAt ?? 0).getTime() -
            new Date(a.occurredAt ?? 0).getTime(),
        );
    }

    // ── invoices ──────────────────────────────────────────────────────
    invoiceColumns: TableColumn[] = [
      {
        key: 'number',
        label: 'Invoice #',
        value: (item) => (item as Invoice).invoiceNumber,
      },
      {
        key: 'account',
        label: 'Account',
        value: (item) => (item as Invoice).account?.name,
      },
      {
        key: 'amount',
        label: 'Amount',
        align: 'right',
        value: (item) => {
          let { total, code } = sumLineItems((item as Invoice).lineItems);
          return total ? formatMoney(total, code) : undefined;
        },
        sortValue: (item) => sumLineItems((item as Invoice).lineItems).total,
      },
      {
        key: 'status',
        label: 'Status',
        value: (item) => (item as Invoice).status,
      },
      {
        key: 'due',
        label: 'Due',
        value: (item) => {
          let d = (item as Invoice).dueDate;
          return d ? new Date(d).toLocaleDateString() : undefined;
        },
        sortValue: (item) => {
          let d = (item as Invoice).dueDate;
          return d ? new Date(d).getTime() : undefined;
        },
      },
      {
        key: 'overdue',
        label: 'Days overdue',
        align: 'right',
        value: (item) => (item as Invoice).daysOverdue || undefined,
      },
    ];

    get filteredInvoices(): Invoice[] {
      let f = this.invoiceFilter;
      if (f === 'all') return this.invoices;
      if (f === 'paid') return this.invoices.filter((i) => i.status === 'paid');
      if (f === 'overdue') {
        return this.invoices.filter((i) => (i.daysOverdue ?? 0) > 0);
      }
      return this.invoices.filter((i) =>
        OPEN_INVOICE_STATUSES.includes(i.status ?? ''),
      );
    }

    get aging() {
      let buckets = { current: 0, b30: 0, b60: 0, b90: 0 };
      let code: string | undefined;
      for (let inv of this.invoices) {
        if (!OPEN_INVOICE_STATUSES.includes(inv.status ?? '')) continue;
        let { code: c } = sumLineItems(inv.lineItems);
        code = code ?? c;
        let balance = outstandingBalance(inv.lineItems, inv.payments);
        let days = inv.daysOverdue ?? 0;
        if (days <= 0) buckets.current += balance;
        else if (days <= 30) buckets.b30 += balance;
        else if (days <= 60) buckets.b60 += balance;
        else buckets.b90 += balance;
      }
      let f = (n: number) => formatMoney(n, code) || '$0';
      return [
        { label: 'Current', value: f(buckets.current) },
        { label: '1–30 days', value: f(buckets.b30) },
        { label: '31–60 days', value: f(buckets.b60) },
        { label: '60+ days', value: f(buckets.b90) },
      ];
    }

    get openInvoices(): Invoice[] {
      return this.invoices.filter((i) =>
        OPEN_INVOICE_STATUSES.includes(i.status ?? ''),
      );
    }

    balanceOf = (inv: Invoice) => outstandingBalance(inv.lineItems, inv.payments);
    balanceDisplay = (inv: Invoice) => {
      let { code } = sumLineItems(inv.lineItems);
      return formatMoney(this.balanceOf(inv), code);
    };

    @action openCard(item: CardDef) {
      (this.args as any).viewCard?.(item, 'isolated');
    }

    @action async recordBalancePayment(inv: Invoice) {
      if (!this.commandContext || !this.realm) return;
      let amount = this.balanceOf(inv);
      if (amount <= 0) return;
      this.busy = true;
      try {
        let result: any = await new RecordPaymentCommand(
          this.commandContext,
        ).execute({
          invoice: inv,
          amount,
          method: 'bank transfer',
          reference: `APP-${Date.now()}`,
          realm: this.realm,
        } as any);
        this.statusMessage = result?.message ?? 'Payment recorded';
      } catch (e: any) {
        this.statusMessage = e?.message ?? 'Recording payment failed';
      } finally {
        this.busy = false;
      }
    }

    // ── leads ─────────────────────────────────────────────────────────
    canConvert = (lead: Lead) =>
      !['converted', 'disqualified'].includes(lead.status ?? '');

    @action async convertLead(lead: Lead) {
      if (!this.commandContext || !this.realm) return;
      this.busy = true;
      try {
        let result: any = await new ConvertLeadCommand(
          this.commandContext,
        ).execute({ lead, realm: this.realm } as any);
        this.statusMessage = result?.message ?? `${lead.name} converted`;
      } catch (e: any) {
        this.statusMessage = e?.message ?? 'Convert failed';
      } finally {
        this.busy = false;
      }
    }

    @action setTab(key: string) {
      this.activeTab = key;
      this.statusMessage = '';
    }
    @action setInvoiceFilter(key: string) {
      this.invoiceFilter = key;
    }

    cardComponent = (card: CardDef) => {
      return (card.constructor as typeof CardDef).getComponent(card);
    };

    <template>
      <div class='app'>
        <header class='app-head'>
          <div class='brand'>
            <ChartAreaIcon class='brand-icon' />
            <h1>{{@model.cardTitle}}</h1>
          </div>
          <nav class='tabs'>
            {{#each TABS as |tab|}}
              <button
                type='button'
                class='tab {{if (eq this.activeTab tab.key) "active"}}'
                {{on 'click' (fn this.setTab tab.key)}}
              >{{tab.label}}</button>
            {{/each}}
          </nav>
        </header>

        {{#if this.statusMessage}}
          <p class='status-banner'>{{this.statusMessage}}</p>
        {{/if}}

        {{#if (eq this.activeTab 'pipeline')}}
          <section class='pane'>
            <div class='pane-head'>
              <h2>Pipeline</h2>
              {{#if this.owners.length}}
                <select
                  class='owner-select'
                  aria-label='Filter by owner'
                  {{on 'change' this.setOwnerFilter}}
                >
                  <option value='all' selected={{eq this.ownerFilter 'all'}}>All
                    owners</option>
                  {{#each this.owners as |name|}}
                    <option
                      value={{name}}
                      selected={{eq this.ownerFilter name}}
                    >{{name}}</option>
                  {{/each}}
                </select>
              {{/if}}
              <p class='pane-sub'>{{this.stageTotals.count}}
                open ·
                {{this.stageTotals.total}}
                total ·
                {{this.stageTotals.weighted}}
                weighted</p>
            </div>
            <div class='board-wrap'>
              <Board
                @boardLabel='Pipeline'
                @items={{this.boardItems}}
                @columns={{this.boardColumns}}
                @columnKeyFor={{this.columnKeyFor}}
                @onMove={{this.onMove}}
              />
            </div>
            {{#if this.negotiationDeals.length}}
              <div class='action-rail'>
                <span class='rail-label'>In negotiation</span>
                {{#each this.negotiationDeals as |deal|}}
                  <div class='rail-row'>
                    <button
                      type='button'
                      class='link-ish'
                      {{on 'click' (fn this.openCard deal)}}
                    >{{deal.name}}</button>
                    <button
                      type='button'
                      class='act'
                      disabled={{this.busy}}
                      {{on 'click' (fn this.closeWon deal)}}
                    >Close won</button>
                  </div>
                {{/each}}
              </div>
            {{/if}}
          </section>
        {{/if}}

        {{#if (eq this.activeTab 'dashboard')}}
          <section class='pane'>
            <div class='metric-grid'>
              {{#each this.dashboardMetrics as |m|}}
                <div class='metric'>
                  <span class='m-label'>{{m.label}}</span>
                  <span class='m-value'>{{m.value}}</span>
                </div>
              {{/each}}
            </div>
            <div class='dash-cols'>
              <div class='panel'>
                <h3>MRR build</h3>
                <LineChart
                  @points={{this.mrrTrend}}
                  @formatValue={{this.chartMoney}}
                />
              </div>
              <div class='panel'>
                <h3>Pipeline by stage</h3>
                <ul class='bars'>
                  {{#each this.stageBars as |bar|}}
                    <li>
                      <span class='bar-label'>{{bar.stage}}</span>
                      <span class='bar-track'>
                        {{! template-lint-disable no-inline-styles }}
                        <span class='bar-fill' style={{bar.widthStyle}}></span>
                      </span>
                      <span class='bar-value'>{{bar.display}}</span>
                    </li>
                  {{/each}}
                </ul>
              </div>
            </div>
          </section>
        {{/if}}

        {{#if (eq this.activeTab 'accounts')}}
          <section class='pane split'>
            <aside class='side-list'>
              <input
                class='search'
                type='search'
                placeholder='Search name, domain, contact email…'
                value={{this.accountQuery}}
                aria-label='Search accounts'
                {{on 'input' this.setAccountQuery}}
              />
              {{#each this.filteredAccounts as |account|}}
                <button
                  type='button'
                  class='side-item
                    {{if (eq account.id this.selectedAccount.id) "selected"}}'
                  {{on 'click' (fn this.selectAccount account)}}
                >
                  {{#let (this.cardComponent account) as |C|}}
                    <C @format='embedded' />
                  {{/let}}
                </button>
              {{/each}}
            </aside>
            <div class='detail'>
              {{#if this.selectedAccount}}
                <div class='detail-head'>
                  <h2>{{this.selectedAccount.name}}</h2>
                  <div class='head-actions'>
                    <button
                      type='button'
                      class='act'
                      {{on 'click' this.logActivity}}
                    >Log activity</button>
                    <button
                      type='button'
                      class='act'
                      {{on 'click' (fn this.openCard this.selectedAccount)}}
                    >Open account</button>
                  </div>
                </div>
                <AccountMetrics
                  @account={{this.selectedAccount}}
                  @context={{@context}}
                />
                <div class='detail-cols'>
                  <div class='panel'>
                    <h3>Contacts</h3>
                    {{#each this.accountContacts as |contact|}}
                      {{#let (this.cardComponent contact) as |C|}}
                        <C @format='embedded' />
                      {{/let}}
                    {{else}}
                      <p class='empty'>No contacts yet</p>
                    {{/each}}
                  </div>
                  <div class='panel'>
                    <h3>Subscriptions</h3>
                    {{#each this.accountSubscriptions as |sub|}}
                      {{#let (this.cardComponent sub) as |C|}}
                        <C @format='embedded' />
                      {{/let}}
                    {{else}}
                      <p class='empty'>No subscriptions</p>
                    {{/each}}
                  </div>
                  <div class='panel timeline'>
                    <h3>Activity</h3>
                    {{#each this.accountActivities as |act|}}
                      {{#let (this.cardComponent act) as |C|}}
                        <C @format='embedded' />
                      {{/let}}
                    {{else}}
                      <p class='empty'>No activity recorded</p>
                    {{/each}}
                  </div>
                </div>
              {{/if}}
            </div>
          </section>
        {{/if}}

        {{#if (eq this.activeTab 'invoices')}}
          <section class='pane'>
            <div class='aging-strip'>
              {{#each this.aging as |bucket|}}
                <div class='metric'>
                  <span class='m-label'>{{bucket.label}}</span>
                  <span class='m-value'>{{bucket.value}}</span>
                </div>
              {{/each}}
            </div>
            <div class='filters'>
              {{#each INVOICE_FILTERS as |f|}}
                <button
                  type='button'
                  class='chip {{if (eq this.invoiceFilter f.key) "active"}}'
                  {{on 'click' (fn this.setInvoiceFilter f.key)}}
                >{{f.label}}</button>
              {{/each}}
            </div>
            <Table
              @items={{this.filteredInvoices}}
              @columns={{this.invoiceColumns}}
              @onRowClick={{this.openCard}}
              @emptyMessage='No invoices match this filter'
            />
            {{#if this.openInvoices.length}}
              <div class='action-rail'>
                <span class='rail-label'>Collect</span>
                {{#each this.openInvoices as |inv|}}
                  <div class='rail-row'>
                    <span>{{inv.invoiceNumber}}
                      ·
                      {{this.balanceDisplay inv}}
                      due</span>
                    <button
                      type='button'
                      class='act'
                      disabled={{this.busy}}
                      {{on 'click' (fn this.recordBalancePayment inv)}}
                    >Record payment</button>
                  </div>
                {{/each}}
              </div>
            {{/if}}
          </section>
        {{/if}}

        {{#if (eq this.activeTab 'leads')}}
          <section class='pane'>
            <div class='pane-head'>
              <h2>Leads</h2>
              <button
                type='button'
                class='act'
                {{on 'click' this.newLead}}
              >New lead</button>
            </div>
            <div class='lead-list'>
              {{#each this.leads as |lead|}}
                <div class='lead-row'>
                  <div class='lead-embed'>
                    {{#let (this.cardComponent lead) as |C|}}
                      <C @format='embedded' />
                    {{/let}}
                  </div>
                  {{#if (this.canConvert lead)}}
                    <button
                      type='button'
                      class='act'
                      disabled={{this.busy}}
                      {{on 'click' (fn this.convertLead lead)}}
                    >Convert</button>
                  {{/if}}
                </div>
              {{else}}
                <p class='empty'>No leads</p>
              {{/each}}
            </div>
          </section>
        {{/if}}
      </div>
      <style scoped>
        .app {
          min-height: 100%;
          padding: 1.25rem 1.5rem 2rem;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          color: var(--foreground, #111111);
          background: var(--background, transparent);
        }
        .app-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 0.875rem;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.625rem;
        }
        .brand-icon {
          width: 26px;
          height: 26px;
        }
        h1 {
          margin: 0;
          font-size: 1.375rem;
          font-family: var(--font-heading, inherit);
        }
        .tabs {
          display: flex;
          gap: 0.25rem;
          flex-wrap: wrap;
        }
        .tab {
          border: 0;
          background: none;
          font: inherit;
          font-size: 0.8125rem;
          font-weight: 600;
          padding: 0.375rem 0.75rem;
          border-radius: 999px;
          cursor: pointer;
          color: var(--muted-foreground, #6b7280);
        }
        .tab.active {
          background: var(--primary, #111111);
          color: var(--primary-foreground, #ffffff);
        }
        .status-banner {
          margin: 0;
          padding: 0.625rem 0.875rem;
          border-radius: 0.5rem;
          background: var(--state-paid-bg, #d1fae5);
          color: var(--state-paid-fg, #065f46);
          font-size: 0.8125rem;
          font-weight: 500;
        }
        .pane {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .pane-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
        }
        h2 {
          margin: 0;
          font-size: 1.0625rem;
          font-family: var(--font-heading, inherit);
        }
        .pane-sub {
          margin: 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
          font-variant-numeric: tabular-nums;
        }
        .board-wrap {
          height: 420px;
        }
        .action-rail {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          background: var(--card, #ffffff);
          padding: 0.75rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .rail-label {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .rail-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          font-size: 0.875rem;
        }
        .link-ish {
          border: 0;
          background: none;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
          padding: 0;
          color: var(--foreground, #111111);
          text-align: left;
        }
        .act {
          border: 1px solid var(--border, #e5e7eb);
          background: var(--card, #ffffff);
          font: inherit;
          font-size: 0.75rem;
          font-weight: 600;
          padding: 0.3125rem 0.75rem;
          border-radius: 999px;
          cursor: pointer;
          white-space: nowrap;
        }
        .act:hover:not(:disabled) {
          background: var(--primary, #111111);
          color: var(--primary-foreground, #ffffff);
        }
        .act:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .metric-grid,
        .aging-strip {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
          gap: 0.75rem;
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
        .m-label {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .m-value {
          font-size: 1.25rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 1.1;
        }
        .dash-cols {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
          gap: 1rem;
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, #ffffff);
        }
        h3 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .bars {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .bars li {
          display: grid;
          grid-template-columns: 7rem 1fr auto;
          align-items: center;
          gap: 0.625rem;
          font-size: 0.75rem;
        }
        .bar-label {
          text-transform: capitalize;
          color: var(--muted-foreground, #6b7280);
        }
        .bar-track {
          display: block;
          height: 10px;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          overflow: hidden;
        }
        .bar-fill {
          display: block;
          height: 100%;
          border-radius: 999px;
          background: var(--primary, #111111);
        }
        .bar-value {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        .split {
          display: grid;
          grid-template-columns: minmax(15rem, 20rem) 1fr;
          gap: 1rem;
          align-items: start;
        }
        .side-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .side-item {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          background: var(--card, #ffffff);
          padding: 0;
          text-align: left;
          cursor: pointer;
          font: inherit;
          overflow: hidden;
        }
        .side-item.selected {
          border-color: var(--foreground, #111111);
          box-shadow: 0 0 0 1px var(--foreground, #111111);
        }
        .detail {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          min-width: 0;
        }
        .detail-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }
        .detail-cols {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
          gap: 1rem;
          align-items: start;
        }
        .timeline {
          max-height: 24rem;
          overflow-y: auto;
        }
        .filters {
          display: flex;
          gap: 0.375rem;
          flex-wrap: wrap;
        }
        .chip {
          border: 1px solid var(--border, #e5e7eb);
          background: var(--card, #ffffff);
          font: inherit;
          font-size: 0.75rem;
          font-weight: 600;
          padding: 0.25rem 0.75rem;
          border-radius: 999px;
          cursor: pointer;
          color: var(--muted-foreground, #6b7280);
        }
        .chip.active {
          background: var(--primary, #111111);
          border-color: var(--primary, #111111);
          color: var(--primary-foreground, #ffffff);
        }
        .lead-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .lead-row {
          display: flex;
          align-items: center;
          gap: 1rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          background: var(--card, #ffffff);
          padding-right: 0.875rem;
        }
        .lead-embed {
          flex: 1;
          min-width: 0;
        }
        .empty {
          margin: 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
        }
        .owner-select {
          font: inherit;
          font-size: 0.8125rem;
          padding: 0.25rem 0.5rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          background: var(--card, #ffffff);
          color: var(--foreground, #111111);
        }
        .search {
          font: inherit;
          font-size: 0.8125rem;
          padding: 0.4375rem 0.625rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          background: var(--card, #ffffff);
          color: var(--foreground, #111111);
          width: 100%;
          box-sizing: border-box;
        }
        .head-actions {
          display: flex;
          gap: 0.375rem;
        }
      </style>
    </template>
  };
}
