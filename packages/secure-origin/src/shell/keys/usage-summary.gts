// A key's or a share's use, as its owner reads it: what it spent today and
// this month against each budget, when it was last used and by whom, the
// callers who used it most this month, for a share whose workspace is
// published where its calls came from, the calls refused and why, how the
// service answered, and where the key may be sent, with any destination whose
// service rejected it. Nothing here is a value or a request: only counts,
// codes, statuses, destinations, sites and who called.
//
// Each budget's meter is a Pret UI ProgressBar, held to a continuous bar so a
// small budget never draws as steps. The details sit behind a Pret UI
// Disclosure, and each group of counts is a KeyValue list with its counts at
// the end of their column.
import Component from '@glimmer/component';

import { Disclosure } from '@cardstack/pretui/components/disclosure';
import { KeyValue } from '@cardstack/pretui/components/key-value';
import { ProgressBar } from '@cardstack/pretui/components/progress-bar';
import { StatusChip } from '@cardstack/pretui/components/status-chip';

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

// A budget's reading, as its meter shows and announces it.
function budgetText(used: number, budget: number): string {
  return `${count(used)} of ${calls(budget)}`;
}

// Each group's rows, as KeyValue lists them: what the count is of, and the
// count, with what the row is about for the template to mark it by.
function callerRows(usage: KeyUsage) {
  return usage.topCallers.map((entry) => ({
    key: callerText(entry.caller, entry.withheld),
    value: count(entry.calls),
    caller: entry.caller ?? undefined,
  }));
}

function realmRows(usage: KeyUsage) {
  return (usage.realms ?? []).map((entry) => ({
    key: realmText(entry),
    value: count(entry.calls),
    realm: entry.realm,
    published: entry.published ? 'true' : 'false',
  }));
}

function refusalRows(usage: KeyUsage) {
  return usage.refusals.map((entry) => ({
    key: refusalText(entry.code),
    value: count(entry.count),
    code: entry.code,
  }));
}

function outcomeRows(usage: KeyUsage) {
  return usage.vendorOutcomes.map((entry) => ({
    key: statusText(entry.status, entry.outcome),
    value: count(entry.count),
    status: String(entry.status),
  }));
}

// A key has a grant per destination, and several can share a host, so each
// is named by its host and path.
function grantRows(usage: KeyUsage) {
  return usage.grants.map((grant) => ({
    key: hostAndPath(grant.destination),
    value: '',
    state: grant.state,
    lastForbiddenAt: grant.lastForbiddenAt,
  }));
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
          <ProgressBar
            @value={{@usage.budgets.day.used}}
            @max={{@usage.budgets.day.budget}}
            @steps={{false}}
            @valueText={{budgetText
              @usage.budgets.day.used
              @usage.budgets.day.budget
            }}
            aria-label='Calls today'
          />
        </div>
        <div class='meter' data-test-key-usage-budget='month'>
          <span class='meter-label'>This month</span>
          <span class='meter-value'><strong>{{count
                @usage.budgets.month.used
              }}</strong>
            of
            {{calls @usage.budgets.month.budget}}</span>
          <ProgressBar
            @value={{@usage.budgets.month.used}}
            @max={{@usage.budgets.month.budget}}
            @steps={{false}}
            @valueText={{budgetText
              @usage.budgets.month.used
              @usage.budgets.month.budget
            }}
            aria-label='Calls this month'
          />
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
      <Disclosure
        @size='s'
        @label='Details this month'
        data-test-key-usage-details
      >
        <div class='detail-grid'>
          {{#if @usage.topCallers.length}}
            <div class='group' data-test-key-usage-callers>
              <h4 class='group-title'>Most calls</h4>
              <KeyValue
                class='counts'
                @items={{callerRows @usage}}
                @valueAlign='end'
              >
                <:value as |row|><span
                    class='n'
                    data-test-key-usage-caller={{row.caller}}
                  >{{row.value}}</span></:value>
              </KeyValue>
            </div>
          {{/if}}
          {{#if (fromPublishedSite @usage.realms)}}
            <div class='group' data-test-key-usage-realms>
              <h4 class='group-title'>Where it was used</h4>
              <KeyValue
                class='counts'
                @items={{realmRows @usage}}
                @valueAlign='end'
              >
                <:value as |row|><span
                    class='n'
                    data-test-key-usage-realm={{row.realm}}
                    data-test-key-usage-realm-published={{row.published}}
                  >{{row.value}}</span></:value>
              </KeyValue>
            </div>
          {{/if}}
          {{#if @usage.refusals.length}}
            <div class='group' data-test-key-usage-refusals>
              <h4 class='group-title'>Refused</h4>
              <KeyValue
                class='counts'
                @items={{refusalRows @usage}}
                @valueAlign='end'
              >
                <:value as |row|><span
                    class='n'
                    data-test-key-usage-refusal={{row.code}}
                  >{{row.value}}</span></:value>
              </KeyValue>
            </div>
          {{/if}}
          {{#if @usage.vendorOutcomes.length}}
            <div class='group' data-test-key-usage-outcomes>
              <h4 class='group-title'>Service answers</h4>
              <KeyValue
                class='counts'
                @items={{outcomeRows @usage}}
                @valueAlign='end'
              >
                <:value as |row|><span
                    class='n'
                    data-test-key-usage-outcome={{row.status}}
                  >{{row.value}}</span></:value>
              </KeyValue>
            </div>
          {{/if}}
          {{#if @usage.grants.length}}
            <div class='group destinations' data-test-key-usage-grants>
              <h4 class='group-title'>Sent to</h4>
              <KeyValue class='counts' @items={{grantRows @usage}}>
                <:value as |row|><span
                    class='flag'
                    data-test-key-usage-grant={{row.key}}
                    data-test-key-usage-grant-state={{row.state}}
                  >
                    {{#if (eq row.state 'rejected')}}
                      <StatusChip
                        @value='Rejected'
                        @tone='danger'
                        @appearance='soft'
                        @dot={{false}}
                      />
                    {{else if row.lastForbiddenAt}}
                      Last refused
                      {{shortDate row.lastForbiddenAt}}
                    {{/if}}
                  </span></:value>
              </KeyValue>
            </div>
          {{/if}}
        </div>
      </Disclosure>
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
      .note {
        margin: 0;
        color: var(--muted-foreground);
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
      /* Each count's name in the list's own type, the count beside it. */
      .counts {
        --pretui-kv-label-color: var(--foreground);
        --pretui-kv-label-font-weight: normal;
        --pretui-kv-label-font-size: var(--boxel-font-size-xs);
        --pretui-kv-label-line-height: var(--boxel-line-height-xs);
        grid-template-columns: minmax(0, 1fr) auto;
        column-gap: var(--boxel-sp-xs);
        row-gap: var(--boxel-sp-5xs);
        overflow-wrap: break-word;
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
      /* A long destination wraps, and keeps its flag in view beside it. */
      .destinations .counts {
        grid-template-columns: minmax(0, max-content) 1fr;
      }
      .flag {
        color: var(--muted-foreground);
      }
    </style>
  </template>
}
