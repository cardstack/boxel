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
import { eq, gt } from '@cardstack/boxel-ui/helpers';
import {
  BoxelButton,
  BoxelInput,
  BoxelSelect,
  Pill,
  Switch,
} from '@cardstack/boxel-ui/components';
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
import { Opportunity, PIPELINE_STAGES, STAGE_COLORS } from './opportunity';
import { Account } from './account';
import { Invoice } from './invoice';
import { Subscription } from './subscription';
import { Lead } from './lead';
import { Contact } from './contact';
import { Activity } from './activity';
import ConvertLeadCommand from './convert-lead';
import RecordPaymentCommand from './record-payment';
import CloseWonCommand from './close-won';
import { formatMoney, outstandingBalance, sumLineItems } from './money';

const OPEN_INVOICE_STATUSES = ['sent', 'viewed', 'partial', 'overdue'];

function invoiceStatus(item: CardDef): string {
  return (item as Invoice).status ?? '';
}

function stopThen(action: (...args: any[]) => void) {
  return (event: Event) => {
    event.stopPropagation();
    action(event);
  };
}
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
    @tracked showAllStages = false;
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

    // CardCrudFunctions ride on component args only in interactive contexts;
    // prerender gets the static shell so the indexer never mounts the board.
    private get isInteractive() {
      return Boolean((this.args as any).viewCard);
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
      color: STAGE_COLORS[s],
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

    get queriesSettled(): boolean {
      return ![
        this.opportunityList,
        this.accountList,
        this.invoiceList,
        this.subscriptionList,
      ].some((list: any) => list?.isLoading);
    }

    get boardItems(): Opportunity[] {
      if (this.ownerFilter === 'all') return this.opportunities;
      return this.opportunities.filter(
        (o) => o.owner?.name === this.ownerFilter,
      );
    }

    get ownerOptions(): string[] {
      return ['All owners', ...this.owners];
    }

    get ownerSelection(): string {
      return this.ownerFilter === 'all' ? 'All owners' : this.ownerFilter;
    }

    @action setOwnerFilter(selection: string) {
      this.ownerFilter = selection === 'All owners' ? 'all' : selection;
    }

    @action toggleAllStages() {
      this.showAllStages = !this.showAllStages;
    }
    onMove = async (item: CardDef, columnKey: string) => {
      if (!this.commandContext || !this.realm) return;
      if (columnKey === 'closed won') {
        await this.closeWon(item as Opportunity);
        return;
      }
      (item as Opportunity).stage = columnKey;
      await new SaveCardCommand(this.commandContext).execute({
        card: item,
        realm: this.realm,
      } as any);
    };

    // Winning a deal is the handoff the app exists to remove: the command
    // activates the subscription and drafts the first invoice, so dragging
    // into Closed Won runs it instead of just writing the stage.
    @action async closeWon(deal: Opportunity) {
      if (!this.commandContext || !this.realm) return;
      // The command works on its own refetched copy, so move the card here too
      // or it sits in its old column until the live query catches up.
      let stageBefore = deal.stage;
      deal.stage = 'closed won';
      this.busy = true;
      try {
        let result: any = await new CloseWonCommand(
          this.commandContext,
        ).execute({ deal, realm: this.realm } as any);
        this.statusMessage = result?.message ?? `${deal.name} closed won`;
      } catch (e: any) {
        deal.stage = stageBefore;
        this.statusMessage = e?.message ?? 'Close won failed';
      } finally {
        this.busy = false;
      }
    }

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
        total: formatMoney(total, code ?? 'USD'),
        weighted: formatMoney(weighted, code ?? 'USD'),
      };
    }

    // ── dashboard ─────────────────────────────────────────────────────
    get dash() {
      let mrr = 0;
      let code: string | undefined;
      for (let s of this.subscriptions) {
        if (!['active', 'trial'].includes(s.status ?? '')) continue;
        let p = s.price?.amount ?? 0;
        mrr += s.billingCycle === 'yearly' ? p / 12 : p;
        code = code ?? s.price?.currency?.code ?? undefined;
      }
      code = code ?? 'USD';
      let won = this.opportunities.filter((o) => o.stage === 'closed won');
      let lost = this.opportunities.filter((o) => o.stage === 'closed lost');
      let closed = won.length + lost.length;
      let open = this.invoices.filter((i) =>
        OPEN_INVOICE_STATUSES.includes(i.status ?? ''),
      );
      let paid = this.invoices.filter((i) => i.status === 'paid');
      let balanceOf = (list: Invoice[]) =>
        list.reduce(
          (acc, i) => acc + outstandingBalance(i.lineItems, i.payments),
          0,
        );
      let sumOf = (list: Invoice[]) =>
        list.reduce((acc, i) => acc + sumLineItems(i.lineItems).total, 0);
      return {
        mrr: formatMoney(mrr, code),
        arr: formatMoney(mrr * 12, code),
        secondary: [
          { label: 'Pipeline', value: this.stageTotals.total, tab: 'pipeline' },
          {
            label: 'Weighted forecast',
            value: this.stageTotals.weighted,
          },
          {
            label: 'Win rate',
            value: closed
              ? `${won.length} of ${closed} won`
              : 'no closed deals yet',
          },
          {
            label: 'Outstanding',
            value: formatMoney(balanceOf(open), code),
            tab: 'invoices',
            filter: 'open',
          },
          {
            label: 'Collected',
            value: formatMoney(sumOf(paid), code),
            tab: 'invoices',
            filter: 'paid',
          },
        ],
      };
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

    @action setAccountQuery(value: string) {
      this.accountQuery = value;
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

    @action async newAccount() {
      let ref = identifyCard(Account);
      if (!ref) return;
      await (this.args as any).createCard?.(ref, undefined, {
        realmURL: this.realm ? new URL(this.realm) : undefined,
        doc: { data: { attributes: {}, meta: { adoptsFrom: ref } } },
      });
    }

    @action async newInvoice() {
      let ref = identifyCard(Invoice);
      if (!ref) return;
      await (this.args as any).createCard?.(ref, undefined, {
        realmURL: this.realm ? new URL(this.realm) : undefined,
        doc: {
          data: {
            attributes: {
              status: 'draft',
              issueDate: new Date().toISOString().slice(0, 10),
            },
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
      let chosen = this.filteredAccounts.find(
        (a) => a.id === this.selectedAccountId,
      );
      if (chosen) return chosen;
      let weight = (a: Account) =>
        this.invoices.filter((i) => i.account?.id === a.id).length +
        this.subscriptions.filter((s) => s.account?.id === a.id).length;
      return [...this.filteredAccounts].sort((a, b) => weight(b) - weight(a))[0];
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
    get accountDeals(): Opportunity[] {
      let id = this.selectedAccount?.id;
      return this.opportunities.filter((o) => o.account?.id === id);
    }
    get accountInvoices(): Invoice[] {
      let id = this.selectedAccount?.id;
      return this.invoices.filter((i) => i.account?.id === id);
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
        custom: true,
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
        custom: true,
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
      {
        key: 'actions',
        label: '',
        align: 'right',
        custom: true,
        sortable: false,
        value: () => '',
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
      let f = (n: number) => formatMoney(n, code ?? 'USD');
      let tone = (n: number, level: string) => (n > 0 ? level : 'zero');
      return [
        { label: 'Current', value: f(buckets.current), tone: 'ok' },
        { label: '1–30 days', value: f(buckets.b30), tone: tone(buckets.b30, 'warn') },
        { label: '31–60 days', value: f(buckets.b60), tone: tone(buckets.b60, 'late') },
        { label: '60+ days', value: f(buckets.b90), tone: tone(buckets.b90, 'late') },
      ];
    }

    accountOf = (item: CardDef) => (item as Invoice).account;

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

    get leadRows(): { lead: Lead; account: Account | undefined }[] {
      return this.leads.map((lead) => {
        let account: Account | undefined;
        if (lead.status === 'converted') {
          let domain = lead.email?.split('@')[1];
          account =
            this.accounts.find((a) => a.domain && a.domain === domain) ??
            this.accounts.find((a) => a.name && a.name === lead.company);
        }
        return { lead, account };
      });
    }

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

    @action drillTo(tab: string, filter?: string) {
      if (filter) this.invoiceFilter = filter;
      this.setTab(tab);
    }

    cardComponent = (card: CardDef) => {
      return (card.constructor as typeof CardDef).getComponent(card);
    };

    <template>
      {{#unless this.isInteractive}}
        <div class='app'>
          <header class='app-head'>
            <div class='brand'>
              <ChartAreaIcon class='brand-icon' />
              <h1>{{@model.cardTitle}}</h1>
            </div>
          </header>
          <p class='empty'>Open in Interact mode for the pipeline, dashboard,
            and collections workspace.</p>
        </div>
      {{/unless}}
      {{#if this.isInteractive}}
      <div class='app'>
        <header class='app-head'>
          <div class='brand'>
            <ChartAreaIcon class='brand-icon' />
            <h1>{{@model.cardTitle}}</h1>
          </div>
          <nav class='tabs'>
            {{#each TABS as |tab|}}
              <Pill
                @kind='button'
                @variant={{if (eq this.activeTab tab.key) 'primary' 'muted'}}
                {{on 'click' (fn this.setTab tab.key)}}
              >{{tab.label}}</Pill>
            {{/each}}
          </nav>
        </header>

        {{#if this.statusMessage}}
          <p class='status-banner'>{{this.statusMessage}}</p>
        {{/if}}

        {{#if (eq this.activeTab 'pipeline')}}
          <section class='pane'>
            <div class='board-toolbar'>
              <h2>Pipeline</h2>
              <div class='toolbar-controls'>
                <div class='switch-wrap'>
                  <Switch
                    @isEnabled={{this.showAllStages}}
                    @onChange={{this.toggleAllStages}}
                    @label='All stages'
                  />
                  <span class='switch-text'>All stages</span>
                </div>
                {{#if this.owners.length}}
                  <div class='owner-select'>
                    <BoxelSelect
                      @options={{this.ownerOptions}}
                      @selected={{this.ownerSelection}}
                      @onChange={{this.setOwnerFilter}}
                      @renderInPlace={{true}}
                      aria-label='Filter by owner'
                      as |name|
                    >
                      {{name}}
                    </BoxelSelect>
                  </div>
                {{/if}}
              </div>
              <div class='board-stats'>
                <span class='stat'><span
                    class='stat-value'
                  >{{this.stageTotals.count}}</span>
                  open</span>
                <span class='stat'><span
                    class='stat-value'
                  >{{this.stageTotals.total}}</span>
                  total</span>
                <span class='stat'><span
                    class='stat-value'
                  >{{this.stageTotals.weighted}}</span>
                  weighted</span>
              </div>
            </div>
            <div class='board-wrap'>
              {{#if this.queriesSettled}}
                <Board
                  @boardLabel='Pipeline'
                  @items={{this.boardItems}}
                  @columns={{this.boardColumns}}
                  @columnKeyFor={{this.columnKeyFor}}
                  @onMove={{this.onMove}}
                  @hideEmpty={{unless this.showAllStages true}}
                />
              {{else}}
                <p class='empty'>Loading pipeline…</p>
              {{/if}}
            </div>
          </section>
        {{/if}}

        {{#if (eq this.activeTab 'dashboard')}}
          <section class='pane'>
            <div class='hero'>
              <div class='hero-metric'>
                <span class='m-label'>Monthly recurring revenue</span>
                <span class='hero-value'>{{this.dash.mrr}}</span>
                <span class='hero-sub'>{{this.dash.arr}} annualized</span>
              </div>
              <div class='hero-chart'>
                <LineChart
                  @points={{this.mrrTrend}}
                  @formatValue={{this.chartMoney}}
                />
              </div>
            </div>
            <div class='metric-grid'>
              {{#each this.dash.secondary as |m|}}
                {{#if m.tab}}
                  <button
                    type='button'
                    class='metric metric-flat metric-link'
                    {{on 'click' (fn this.drillTo m.tab m.filter)}}
                  >
                    <span class='m-label'>{{m.label}}</span>
                    <span class='m-value'>{{m.value}}</span>
                  </button>
                {{else}}
                  <div class='metric metric-flat'>
                    <span class='m-label'>{{m.label}}</span>
                    <span class='m-value'>{{m.value}}</span>
                  </div>
                {{/if}}
              {{/each}}
            </div>
            <div class='dash-cols'>
              <div class='panel'>
                <h3>Pipeline by stage</h3>
                <ul class='bars'>
                  {{#each this.stageBars as |bar|}}
                    <li class='bar-row'>
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
          <section class='pane'>
            <div class='pane-head'>
              <h2>Accounts</h2>
              <BoxelButton
                @kind='secondary'
                @size='extra-small'
                {{on 'click' this.newAccount}}
              >New account</BoxelButton>
            </div>
            <div class='split'>
            <aside class='side-list'>
              <BoxelInput
                @type='search'
                @placeholder='Search name, domain, contact email…'
                @value={{this.accountQuery}}
                @onInput={{this.setAccountQuery}}
                aria-label='Search accounts'
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
                    <BoxelButton
                      @kind='secondary'
                      @size='extra-small'
                      {{on 'click' this.logActivity}}
                    >Log activity</BoxelButton>
                    <BoxelButton
                      @kind='secondary'
                      @size='extra-small'
                      {{on 'click' (fn this.openCard this.selectedAccount)}}
                    >Open account</BoxelButton>
                  </div>
                </div>
                <AccountMetrics
                  @account={{this.selectedAccount}}
                  @context={{@context}}
                />
                <div class='detail-cols'>
                  <div class='panel'>
                    <h3>Deals</h3>
                    {{#each this.accountDeals as |deal|}}
                      <button
                        type='button'
                        class='row-open'
                        {{on 'click' (fn this.openCard deal)}}
                      >
                        {{#let (this.cardComponent deal) as |C|}}
                          <C @format='embedded' />
                        {{/let}}
                      </button>
                    {{else}}
                      <p class='empty'>No deals yet</p>
                    {{/each}}
                  </div>
                  <div class='panel'>
                    <h3>Invoices</h3>
                    {{#each this.accountInvoices as |inv|}}
                      <button
                        type='button'
                        class='row-open'
                        {{on 'click' (fn this.openCard inv)}}
                      >
                        {{#let (this.cardComponent inv) as |C|}}
                          <C @format='embedded' />
                        {{/let}}
                      </button>
                    {{else}}
                      <p class='empty'>No invoices yet</p>
                    {{/each}}
                  </div>
                  <div class='panel'>
                    <h3>Contacts</h3>
                    {{#each this.accountContacts as |contact|}}
                      <button
                        type='button'
                        class='row-open'
                        {{on 'click' (fn this.openCard contact)}}
                      >
                        {{#let (this.cardComponent contact) as |C|}}
                          <C @format='embedded' />
                        {{/let}}
                      </button>
                    {{else}}
                      <p class='empty'>No contacts yet</p>
                    {{/each}}
                  </div>
                  <div class='panel'>
                    <h3>Subscriptions</h3>
                    {{#each this.accountSubscriptions as |sub|}}
                      <button
                        type='button'
                        class='row-open'
                        {{on 'click' (fn this.openCard sub)}}
                      >
                        {{#let (this.cardComponent sub) as |C|}}
                          <C @format='embedded' />
                        {{/let}}
                      </button>
                    {{else}}
                      <p class='empty'>No subscriptions</p>
                    {{/each}}
                  </div>
                  <div class='panel timeline'>
                    <h3>Activity</h3>
                    {{#each this.accountActivities as |act|}}
                      <button
                        type='button'
                        class='row-open'
                        {{on 'click' (fn this.openCard act)}}
                      >
                        {{#let (this.cardComponent act) as |C|}}
                          <C @format='embedded' />
                        {{/let}}
                      </button>
                    {{else}}
                      <p class='empty'>No activity recorded</p>
                    {{/each}}
                  </div>
                </div>
              {{/if}}
            </div>
            </div>
          </section>
        {{/if}}

        {{#if (eq this.activeTab 'invoices')}}
          <section class='pane'>
            <div class='pane-head'>
              <h2>Invoices</h2>
              <BoxelButton
                @kind='secondary'
                @size='extra-small'
                {{on 'click' this.newInvoice}}
              >New invoice</BoxelButton>
            </div>
            <div class='aging-strip'>
              {{#each this.aging as |bucket|}}
                <div class='metric metric-flat'>
                  <span class='m-label'>{{bucket.label}}</span>
                  <span class='m-value tone-{{bucket.tone}}'>{{bucket.value}}</span>
                </div>
              {{/each}}
            </div>
            <div class='filters'>
              {{#each INVOICE_FILTERS as |f|}}
                <Pill
                  @kind='button'
                  @variant={{if (eq this.invoiceFilter f.key) 'primary' 'muted'}}
                  {{on 'click' (fn this.setInvoiceFilter f.key)}}
                >{{f.label}}</Pill>
              {{/each}}
            </div>
            <Table
              @items={{this.filteredInvoices}}
              @columns={{this.invoiceColumns}}
              @onRowClick={{this.openCard}}
              @emptyMessage='No invoices match this filter'
            >
              <:cell as |item column|>
                {{#if (eq column.key 'status')}}
                  {{#let (invoiceStatus item) as |status|}}
                    <span class='tstatus tstatus-{{status}}'>{{status}}</span>
                  {{/let}}
                {{else if (eq column.key 'account')}}
                  {{#let (this.accountOf item) as |account|}}
                    {{#if account}}
                      {{#let (this.cardComponent account) as |C|}}
                        <C @format='atom' />
                      {{/let}}
                    {{/if}}
                  {{/let}}
                {{else if (eq column.key 'actions')}}
                  {{#if (gt (this.balanceOf item) 0)}}
                    <BoxelButton
                      @kind='secondary'
                      @size='extra-small'
                      @disabled={{this.busy}}
                      {{on 'click' (stopThen (fn this.recordBalancePayment item))}}
                    >Record
                      {{this.balanceDisplay item}}</BoxelButton>
                  {{/if}}
                {{/if}}
              </:cell>
            </Table>
          </section>
        {{/if}}

        {{#if (eq this.activeTab 'leads')}}
          <section class='pane'>
            <div class='pane-head'>
              <h2>Leads</h2>
              <BoxelButton
                @kind='secondary'
                @size='extra-small'
                {{on 'click' this.newLead}}
              >New lead</BoxelButton>
            </div>
            <div class='lead-list'>
              {{#each this.leadRows as |row|}}
                <div class='lead-row'>
                  <button
                    type='button'
                    class='row-open lead-embed'
                    {{on 'click' (fn this.openCard row.lead)}}
                  >
                    {{#let (this.cardComponent row.lead) as |C|}}
                      <C @format='embedded' />
                    {{/let}}
                  </button>
                  <div class='lead-action'>
                    {{#if (this.canConvert row.lead)}}
                      <BoxelButton
                        @kind='secondary'
                        @size='extra-small'
                        @disabled={{this.busy}}
                        {{on 'click' (fn this.convertLead row.lead)}}
                      >Convert</BoxelButton>
                    {{else if row.account}}
                      <BoxelButton
                        @kind='text-only'
                        @size='extra-small'
                        {{on 'click' (fn this.openCard row.account)}}
                      >View account →</BoxelButton>
                    {{/if}}
                  </div>
                </div>
              {{else}}
                <p class='empty'>No leads</p>
              {{/each}}
            </div>
          </section>
        {{/if}}
      </div>
      {{/if}}
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
          border-bottom: 4px double var(--foreground, #111111);
          padding-bottom: 0.875rem;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.625rem;
        }
        .brand-icon {
          width: 38px;
          height: 38px;
          padding: 7px;
          box-sizing: border-box;
          border-radius: 0.625rem;
          background: var(--primary, #111111);
          color: var(--primary-foreground, #ffffff);
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
        .board-toolbar {
          display: flex;
          align-items: center;
          gap: 1.25rem;
          flex-wrap: wrap;
        }
        .toolbar-controls {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        .switch-wrap {
          display: flex;
          align-items: center;
          gap: 0.4375rem;
        }
        .switch-text {
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .board-stats {
          margin-left: auto;
          display: flex;
          align-items: baseline;
          gap: 1.25rem;
        }
        .stat {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .stat-value {
          font-size: 0.9375rem;
          font-weight: 700;
          color: var(--foreground, #111111);
          font-variant-numeric: tabular-nums;
          margin-right: 0.25rem;
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
        .metric-flat {
          border: none;
          background: var(--muted, #f3f4f6);
        }
        .metric-link {
          font: inherit;
          text-align: left;
          cursor: pointer;
        }
        .metric-link:hover {
          background: var(--border, #e5e7eb);
        }
        .hero {
          display: grid;
          grid-template-columns: minmax(15rem, 1fr) minmax(20rem, 2fr);
          gap: 1.5rem;
          align-items: center;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 1rem;
          background: var(--card, #ffffff);
          padding: 1.5rem 1.75rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }
        .hero-metric {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .hero-value {
          font-size: 3rem;
          line-height: 1;
          font-weight: 700;
          font-family: var(--font-heading, inherit);
          font-variant-numeric: tabular-nums;
          color: var(--primary, #111111);
        }
        .hero-sub {
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
          font-variant-numeric: tabular-nums;
        }
        .hero-chart {
          min-width: 0;
        }
        .tone-warn {
          color: var(--state-partial-fg, #92400e);
        }
        .tone-late {
          color: var(--state-overdue-fg, #991b1b);
        }
        .tone-zero {
          color: var(--muted-foreground, #6b7280);
        }
        .tstatus {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .tstatus-paid {
          background: var(--state-paid-bg, #d1fae5);
          color: var(--state-paid-fg, #065f46);
        }
        .tstatus-partial {
          background: var(--state-partial-bg, #fef3c7);
          color: var(--state-partial-fg, #92400e);
        }
        .tstatus-overdue {
          background: var(--state-overdue-bg, #fee2e2);
          color: var(--state-overdue-fg, #991b1b);
        }
        @media (max-width: 48rem) {
          .hero {
            grid-template-columns: 1fr;
          }
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
        .bar-row {
          display: grid;
          grid-template-columns: 7rem 1fr auto;
          align-items: center;
          gap: 0.625rem;
          font-size: 0.75rem;
          padding: 0.125rem 0;
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
        .side-item :deep(.boxel-card-container) {
          background: transparent;
          border-radius: 0;
        }
        .side-item :deep(.boxel-card-container--boundaries) {
          box-shadow: none;
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
        .lead-action {
          width: 9.5rem;
          display: flex;
          justify-content: flex-end;
          flex-shrink: 0;
        }
        .lead-embed :deep(.boxel-card-container) {
          background: transparent;
          border-radius: 0;
        }
        .lead-embed :deep(.boxel-card-container--boundaries) {
          box-shadow: none;
        }
        .empty {
          margin: 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
        }
        .head-actions {
          display: flex;
          gap: 0.375rem;
        }
        .owner-select {
          min-width: 11rem;
          --boxel-select-background-color: var(--card, #ffffff);
          --boxel-select-border-color: var(--border, #e5e7eb);
          --boxel-select-text-color: var(--foreground, #111111);
          --boxel-select-placeholder-color: var(--muted-foreground, #6b7280);
          --boxel-select-focus-border-color: var(--primary, #111111);
        }
        .row-open {
          display: block;
          width: 100%;
          border: 0;
          padding: 0;
          background: none;
          font: inherit;
          text-align: left;
          cursor: pointer;
          border-radius: 0.5rem;
        }
        .row-open:hover {
          background: var(--muted, #f3f4f6);
        }
        .panel :deep(.boxel-card-container) {
          background: transparent;
          border-radius: 0;
        }
        .panel :deep(.boxel-card-container--boundaries) {
          box-shadow: none;
        }
        .panel .row-open + .row-open {
          border-top: 1px solid var(--border, #e5e7eb);
        }
      </style>
    </template>
  };
}
