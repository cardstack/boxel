import { htmlSafe } from '@ember/template';
import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  realmURL,
} from '@cardstack/base/card-api';
import { identifyCard, type getCards } from '@cardstack/runtime-common';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import DateField from '@cardstack/base/date';
import DateTimeField from '@cardstack/base/datetime';
import AwardIcon from '@cardstack/boxel-icons/award';
import ArrowsExchangeIcon from '@cardstack/boxel-icons/arrows-exchange';

import { Contact } from './contact';
import LoyaltyTierField from './loyalty-tier-field';
import MemberNumberField from './member-number-field';
import PointsBalanceField from './points-balance-field';
import { statusField } from './status-field';
import { stateColor } from './utils/index';

// Token-derived color only — never a user string.
function htmlSafeColor(color: string) {
  return htmlSafe(`color: ${color};`);
}

/**
 * Membership standing: Active is the working state, Lapsed is recoverable
 * neglect (renewal missed, points frozen by program rules), Closed is a
 * deliberate end that can still be reopened by re-enrolment.
 */
export const MembershipStatusField = statusField({
  displayName: 'Membership Status',
  options: [
    { value: 'Active', hue: 'green', meaning: 'In good standing' },
    {
      value: 'Lapsed',
      hue: 'amber',
      meaning: 'Renewal missed — recoverable',
      holds: true,
    },
    {
      value: 'Closed',
      hue: 'slate',
      meaning: 'Deliberately ended',
      terminal: true,
      holds: true,
    },
  ],
  transitions: {
    Active: ['Lapsed', 'Closed'],
    Lapsed: ['Active', 'Closed'],
    Closed: ['Active'],
  },
});

/**
 * A membership in a loyalty program — the account that accumulates standing,
 * not the person. The person is a linked Contact; one person can hold
 * accounts in many programs, and the program's history belongs to the
 * account so it survives the person's details changing.
 *
 * `pointsBalance` and `lifetimePoints` are maintained by the program's
 * single writer — the Credit Points command — against the PointsTransaction
 * ledger. Nothing else assigns them; a consumer that wants history renders
 * the ledger, not a link array on this card.
 *
 * The neutral default tier ladder ships with the tier field; a program with
 * its own ladder redeclares `tier` with `loyaltyTierField(...)` in its
 * extending card.
 */
export class LoyaltyAccount extends CardDef {
  static displayName = 'Loyalty Account';
  static icon = AwardIcon;

  @field memberNumber = contains(MemberNumberField);
  @field holder = linksTo(Contact);
  @field tier = contains(LoyaltyTierField);
  @field tierSince = contains(DateField);
  @field memberSince = contains(DateField);
  @field status = contains(MembershipStatusField);
  @field pointsBalance = contains(PointsBalanceField);
  @field lifetimePoints = contains(PointsBalanceField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: LoyaltyAccount) {
      return (
        this.holder?.name ??
        this.memberNumber ??
        `Untitled ${this.constructor.displayName}`
      );
    },
  });

  static atom = class Atom extends Component<typeof LoyaltyAccount> {
    <template>
      <span class='la-atom'>
        <AwardIcon class='la-icon' />
        <span class='la-number'>{{if
            @model.memberNumber
            @model.memberNumber
            'No member number'
          }}</span>
      </span>
      <style scoped>
        .la-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.8125rem;
        }
        .la-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          color: var(--muted-foreground, #6b7280);
        }
        .la-number {
          font-family: var(--font-mono, ui-monospace, monospace);
          letter-spacing: 0.04em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof LoyaltyAccount> {
    <template>
      <div class='la-row'>
        <div class='la-id'>
          <span class='la-name'>{{if
              @model.holder.name
              @model.holder.name
              'Unassigned account'
            }}</span>
          <span class='la-number'><@fields.memberNumber /></span>
        </div>
        <span class='la-tier'><@fields.tier /></span>
        <span class='la-balance'><@fields.pointsBalance /></span>
      </div>
      <style scoped>
        .la-row {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.875rem;
        }
        .la-id {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .la-name {
          font-weight: 600;
          font-size: 0.875rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .la-number {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
        .la-tier {
          flex-shrink: 0;
        }
        /* Constant-width slot so account rows column-align in lists whether
           or not a balance exists yet. */
        .la-balance {
          width: 5.5rem;
          text-align: right;
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof LoyaltyAccount> {
    <template>
      <div class='fitted'>
        <div class='top'>
          <span class='number'>{{if
              @model.memberNumber
              @model.memberNumber
              'No member number'
            }}</span>
          <span class='tier line-tier'><@fields.tier @format='atom' /></span>
        </div>
        <span class='balance line-balance'><@fields.pointsBalance /></span>
        {{#if @model.memberSince}}
          <span class='meta line-since'>Member since
            <@fields.memberSince /></span>
        {{/if}}
      </div>
      <style scoped>
        .fitted {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.25rem;
          width: 100%;
          height: 100%;
          padding: 0.625rem 0.75rem;
          box-sizing: border-box;
          overflow: hidden;
          color: var(--foreground, #111111);
        }
        .top {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 0;
        }
        .number {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.75rem;
          letter-spacing: 0.04em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tier {
          flex-shrink: 0;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
        }
        .line-tier,
        .line-balance,
        .line-since {
          display: none;
        }
        /* Badge degradation: strip height keeps only the first line. */
        @container fitted-card (max-height: 50px) {
          .fitted {
            padding: 0.25rem 0.5rem;
            gap: 0.125rem;
          }
        }
        @container fitted-card (min-height: 65px) {
          .line-tier {
            display: inline-flex;
          }
        }
        @container fitted-card (min-height: 170px) {
          .line-balance {
            display: inline-flex;
          }
        }
        @container fitted-card (min-width: 400px) and (min-height: 170px) {
          .line-since {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof LoyaltyAccount> {
    private ledgerQuery: ReturnType<getCards> | undefined;

    constructor(owner: unknown, args: any) {
      super(owner as never, args as never);
      // The ledger is a query, never a link array — see the class doc.
      this.ledgerQuery = this.args.context?.getCards(
        this,
        () => {
          let ref = identifyCard(PointsTransaction);
          return ref && this.args.model?.id
            ? { filter: { type: ref } }
            : undefined;
        },
        () => {
          let url = this.args.model?.[realmURL]?.href;
          return url ? [url] : [];
        },
        { isLive: true },
      );
    }

    get ledger(): PointsTransaction[] {
      let id = this.args.model?.id;
      if (!id) {
        return [];
      }
      return ((this.ledgerQuery?.instances ?? []) as PointsTransaction[])
        .filter((t) => t?.account?.id === id)
        .sort(
          (a, b) =>
            new Date(b.occurredAt ?? 0).getTime() -
            new Date(a.occurredAt ?? 0).getTime(),
        )
        .slice(0, 10);
    }

    get ledgerLoading(): boolean {
      return Boolean(this.ledgerQuery?.isLoading);
    }

    /** Prerender has no query surface; the panel only renders live. */
    get hasLedgerQuery(): boolean {
      return Boolean(this.ledgerQuery);
    }

    signedAmount = (transaction: PointsTransaction): string => {
      let amount = transaction.amount ?? 0;
      return `${amount > 0 ? '+' : ''}${new Intl.NumberFormat().format(amount)}`;
    };

    amountStyle = (transaction: PointsTransaction) => {
      let hue = (transaction.amount ?? 0) > 0 ? 'green' : 'red';
      return htmlSafeColor(stateColor(hue).fg);
    };

    whenLabel = (transaction: PointsTransaction): string => {
      let at = transaction.occurredAt;
      if (!at) {
        return '';
      }
      let d = new Date(at);
      return Number.isNaN(d.getTime())
        ? ''
        : d.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
    };

    <template>
      <article class='la-page'>
        <header class='lh'>
          <div class='lh-id'>
            <p class='doc-kind'>Loyalty Account</p>
            <h1>{{if
                @model.holder.name
                @model.holder.name
                'Unassigned account'
              }}</h1>
            <p class='lh-number'><@fields.memberNumber /></p>
          </div>
          <div class='lh-standing'>
            <@fields.tier />
            {{#if @model.status}}
              <@fields.status @format='embedded' />
            {{/if}}
          </div>
        </header>
        <section class='stats'>
          <div class='stat'>
            <span class='stat-label'>Points balance</span>
            <span class='stat-value'><@fields.pointsBalance /></span>
          </div>
          <div class='stat'>
            <span class='stat-label'>Lifetime earned</span>
            <span class='stat-value'><@fields.lifetimePoints /></span>
          </div>
          <div class='stat'>
            <span class='stat-label'>Member since</span>
            <span class='stat-value stat-date'>
              {{#if @model.memberSince}}<@fields.memberSince />{{else}}—{{/if}}
            </span>
          </div>
          <div class='stat'>
            <span class='stat-label'>Tier since</span>
            <span class='stat-value stat-date'>
              {{#if @model.tierSince}}<@fields.tierSince />{{else}}—{{/if}}
            </span>
          </div>
        </section>
        {{#if this.hasLedgerQuery}}
          <section class='panel'>
            <h2>Ledger</h2>
            {{#if this.ledgerLoading}}
              <p class='ledger-note'>Loading points activity…</p>
            {{else if this.ledger.length}}
              <ol class='ledger'>
                {{#each this.ledger key='id' as |transaction|}}
                  <li class='ledger-row'>
                    <span
                      class='ledger-amount'
                      style={{this.amountStyle transaction}}
                    >{{this.signedAmount transaction}}</span>
                    <span class='ledger-reason'>{{if
                        transaction.reason
                        transaction.reason
                        'Points adjustment'
                      }}</span>
                    {{#if transaction.source}}
                      <span class='ledger-source'>{{transaction.source}}</span>
                    {{/if}}
                    <span class='ledger-when'>{{this.whenLabel
                        transaction
                      }}</span>
                  </li>
                {{/each}}
              </ol>
            {{else}}
              <p class='ledger-note'>No points activity yet — it starts with
                the first earn.</p>
            {{/if}}
          </section>
        {{/if}}
        {{#if @model.holder}}
          <section class='panel'>
            <h2>Holder</h2>
            <div class='holder'><@fields.holder @format='embedded' /></div>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .la-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .lh {
          display: flex;
          align-items: center;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .lh-id {
          flex: 1;
          min-width: 0;
        }
        .doc-kind {
          margin: 0 0 0.125rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        h1 {
          margin: 0;
          font-size: 1.625rem;
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
        }
        .lh-number {
          margin: 0.25rem 0 0;
        }
        .lh-standing {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.375rem;
          flex-shrink: 0;
        }
        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
          gap: 0.75rem;
        }
        .stat {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 0.875rem 1rem;
          background: var(--card, #ffffff);
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .stat-label {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .stat-value {
          font-size: 1.125rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .stat-date {
          font-size: 0.9375rem;
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, #ffffff);
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .holder {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
        }
        .ledger {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
        }
        .ledger-row {
          display: flex;
          align-items: baseline;
          gap: 0.625rem;
          padding: 0.375rem 0;
          border-bottom: 1px solid var(--border, #f3f4f6);
          font-size: 0.8125rem;
        }
        .ledger-row:last-child {
          border-bottom: none;
        }
        /* Constant-width signed column so the ledger reads as a column of
           numbers, not a ragged list. */
        .ledger-amount {
          width: 4.25rem;
          text-align: right;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }
        .ledger-reason {
          min-width: 0;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ledger-source {
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .ledger-when {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .ledger-note {
          margin: 0;
          font-size: 0.875rem;
          font-style: italic;
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };
}

/**
 * One movement of points, at a time, for a reason — the ledger row. The
 * ledger is the truth the balance is maintained against: an account's
 * history is a query for its transactions, never a link array on the
 * account (it grows without bound).
 *
 * `amount` is signed: earn positive, redeem/expire negative. `source` is a
 * label in the program's vocabulary (Attendance, Purchase, Survey, Manual…)
 * — free text here, constrained by the commands that write it.
 */
export class PointsTransaction extends CardDef {
  static displayName = 'Points Transaction';
  static icon = ArrowsExchangeIcon;

  @field account = linksTo(() => LoyaltyAccount);
  @field amount = contains(NumberField);
  @field reason = contains(StringField);
  @field source = contains(StringField);
  @field occurredAt = contains(DateTimeField);
  @field expiresAt = contains(DateTimeField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: PointsTransaction) {
      let amount = this.amount ?? 0;
      let signed = `${amount > 0 ? '+' : ''}${amount}`;
      return this.reason ? `${signed} — ${this.reason}` : `${signed} points`;
    },
  });

  static atom = class Atom extends Component<typeof PointsTransaction> {
    get signed() {
      let amount = this.args.model.amount ?? 0;
      return `${amount > 0 ? '+' : ''}${new Intl.NumberFormat().format(amount)}`;
    }
    <template>
      <span class='ptx-atom'>{{this.signed}} pts</span>
      <style scoped>
        .ptx-atom {
          font-variant-numeric: tabular-nums;
          font-size: 0.75rem;
          font-weight: 600;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof PointsTransaction> {
    get isCredit() {
      return (this.args.model.amount ?? 0) > 0;
    }
    get signed() {
      let amount = this.args.model.amount ?? 0;
      return `${amount > 0 ? '+' : ''}${new Intl.NumberFormat().format(amount)}`;
    }
    get amountColor() {
      return stateColor(this.isCredit ? 'green' : 'red').fg;
    }
    <template>
      <div class='ptx'>
        <span
          class='ptx-amount'
          style={{htmlSafeColor this.amountColor}}
        >{{this.signed}}</span>
        <div class='ptx-what'>
          <span class='ptx-reason'>{{if
              @model.reason
              @model.reason
              'Points adjustment'
            }}</span>
          {{#if @model.source}}
            <span class='ptx-source'>{{@model.source}}</span>
          {{/if}}
        </div>
        <span class='ptx-when'>{{#if @model.occurredAt}}<@fields.occurredAt
            />{{else}}—{{/if}}</span>
      </div>
      <style scoped>
        .ptx {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.5rem 0.875rem;
          font-size: 0.8125rem;
        }
        /* Constant-width signed column so ledger rows align. */
        .ptx-amount {
          width: 4.25rem;
          text-align: right;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }
        .ptx-what {
          min-width: 0;
          flex: 1;
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
        }
        .ptx-reason {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ptx-source {
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .ptx-when {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
          flex-shrink: 0;
        }
      </style>
    </template>
  };
}
