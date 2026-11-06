// A key's or a share's use, as its owner reads it: what it spent today and
// this month against each budget, when it was last used and by whom, the
// callers who used it most this month, for a share whose workspace is
// published where its calls came from, the calls refused and why, how the
// service answered, and where the key may be sent, with any destination whose
// service rejected it. Nothing here is a value or a request: only counts,
// codes, statuses, destinations, sites and who called.
import Component from '@glimmer/component';

import { eq } from '@cardstack/pretui/helpers';
import type { KeyUsage } from '../../security/keys.ts';
import { hostAndPath } from './key-grants.gts';

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
    return `${status} Unauthorized`;
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
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function callerText(caller: string | null, withheld?: boolean): string {
  if (withheld) {
    return 'Others';
  }
  return caller ?? 'Someone not signed in';
}

// Where a share's calls came from: its workspace, or a site published from
// it, named by its address as a visitor types it.
function realmText(entry: { realm: string; published?: true }): string {
  if (!entry.published) {
    return 'The workspace';
  }
  let url = new URL(entry.realm);
  return `Published site ${url.host}${url.pathname.replace(/\/$/, '')}`;
}

// The breakdown is drawn only once a published site has used the share: until
// then every call is the workspace's, which the totals above already say.
function fromPublishedSite(realms: KeyUsage['realms'] | undefined): boolean {
  return Boolean(realms?.some((entry) => entry.published));
}

function lastCallerText(caller: string | null, withheld?: boolean): string {
  if (withheld) {
    return 'someone else';
  }
  return caller ?? 'someone not signed in';
}

export default class UsageSummary extends Component<Signature> {
  <template>
    <section class='usage' aria-label='Usage' data-test-key-usage ...attributes>
      <div class='meters'>
        <div class='meter' data-test-key-usage-budget='day'>
          <span class='meter-label'>Today</span>
          <span class='meter-value'><strong>{{count
                @usage.budgets.day.used
              }}</strong>
            of
            {{calls @usage.budgets.day.budget}}</span>
          <progress
            class='meter-bar'
            max={{@usage.budgets.day.budget}}
            value={{capped @usage.budgets.day.used @usage.budgets.day.budget}}
            aria-label='Calls today'
          ></progress>
        </div>
        <div class='meter' data-test-key-usage-budget='month'>
          <span class='meter-label'>This month</span>
          <span class='meter-value'><strong>{{count
                @usage.budgets.month.used
              }}</strong>
            of
            {{calls @usage.budgets.month.budget}}</span>
          <progress
            class='meter-bar'
            max={{@usage.budgets.month.budget}}
            value={{capped
              @usage.budgets.month.used
              @usage.budgets.month.budget
            }}
            aria-label='Calls this month'
          ></progress>
        </div>
      </div>
      <p class='note' data-test-key-usage-last>
        {{#if @usage.lastUse}}
          Last used
          {{when @usage.lastUse.at}}
          by
          {{lastCallerText @usage.lastUse.caller @usage.lastUse.withheld}}{{#if
            (eq @usage.lastUse.outcome 'refused')
          }}, refused{{/if}}.
        {{else}}
          Not used yet.
        {{/if}}
        Budgets count calls from cards, the AI assistant and the CLI, not
        scheduled runs.
      </p>
      <details class='details' data-test-key-usage-details>
        <summary class='details-summary'>Details this month</summary>
        <div class='detail-grid'>
          {{#if @usage.topCallers.length}}
            <div class='group' data-test-key-usage-callers>
              <h4 class='group-title'>Most calls</h4>
              <ul class='counts'>
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
            </div>
          {{/if}}
          {{#if (fromPublishedSite @usage.realms)}}
            <div class='group' data-test-key-usage-realms>
              <h4 class='group-title'>Where it was used</h4>
              <ul class='counts'>
                {{#each @usage.realms as |entry|}}
                  <li
                    data-test-key-usage-realm={{entry.realm}}
                    data-test-key-usage-realm-published={{if
                      entry.published
                      'true'
                      'false'
                    }}
                  >
                    <span class='name'>{{realmText entry}}</span>
                    <span class='n'>{{count entry.calls}}</span>
                  </li>
                {{/each}}
              </ul>
            </div>
          {{/if}}
          {{#if @usage.refusals.length}}
            <div class='group' data-test-key-usage-refusals>
              <h4 class='group-title'>Refused</h4>
              <ul class='counts'>
                {{#each @usage.refusals as |entry|}}
                  <li data-test-key-usage-refusal={{entry.code}}>
                    <span class='name'>{{refusalText entry.code}}</span>
                    <span class='n'>{{count entry.count}}</span>
                  </li>
                {{/each}}
              </ul>
            </div>
          {{/if}}
          {{#if @usage.vendorOutcomes.length}}
            <div class='group' data-test-key-usage-outcomes>
              <h4 class='group-title'>Service answers</h4>
              <ul class='counts'>
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
            </div>
          {{/if}}
          {{#if @usage.grants.length}}
            <div class='group destinations' data-test-key-usage-grants>
              <h4 class='group-title'>Sent to</h4>
              <ul class='counts'>
                {{#each @usage.grants as |grant|}}
                  {{! A key has a grant per destination, and several can share
                      a host, so each is named by its host and path. }}
                  <li
                    data-test-key-usage-grant={{hostAndPath grant.destination}}
                    data-test-key-usage-grant-state={{grant.state}}
                  >
                    <span class='name'>{{hostAndPath grant.destination}}</span>
                    {{#if (eq grant.state 'rejected')}}
                      <span class='flag rejected'>Rejected</span>
                    {{else if grant.lastForbiddenAt}}
                      <span class='flag'>Last refused
                        {{shortDate grant.lastForbiddenAt}}</span>
                    {{/if}}
                  </li>
                {{/each}}
              </ul>
            </div>
          {{/if}}
        </div>
      </details>
    </section>
    <style scoped>
      .usage {
        display: grid;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
      }
      .meters {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--boxel-sp-sm);
      }
      .meter {
        display: grid;
        gap: var(--boxel-sp-5xs);
      }
      .meter-label {
        color: var(--muted-foreground);
      }
      .meter-value strong {
        font-size: var(--boxel-font-size-sm);
      }
      .meter-bar {
        width: 100%;
        height: 6px;
        appearance: none;
        border: none;
        border-radius: 3px;
        overflow: hidden;
        background: var(--muted, var(--boxel-200));
      }
      .meter-bar::-webkit-progress-bar {
        background: var(--muted, var(--boxel-200));
      }
      .meter-bar::-webkit-progress-value {
        background: var(--primary, var(--boxel-highlight));
      }
      .meter-bar::-moz-progress-bar {
        background: var(--primary, var(--boxel-highlight));
      }
      .note {
        margin: 0;
        color: var(--muted-foreground);
      }
      .details-summary {
        cursor: pointer;
        width: fit-content;
        font-weight: 600;
      }
      .detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
        gap: var(--boxel-sp-sm);
        margin-top: var(--boxel-sp-xs);
      }
      .group {
        display: grid;
        align-content: start;
        gap: var(--boxel-sp-5xs);
      }
      .group-title {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      .counts {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp-5xs);
      }
      .counts li {
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
      }
      .name {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .n {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
      /* A destination's host and path is longer than a count's name, so its
         list takes the whole width, and each flag follows its destination
         rather than sitting at the far edge. */
      .destinations {
        grid-column: 1 / -1;
      }
      .destinations li {
        justify-content: flex-start;
        flex-wrap: wrap;
      }
      .flag {
        flex-shrink: 0;
        color: var(--muted-foreground);
      }
      .flag.rejected {
        color: var(--destructive-ink, var(--boxel-danger));
        font-weight: 600;
      }
    </style>
  </template>
}
