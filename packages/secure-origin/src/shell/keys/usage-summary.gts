// A key's or a share's use, as its owner reads it: what it spent today and
// this month against each budget, when it was last used and by whom, the
// callers who used it most this month, the calls refused and why, how the
// service answered, and where the key may be sent, with any destination whose
// service rejected it. Nothing here is a value or a request: only counts,
// codes, statuses, hosts and who called.
import Component from '@glimmer/component';

import { eq } from '../../helpers/truth-helpers.ts';
import type { KeyUsage } from '../../security/keys.ts';

interface Signature {
  Args: { usage: KeyUsage };
  Element: HTMLElement;
}

// Why a call was refused, in the words its owner reads. A code with none
// here is shown as it is.
const REFUSED_BECAUSE: Record<string, string> = {
  'rate-limited': 'Over a caller’s rate limit',
  'over-budget': 'Over budget',
  'rate-limit-unavailable': 'Use couldn’t be counted',
  'share-suspended': 'Shared key suspended',
  'credential-rejected': 'Key rejected by the service',
  'key-rejected': 'Key rejected by the service',
  'binding-needs-reapproval': 'Request changed since it was approved',
  'interactive-use-not-approved': 'Not approved for use from a card',
  'guard-refused': 'Destination refused',
  'upstream-timeout': 'Service didn’t answer in time',
  'response-too-large': 'Response too large',
};

export function refusalText(code: string): string {
  return REFUSED_BECAUSE[code] ?? code;
}

// How the service answered, by HTTP status.
export function statusText(status: number, outcome?: string): string {
  if (outcome === 'vendor-forbidden') {
    return `${status} Forbidden`;
  }
  if (status === 401) {
    return `${status} Key rejected`;
  }
  if (status === 429) {
    return `${status} Rate limited by the service`;
  }
  if (status >= 200 && status < 300) {
    return `${status} OK`;
  }
  return String(status);
}

const COUNT = new Intl.NumberFormat('en-US');

function count(n: number): string {
  return COUNT.format(n);
}

function calls(n: number): string {
  return `${count(n)} ${n === 1 ? 'call' : 'calls'}`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// A count past a budget lowered after it was spent fills the meter, and no
// more.
function capped(used: number, budget: number): number {
  return Math.min(used, budget);
}

// Who called, by Matrix id. Someone the user isn't shown, since no
// permission row in the realm names both of them, reads as someone else, and
// in the list of callers all of them are counted together as others.
function callerText(caller: string | null, withheld?: boolean): string {
  if (withheld) {
    return 'Others';
  }
  return caller ?? 'Someone not signed in';
}

function lastCallerText(caller: string | null, withheld?: boolean): string {
  if (withheld) {
    return 'someone else';
  }
  return caller ?? 'someone not signed in';
}

export default class UsageSummary extends Component<Signature> {
  <template>
    <div class='usage' data-test-key-usage ...attributes>
      <dl class='budgets'>
        <div class='budget' data-test-key-usage-budget='day'>
          <dt>Today</dt>
          <dd>
            <span class='used'>{{count @usage.budgets.day.used}}</span>
            of
            {{calls @usage.budgets.day.budget}}
            <progress
              class='meter'
              max={{@usage.budgets.day.budget}}
              value={{capped @usage.budgets.day.used @usage.budgets.day.budget}}
              aria-label='Today: {{count @usage.budgets.day.used}} of {{calls
                @usage.budgets.day.budget
              }}'
            ></progress>
          </dd>
        </div>
        <div class='budget' data-test-key-usage-budget='month'>
          <dt>This month</dt>
          <dd>
            <span class='used'>{{count @usage.budgets.month.used}}</span>
            of
            {{calls @usage.budgets.month.budget}}
            <progress
              class='meter'
              max={{@usage.budgets.month.budget}}
              value={{capped
                @usage.budgets.month.used
                @usage.budgets.month.budget
              }}
              aria-label='This month: {{count
                @usage.budgets.month.used
              }} of {{calls @usage.budgets.month.budget}}'
            ></progress>
          </dd>
        </div>
      </dl>
      <p class='note'>Budgets count calls from cards, the AI assistant and the
        CLI. Scheduled runs count against none.</p>

      <p class='line' data-test-key-usage-last>
        {{#if @usage.lastUse}}
          Last used
          {{when @usage.lastUse.at}}
          by
          <strong>{{lastCallerText
              @usage.lastUse.caller
              @usage.lastUse.withheld
            }}</strong>{{#if (eq @usage.lastUse.outcome 'refused')}}, refused{{/if}}.
        {{else}}
          Not used yet.
        {{/if}}
      </p>

      {{#if @usage.topCallers.length}}
        <section class='group' data-test-key-usage-callers>
          <h4>Most calls this month</h4>
          <ul>
            {{#each @usage.topCallers as |entry|}}
              <li data-test-key-usage-caller={{entry.caller}}>
                <span class='name'>{{callerText
                    entry.caller
                    entry.withheld
                  }}</span>
                <span class='n'>{{count entry.calls}}</span>
              </li>
            {{/each}}
          </ul>
        </section>
      {{/if}}

      {{#if @usage.refusals.length}}
        <section class='group' data-test-key-usage-refusals>
          <h4>Refused this month</h4>
          <ul>
            {{#each @usage.refusals as |entry|}}
              <li data-test-key-usage-refusal={{entry.code}}>
                <span class='name'>{{refusalText entry.code}}</span>
                <span class='n'>{{count entry.count}}</span>
              </li>
            {{/each}}
          </ul>
        </section>
      {{/if}}

      {{#if @usage.vendorOutcomes.length}}
        <section class='group' data-test-key-usage-outcomes>
          <h4>How the service answered</h4>
          <ul>
            {{#each @usage.vendorOutcomes as |entry|}}
              <li data-test-key-usage-outcome={{entry.status}}>
                <span class='name'>{{statusText
                    entry.status
                    entry.outcome
                  }}</span>
                <span class='n'>{{count entry.count}}</span>
              </li>
            {{/each}}
          </ul>
        </section>
      {{/if}}

      {{#if @usage.grants.length}}
        <section class='group' data-test-key-usage-grants>
          <h4>Sent to</h4>
          <ul>
            {{#each @usage.grants as |grant|}}
              <li
                data-test-key-usage-grant={{grant.host}}
                data-test-key-usage-grant-state={{grant.state}}
              >
                <span class='name'>{{grant.host}}</span>
                {{#if (eq grant.state 'rejected')}}
                  <span class='flag'>Rejected by the service</span>
                {{else if grant.lastForbiddenAt}}
                  <span class='flag muted'>Last refused
                    {{when grant.lastForbiddenAt}}</span>
                {{/if}}
              </li>
            {{/each}}
          </ul>
        </section>
      {{/if}}
    </div>
    <style scoped>
      .usage {
        display: grid;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
      }
      .budgets {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-xs);
        margin: 0;
      }
      .budget {
        padding: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
        box-shadow: 0 0 0 1px var(--border);
      }
      dt {
        color: var(--muted-foreground);
      }
      dd {
        margin: 0;
      }
      .used {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .meter {
        display: block;
        width: 100%;
        margin-top: var(--boxel-sp-4xs);
        height: 4px;
        appearance: none;
        border: none;
        border-radius: 2px;
        background: var(--muted, var(--boxel-200));
        overflow: hidden;
      }
      .meter::-webkit-progress-bar {
        background: var(--muted, var(--boxel-200));
      }
      .meter::-webkit-progress-value {
        background: var(--primary, var(--boxel-highlight));
      }
      .meter::-moz-progress-bar {
        background: var(--primary, var(--boxel-highlight));
      }
      .note,
      .line {
        margin: 0;
      }
      .note {
        color: var(--muted-foreground);
      }
      .group h4 {
        margin: 0 0 var(--boxel-sp-4xs);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp-5xs);
      }
      li {
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        overflow-wrap: anywhere;
      }
      .n {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
      .flag {
        color: var(--destructive-ink, var(--boxel-danger));
        font-weight: 500;
        flex-shrink: 0;
      }
      .flag.muted {
        color: var(--muted-foreground);
        font-weight: 400;
      }
    </style>
  </template>
}
