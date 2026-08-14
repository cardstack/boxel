import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';

import type { LoyaltyAccount, PointsTransaction } from '../loyalty-account';
import { TierBadge, type TierOption } from '../loyalty-tier-field';
import { stateColor } from '../utils/index';

interface Signature {
  Args: {
    account: LoyaltyAccount;
    /**
     * The account's resolved rung — the consumer owns its ladder, so it
     * resolves once: `tierOption(MyTierField, account.tier)`.
     */
    tier?: TierOption;
    /**
     * Recent ledger rows, newest first, already queried and sliced by the
     * consumer — the dashboard renders what it is handed and never counts
     * or sums the ledger itself.
     */
    transactions?: PointsTransaction[];
    /**
     * Expiry callout, precomputed by the consumer: FIFO expiry math is the
     * program's business (see the Credit Points spec), so the dashboard
     * only displays the result.
     */
    expiringPoints?: number;
    expiringOn?: Date;
  };
  Blocks: {
    /** The consumer's calls to action: view rewards, upgrade, renew. */
    actions?: [];
  };
  Element: HTMLElement;
}

function formatPoints(n?: number | null): string {
  if (n == null || Number.isNaN(n)) {
    return '—';
  }
  return new Intl.NumberFormat().format(n);
}

function formatDay(value?: Date | null): string {
  if (!value) {
    return '';
  }
  let d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * The member's home view of their standing: who they are to the program,
 * the numbers that matter (balance, lifetime), what just happened, and
 * what is about to expire. One component so every loyalty app's home
 * screen carries the same reading order — identity, standing, movement,
 * urgency, actions.
 */
export class LoyaltyDashboard extends GlimmerComponent<Signature> {
  get hasActivity() {
    return (this.args.transactions ?? []).length > 0;
  }

  signedAmount = (transaction: PointsTransaction): string => {
    let amount = transaction.amount ?? 0;
    return `${amount > 0 ? '+' : ''}${formatPoints(amount)}`;
  };

  amountStyle = (transaction: PointsTransaction) => {
    let hue = (transaction.amount ?? 0) > 0 ? 'green' : 'red';
    return htmlSafe(`color: ${stateColor(hue).fg};`);
  };

  whenLabel = (transaction: PointsTransaction): string => {
    return formatDay(transaction.occurredAt);
  };

  get expiringOnLabel() {
    return formatDay(this.args.expiringOn);
  }

  <template>
    <section class='loyalty-dashboard' ...attributes>
      <header class='ld-head'>
        <div class='ld-who'>
          <span class='ld-name'>{{if
              @account.holder.name
              @account.holder.name
              'Member'
            }}</span>
          <span class='ld-number'>{{@account.memberNumber}}</span>
        </div>
        {{#if @tier}}
          <TierBadge
            @label={{if @tier.label @tier.label @tier.value}}
            @hue={{@tier.hue}}
            @value={{@tier.value}}
          />
        {{/if}}
      </header>

      <div class='ld-stats'>
        <div class='ld-stat'>
          <span class='ld-stat-label'>Points balance</span>
          <span class='ld-stat-value'>{{formatPoints
              @account.pointsBalance
            }}</span>
        </div>
        <div class='ld-stat'>
          <span class='ld-stat-label'>Lifetime earned</span>
          <span class='ld-stat-value'>{{formatPoints
              @account.lifetimePoints
            }}</span>
        </div>
      </div>

      {{#if @expiringPoints}}
        <p class='ld-expiring'>
          <strong>{{formatPoints @expiringPoints}} points</strong>
          expire
          {{#if this.expiringOnLabel}}on {{this.expiringOnLabel}}{{else}}soon{{/if}}
        </p>
      {{/if}}

      <div class='ld-activity'>
        <h3 class='ld-activity-title'>Recent activity</h3>
        {{#if this.hasActivity}}
          <ol class='ld-rows'>
            {{#each @transactions key='id' as |transaction|}}
              <li class='ld-row'>
                <span
                  class='ld-amount'
                  style={{this.amountStyle transaction}}
                >{{this.signedAmount transaction}}</span>
                <span class='ld-reason'>{{if
                    transaction.reason
                    transaction.reason
                    'Points adjustment'
                  }}</span>
                <span class='ld-when'>{{this.whenLabel transaction}}</span>
              </li>
            {{/each}}
          </ol>
        {{else}}
          <p class='ld-empty'>No points activity yet — it starts with the
            first earn.</p>
        {{/if}}
      </div>

      {{#if (has-block 'actions')}}
        <footer class='ld-actions'>{{yield to='actions'}}</footer>
      {{/if}}
    </section>
    <style scoped>
      .loyalty-dashboard {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        font-family: var(--font-sans, var(--boxel-font-family));
        color: var(--foreground, var(--boxel-dark));
      }
      .ld-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .ld-who {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }
      .ld-name {
        font-weight: 700;
        font-size: var(--boxel-font-size);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ld-number {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: var(--boxel-font-size-xs);
        letter-spacing: 0.04em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .ld-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
        gap: var(--boxel-sp-xs);
      }
      .ld-stat {
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--card, var(--boxel-light));
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
      }
      .ld-stat-label {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .ld-stat-value {
        font-size: 1.25rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .ld-expiring {
        margin: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        font-size: var(--boxel-font-size-sm);
        background: color-mix(
          in oklch,
          var(--boxel-warning) 14%,
          var(--card, var(--boxel-light))
        );
        color: color-mix(
          in oklch,
          var(--boxel-warning) 38%,
          var(--card-foreground, var(--boxel-dark))
        );
      }
      .ld-activity-title {
        margin: 0 0 var(--boxel-sp-4xs);
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .ld-rows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      .ld-row {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-4xs) 0;
        border-bottom: 1px solid var(--border, var(--boxel-100));
        font-size: var(--boxel-font-size-sm);
      }
      .ld-row:last-child {
        border-bottom: none;
      }
      /* Constant-width signed column so the ledger reads as a column of
         numbers, not a ragged list. */
      .ld-amount {
        width: 3.75rem;
        text-align: right;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        flex-shrink: 0;
      }
      .ld-reason {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ld-when {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
        white-space: nowrap;
        flex-shrink: 0;
      }
      .ld-empty {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .ld-actions {
        display: flex;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }
    </style>
  </template>
}

export default LoyaltyDashboard;
