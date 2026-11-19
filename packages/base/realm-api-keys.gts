import type { CardContext } from './card-api';
import type { KeyShareUsageResult, RealmKeyShareField } from './command';
import { isLiveRender } from './render-context';
// The edit format's other rows are the card API's field containers, which
// Pret UI has no counterpart for, so this row is one too.
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import KeyIcon from '@cardstack/boxel-icons/key';
import { Button } from '@cardstack/pretui/components/button';
import { Chip } from '@cardstack/pretui/components/chip';
import { Popconfirm } from '@cardstack/pretui/components/popconfirm';
import GetKeyShareUsageTool from '@cardstack/boxel-host/commands/get-key-share-usage';
import ListRealmKeySharesTool from '@cardstack/boxel-host/commands/list-realm-key-shares';
import OpenSecureWindowTool from '@cardstack/boxel-host/commands/open-secure-window';
import SuspendKeyShareTool from '@cardstack/boxel-host/commands/suspend-key-share';
import UnshareKeyTool from '@cardstack/boxel-host/commands/unshare-key';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { restartableTask, task } from 'ember-concurrency';
import { modifier } from 'ember-modifier';

// Why a suspended share is suspended, by the reason the realm server records,
// as the realm's direct writers read it.
function suspensionText(share: RealmKeyShareField): string {
  switch (share.suspensionReason) {
    case 'owner-lost-write':
      return 'Its owner no longer has direct write access to this workspace.';
    case 'suspended-by-writer':
      if (share.suspendedByYou) {
        return 'Suspended by you.';
      }
      return share.suspendedBy
        ? `Suspended by ${share.suspendedBy}.`
        : 'Suspended by a direct writer of this workspace.';
    case 'key-deleted':
      return 'Its owner deleted the key.';
    default:
      return 'Suspended.';
  }
}

// Whose key a share holds. The realm server leaves the owner out once no
// permission row in the realm names them, so a share can outlive the realm's
// knowledge of who shared it.
function ownerText(share: RealmKeyShareField): string {
  if (share.own) {
    return 'You';
  }
  return share.owner || 'A former member of this workspace';
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type ChangeKind = 'suspend' | 'unshare';

// Why a call was refused, in the words a realm's writers read. A code with
// none here is shown as it is.
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

function refusalText(code: string | undefined): string {
  return (code && REFUSED_BECAUSE[code]) ?? code ?? '';
}

// How the service answered, by HTTP status.
function statusText(status: string | undefined, outcome?: string): string {
  let code = Number(status);
  if (outcome === 'vendor-forbidden') {
    return `${status} Forbidden`;
  }
  if (code === 401) {
    return `${status} Unauthorized`;
  }
  if (code === 429) {
    return `${status} Rate limited by the service`;
  }
  if (code >= 200 && code < 300) {
    return `${status} OK`;
  }
  return status ?? '';
}

const COUNT = new Intl.NumberFormat('en-US');

// A formatter throws on an invalid date where toLocaleString would print
// "Invalid Date"; an unparseable timestamp reads as absent instead.
function formatDate(format: Intl.DateTimeFormat, iso: string | undefined) {
  let date = iso ? new Date(iso) : undefined;
  return date && !Number.isNaN(date.getTime()) ? format.format(date) : '';
}

function count(n: number | undefined): string {
  return COUNT.format(n ?? 0);
}

function calls(n: number | undefined): string {
  return `${count(n)} ${n === 1 ? 'call' : 'calls'}`;
}

const WHEN_FORMAT = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function when(iso: string | undefined): string {
  return formatDate(WHEN_FORMAT, iso);
}

// Who called, by Matrix id. Someone the user isn't shown, since no
// permission row in the realm names both of them, reads as someone else, and
// in the list of callers all of them are counted together as others.
// A count past a budget lowered after it was spent fills the meter, and no
// more.
function capped(used: number | undefined, budget: number | undefined): number {
  return Math.min(used ?? 0, budget ?? 0);
}

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

function shortDate(iso: string | undefined): string {
  return formatDate(SHORT_DATE_FORMAT, iso);
}

// A destination as the key pages name it: its host and path, the prefix a
// request must start with to be sent the key. The secure origin's key pages
// name it with their own `hostAndPath` (`shell/keys/key-grants.gts`), which
// base can't import, so the two must produce the same text. This one also
// takes an absent destination, which a `KeyUsageGrantField` may hold.
function hostAndPath(destination: string | undefined): string {
  if (!destination) {
    return '';
  }
  let url = new URL(destination);
  return `${url.host}${url.pathname}`;
}

function callerText(caller: string | undefined, withheld?: boolean): string {
  if (withheld) {
    return 'Others';
  }
  return caller || 'Someone not signed in';
}

function lastCallerText(
  caller: string | undefined,
  withheld?: boolean,
): string {
  if (withheld) {
    return 'someone else';
  }
  return caller || 'someone not signed in';
}

// A change to one share that is asking for confirmation.
type PendingChange = {
  kind: ChangeKind;
  share: RealmKeyShareField;
};

interface EntryFrameSignature {
  Args: { format: 'edit' | 'isolated' };
  Blocks: { default: [] };
}

// The entry as one of the config card's field rows, or as one of its
// sections, around the same body.
class EntryFrame extends GlimmerComponent<EntryFrameSignature> {
  <template>
    {{#if (eq @format 'edit')}}
      <FieldContainer
        @label='API Keys'
        @icon={{KeyIcon}}
        data-test-field='apiKeys'
      >
        {{yield}}
      </FieldContainer>
    {{else}}
      <section class='section' data-test-realm-api-keys-section>
        <h2 class='section-title'>API Keys</h2>
        {{yield}}
      </section>
    {{/if}}
    <style scoped>
      .section-title {
        font-weight: 600;
        font-size: var(--boxel-font-size);
        margin: 0 0 var(--boxel-sp-xs);
      }
    </style>
  </template>
}

interface ShareChangeSignature {
  Args: {
    kind: ChangeKind;
    share: RealmKeyShareField;
    open: boolean;
    busy: boolean;
    error: string | undefined;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    onCancel: () => void;
  };
}

// Suspend or Unshare on one share, and the question it asks before it acts.
class ShareChange extends GlimmerComponent<ShareChangeSignature> {
  private get verb(): string {
    return this.args.kind === 'suspend' ? 'Suspend' : 'Unshare';
  }

  private get question(): string {
    return `${this.verb} “${this.args.share.label}”?`;
  }

  private get consequence(): string {
    return this.args.kind === 'suspend'
      ? 'Cards in this workspace stop using this key until a direct writer swaps it with one of their own keys.'
      : 'Cards in this workspace stop using your key. The key itself is kept, and stays shared everywhere else.';
  }

  <template>
    <Popconfirm
      @open={{@open}}
      @onOpenChange={{@onOpenChange}}
      @label={{this.question}}
      @confirmLabel={{this.verb}}
      @cancelLabel='Cancel'
      @busy={{@busy}}
      @placement='bottom'
      @onConfirm={{@onConfirm}}
      @onCancel={{@onCancel}}
    >
      <:trigger as |_open toggle|>
        <Button
          @tone='neutral'
          @appearance='outlined'
          @size='s'
          {{on 'click' toggle}}
          data-test-realm-key-share-change={{@kind}}
        >
          {{this.verb}}
        </Button>
      </:trigger>
      <:default>
        <div class='question' data-test-realm-key-share-confirm={{@kind}}>
          <span class='question-title'>{{this.question}}</span>
          <span class='question-detail'>{{this.consequence}}</span>
          {{#if @error}}
            <span
              class='question-error'
              role='alert'
              data-test-realm-key-share-change-error
            >{{@error}}</span>
          {{/if}}
        </div>
      </:default>
    </Popconfirm>
    <style scoped>
      .question {
        display: grid;
        gap: var(--boxel-sp-5xs);
      }
      .question-title {
        font-weight: 600;
      }
      .question-detail {
        color: var(--muted-foreground);
      }
      .question-error {
        color: var(--destructive-ink);
      }
    </style>
  </template>
}

interface ShareUsageSignature {
  Args: {
    share: RealmKeyShareField;
    context: CardContext | undefined;
    // Opens the secure window where the owner of the share's key changes its
    // limits.
    onEditLimits: (share: RealmKeyShareField) => void;
    // Changes each time the entry reads its listing again, which reads the
    // usage again too.
    refresh: number;
  };
}

// One share's usage, as the realm's direct writers read it. Always shown:
// what it spent today and this month against its budgets, as meters, when it
// was last used and by whom, and its limits. Behind a disclosure, for the
// month: the callers who used it most, the calls refused and why, how the
// service answered, and where its key is sent, with any destination whose
// service rejected it. The owner of the key it holds changes the limits in
// the secure window, since the app's session may not; another writer sees
// them and, if they think the share is being abused, suspends it.
class ShareUsage extends GlimmerComponent<ShareUsageSignature> {
  @tracked private usage: KeyShareUsageResult | undefined;
  @tracked private error: string | undefined;

  private load = restartableTask(async (shareId: string) => {
    let toolContext = this.args.context?.toolContext;
    if (!toolContext) {
      return;
    }
    try {
      this.usage = await new GetKeyShareUsageTool(toolContext).execute({
        shareId,
      });
      this.error = undefined;
    } catch (err) {
      this.error = errorText(err);
    }
  });

  // Read again whenever the entry reads its listing again (`@refresh`); the
  // usage shown stays until the new one arrives.
  private follow = modifier(
    (_element, [shareId]: [string | undefined, number | undefined]) => {
      if (shareId) {
        this.load.perform(shareId);
      }
    },
  );

  private editLimits = () => this.args.onEditLimits(this.args.share);

  <template>
    <div class='usage' {{this.follow @share.shareId @refresh}}>
      {{#if this.error}}
        <p
          class='note error'
          role='alert'
          data-test-realm-key-share-usage-error
        >
          This key’s usage couldn’t be loaded:
          {{this.error}}
        </p>
      {{else if this.usage.visible}}
        <section
          class='usage-body'
          aria-label='Usage'
          data-test-realm-key-share-usage
        >
          <div class='meters'>
            <div class='meter' data-test-realm-key-share-budget='day'>
              <span class='meter-label'>Today</span>
              <span class='meter-value'><strong>{{count
                    this.usage.day.used
                  }}</strong>
                of
                {{calls this.usage.day.budget}}</span>
              <progress
                class='meter-bar'
                max={{this.usage.day.budget}}
                value={{capped this.usage.day.used this.usage.day.budget}}
                aria-label='Calls today'
              ></progress>
            </div>
            <div class='meter' data-test-realm-key-share-budget='month'>
              <span class='meter-label'>This month</span>
              <span class='meter-value'><strong>{{count
                    this.usage.month.used
                  }}</strong>
                of
                {{calls this.usage.month.budget}}</span>
              <progress
                class='meter-bar'
                max={{this.usage.month.budget}}
                value={{capped this.usage.month.used this.usage.month.budget}}
                aria-label='Calls this month'
              ></progress>
            </div>
          </div>
          <p class='note' data-test-realm-key-share-last-use>
            {{#if this.usage.lastUseAt}}
              Last used
              {{when this.usage.lastUseAt}}
              by
              {{lastCallerText
                this.usage.lastUseCaller
                this.usage.lastUseCallerWithheld
              }}{{#if (eq this.usage.lastUseOutcome 'refused')}}, refused{{/if}}.
            {{else}}
              Not used yet.
            {{/if}}
          </p>
          <div class='limits' data-test-realm-key-share-limits>
            <dl class='limit-list'>
              <div data-test-realm-key-share-limit='rate'>
                <dt>Each person</dt>
                <dd>{{calls this.usage.rateBurst}}
                  at once, then
                  {{count this.usage.rateRefillPerMinute}}
                  a minute</dd>
              </div>
              <div data-test-realm-key-share-limit='budget'>
                <dt>The key, in total across everyone</dt>
                <dd>{{calls this.usage.dailyBudget}}
                  a day,
                  {{count this.usage.monthlyBudget}}
                  a month</dd>
              </div>
            </dl>
            {{#if this.usage.canEditLimits}}
              <Button
                @tone='neutral'
                @appearance='outlined'
                @size='s'
                {{on 'click' this.editLimits}}
                data-test-realm-key-share-edit-limits
              >
                Edit limits
              </Button>
            {{/if}}
          </div>
          <details class='details' data-test-realm-key-share-usage-details>
            <summary class='details-summary'>
              Details this month
            </summary>
            <div class='detail-grid'>
              {{#if this.usage.topCallers.length}}
                <div class='group' data-test-realm-key-share-callers>
                  <h3 class='group-title'>Most calls</h3>
                  <ul class='counts'>
                    {{#each this.usage.topCallers as |entry|}}
                      <li data-test-realm-key-share-caller={{entry.name}}>
                        <span class='name'>{{callerText
                            entry.name
                            entry.withheld
                          }}</span>
                        <span class='n'>{{count entry.count}}</span>
                      </li>
                    {{/each}}
                  </ul>
                </div>
              {{/if}}
              {{#if this.usage.refusals.length}}
                <div class='group' data-test-realm-key-share-refusals>
                  <h3 class='group-title'>Refused</h3>
                  <ul class='counts'>
                    {{#each this.usage.refusals as |entry|}}
                      <li data-test-realm-key-share-refusal={{entry.name}}>
                        <span class='name'>{{refusalText entry.name}}</span>
                        <span class='n'>{{count entry.count}}</span>
                      </li>
                    {{/each}}
                  </ul>
                </div>
              {{/if}}
              {{#if this.usage.vendorOutcomes.length}}
                <div class='group' data-test-realm-key-share-outcomes>
                  <h3 class='group-title'>Service answers</h3>
                  <ul class='counts'>
                    {{#each this.usage.vendorOutcomes as |entry|}}
                      <li data-test-realm-key-share-outcome={{entry.name}}>
                        <span class='name'>{{statusText
                            entry.name
                            entry.outcome
                          }}</span>
                        <span class='n'>{{count entry.count}}</span>
                      </li>
                    {{/each}}
                  </ul>
                </div>
              {{/if}}
              {{#if this.usage.grants.length}}
                <div
                  class='group destinations'
                  data-test-realm-key-share-grants
                >
                  <h3 class='group-title'>Sent to</h3>
                  <ul class='counts'>
                    {{#each this.usage.grants as |grant|}}
                      {{! A key has a grant per destination, and several can
                          share a host, so each is named by its host and path. }}
                      <li
                        data-test-realm-key-share-grant={{hostAndPath
                          grant.destination
                        }}
                        data-test-realm-key-share-grant-state={{grant.state}}
                      >
                        <span class='name host'>{{hostAndPath
                            grant.destination
                          }}</span>
                        {{#if (eq grant.state 'rejected')}}
                          <Chip @tone='danger' @label='Rejected' />
                        {{else if grant.lastForbiddenAt}}
                          <span
                            class='flag'
                            title='Last refused {{when grant.lastForbiddenAt}}'
                          >Last refused
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
      {{/if}}
    </div>
    <style scoped>
      .usage-body {
        display: grid;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
      }
      .meters {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--boxel-sp-xs);
      }
      .meter {
        display: grid;
        gap: var(--boxel-sp-5xs);
        font-size: var(--boxel-font-size-xs);
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
        background: var(--muted);
      }
      .meter-bar::-webkit-progress-bar {
        background: var(--muted);
      }
      .meter-bar::-webkit-progress-value {
        background: var(--primary);
      }
      .meter-bar::-moz-progress-bar {
        background: var(--primary);
      }
      .limits {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }
      .limit-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs) var(--boxel-sp-sm);
        margin: 0;
        font-size: var(--boxel-font-size-xs);
      }
      .limit-list dt {
        color: var(--muted-foreground);
      }
      .limit-list dd {
        margin: 0;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .details-summary {
        cursor: pointer;
        width: fit-content;
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      .detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
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
        font-size: var(--boxel-font-size-xs);
      }
      .counts li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
      }
      .name {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .n {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .host {
        font-family: var(--font-mono);
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
      .note {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .error {
        color: var(--destructive-ink);
      }
    </style>
  </template>
}

interface RealmApiKeysSignature {
  Args: {
    // The realm this config card configures, or undefined for a config card
    // stored anywhere else, which configures nothing.
    realm: string | undefined;
    context: CardContext | undefined;
    // `edit` lays the entry out as one of the card's field rows; `isolated`
    // as one of its sections.
    format: 'edit' | 'isolated';
  };
}

// The realm's API Keys entry: the keys its direct writers have shared with it
// for cards there to use, and what a direct writer does with them.
//
// The entry shows each share's label, its owner and whether it is in use, why
// a suspended one is suspended, the card operations it is approved for in
// this realm, by type and card as the realm server names them, and its usage
// and limits (`ShareUsage`). It never shows or takes a key's value:
// sharing a key, and swapping one into a suspended share, open the secure
// window, which is the one place a key is chosen, and suspending a share or
// withdrawing your own needs no key at all. A key is added on the secure
// window's key page; the share page points there when the user has none.
//
// Only the realm's direct writers see its shares, so for anyone else the realm
// server refuses the listing and the entry isn't drawn at all. Nothing is drawn
// until the first listing answers, so a reader never sees the entry flash. The
// listing is asked for only in a live render, since prerendered HTML is shared
// by everyone who reads the card. The app learns what was done in the secure
// window only by asking again, so the listing is read again whenever this page
// comes back into focus, as it does when that window closes.
export default class RealmApiKeys extends GlimmerComponent<RealmApiKeysSignature> {
  @tracked private visible = false;
  @tracked private shares: RealmKeyShareField[] = [];
  // How many times the listing was read, which each share's usage follows.
  @tracked private loads = 0;
  @tracked private loadError: string | undefined;
  @tracked private pending: PendingChange | undefined;
  @tracked private changeError: string | undefined;
  @tracked private openError: string | undefined;
  // What the last change did, announced to assistive technology, since the
  // control that made it is gone once the listing is read again.
  @tracked private status: string | undefined;

  private get toolContext() {
    return this.args.context?.toolContext;
  }

  private follow = modifier((element, [realm]: [string | undefined]) => {
    if (!realm || !isLiveRender(element)) {
      return;
    }
    this.load.perform(realm);
    let reload = () => {
      if (document.visibilityState === 'visible') {
        this.load.perform(realm);
      }
    };
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    return () => {
      window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', reload);
    };
  });

  private load = restartableTask(async (realm: string) => {
    let toolContext = this.toolContext;
    if (!toolContext) {
      return;
    }
    try {
      let result = await new ListRealmKeySharesTool(toolContext).execute({
        realm,
      });
      this.visible = Boolean(result.visible);
      this.shares = [...(result.shares ?? [])];
      this.loads++;
      this.loadError = undefined;
    } catch (err) {
      // A listing that failed for any reason but the user not being a direct
      // writer says so, rather than hiding the entry.
      this.visible = true;
      this.loadError = errorText(err);
    }
  });

  private openWindow = task(
    async (
      request:
        | { mode: 'share-key'; reason: string }
        | {
            mode: 'swap-key' | 'share-limits';
            share: string;
            reason: string;
          },
    ) => {
      let toolContext = this.toolContext;
      let realm = this.args.realm;
      if (!toolContext || !realm) {
        return;
      }
      this.openError = undefined;
      try {
        await new OpenSecureWindowTool(toolContext).execute({
          ...request,
          realm,
        });
      } catch (err) {
        this.openError = errorText(err);
      }
    },
  );

  private shareKey = () => {
    this.openWindow.perform({
      mode: 'share-key',
      reason: 'Share one of your keys with this workspace',
    });
  };

  private swapKey = (share: RealmKeyShareField) => {
    if (!share.shareId) {
      return;
    }
    this.openWindow.perform({
      mode: 'swap-key',
      share: share.shareId,
      reason: `Swap one of your keys into “${share.label}”`,
    });
  };

  private editLimits = (share: RealmKeyShareField) => {
    if (!share.shareId) {
      return;
    }
    this.openWindow.perform({
      mode: 'share-limits',
      share: share.shareId,
      reason: `Change the limits of “${share.label}”`,
    });
  };

  private isOpen = (kind: ChangeKind, share: RealmKeyShareField) =>
    this.pending?.kind === kind && this.pending.share.shareId === share.shareId;

  private openChange = (
    kind: ChangeKind,
    share: RealmKeyShareField,
    open: boolean,
  ) => {
    if (open) {
      this.pending = { kind, share };
      this.changeError = undefined;
    } else if (!this.confirm.isRunning) {
      this.cancel();
    }
  };

  private cancel = () => {
    this.pending = undefined;
    this.changeError = undefined;
  };

  // Started from the confirm button. While it runs the question stays open
  // with the button pending; a refusal keeps it open with the server's reason.
  private confirm = task(async () => {
    let pending = this.pending;
    let toolContext = this.toolContext;
    let shareId = pending?.share.shareId;
    if (!pending || !toolContext || !shareId) {
      return;
    }
    this.status = undefined;
    try {
      if (pending.kind === 'suspend') {
        await new SuspendKeyShareTool(toolContext).execute({ shareId });
      } else {
        await new UnshareKeyTool(toolContext).execute({ shareId });
      }
      this.status = `${pending.kind === 'suspend' ? 'Suspended' : 'Unshared'} “${pending.share.label}”.`;
      this.cancel();
    } catch (err) {
      this.changeError = errorText(err);
    }
    if (this.args.realm) {
      await this.load.perform(this.args.realm);
    }
  });

  private startConfirm = () => {
    this.confirm.perform();
  };

  <template>
    <div class='realm-api-keys' {{this.follow @realm}}>
      {{#if this.visible}}
        <EntryFrame @format={{@format}}>
          <div class='entry' data-test-realm-api-keys>
            {{#if this.loadError}}
              <p class='note error' role='alert' data-test-realm-api-keys-error>
                The workspace's shared keys couldn't be loaded:
                {{this.loadError}}
              </p>
            {{else if this.shares.length}}
              <ul class='shares'>
                {{#each this.shares key='shareId' as |share|}}
                  <li
                    class='share'
                    data-test-realm-key-share={{share.label}}
                    data-test-realm-key-share-state={{share.state}}
                  >
                    <div class='share-summary'>
                      <KeyIcon
                        class='share-icon'
                        width='16'
                        height='16'
                        aria-hidden='true'
                      />
                      <div class='share-text'>
                        <span class='share-label'>{{share.label}}</span>
                        <span
                          class='share-owner'
                          data-test-realm-key-share-owner
                        >
                          {{ownerText share}}
                        </span>
                      </div>
                      {{#if (eq share.state 'active')}}
                        <Chip
                          @tone='success'
                          @label='Active'
                          class='state'
                          data-test-realm-key-share-pill
                        />
                      {{else}}
                        <Chip
                          @tone='warning'
                          @label='Suspended'
                          class='state'
                          data-test-realm-key-share-pill
                        />
                      {{/if}}
                    </div>
                    {{#if (eq share.state 'suspended')}}
                      <p
                        class='note'
                        data-test-realm-key-share-reason={{share.suspensionReason}}
                      >
                        {{suspensionText share}}
                      </p>
                    {{/if}}
                    {{#if share.operations.length}}
                      <div
                        class='operations'
                        data-test-realm-key-share-operations
                      >
                        <p class='note'>Approved for</p>
                        <ul class='operation-list'>
                          {{#each share.operations as |operation|}}
                            <li
                              class='operation'
                              data-test-realm-key-share-operation={{operation.bindingId}}
                            >
                              <div class='operation-text'>
                                <span
                                  class='operation-name'
                                  data-test-realm-key-share-operation-name
                                >
                                  {{operation.operation}}
                                  on
                                  {{operation.name}}
                                </span>
                                <span
                                  class='operation-detail'
                                  data-test-realm-key-share-operation-module
                                >
                                  {{operation.module}}
                                </span>
                                {{#if operation.instance}}
                                  <span
                                    class='operation-detail'
                                    data-test-realm-key-share-operation-instance
                                  >
                                    For the card
                                    {{operation.instance}}
                                  </span>
                                {{/if}}
                              </div>
                              {{#if (eq operation.state 'needs-reapproval')}}
                                <Chip
                                  @tone='warning'
                                  @label='Needs re-approval'
                                  class='state'
                                  data-test-realm-key-share-operation-state={{operation.state}}
                                />
                              {{else if (eq operation.state 'suspended')}}
                                <Chip
                                  @label='Suspended'
                                  class='state'
                                  data-test-realm-key-share-operation-state={{operation.state}}
                                />
                              {{/if}}
                            </li>
                          {{/each}}
                        </ul>
                      </div>
                    {{else}}
                      <p class='note' data-test-realm-key-share-no-operations>
                        No operation is approved to use it yet.
                      </p>
                    {{/if}}
                    <ShareUsage
                      @share={{share}}
                      @context={{@context}}
                      @onEditLimits={{this.editLimits}}
                      @refresh={{this.loads}}
                    />
                    <div class='actions'>
                      {{#if (eq share.state 'suspended')}}
                        <Button
                          @tone='primary'
                          @appearance='accent'
                          @size='s'
                          {{on 'click' (fn this.swapKey share)}}
                          data-test-realm-key-share-swap
                        >
                          Swap with one of my keys
                        </Button>
                      {{else}}
                        <ShareChange
                          @kind='suspend'
                          @share={{share}}
                          @open={{this.isOpen 'suspend' share}}
                          @busy={{this.confirm.isRunning}}
                          @error={{this.changeError}}
                          @onOpenChange={{fn this.openChange 'suspend' share}}
                          @onConfirm={{this.startConfirm}}
                          @onCancel={{this.cancel}}
                        />
                      {{/if}}
                      {{#if share.own}}
                        <ShareChange
                          @kind='unshare'
                          @share={{share}}
                          @open={{this.isOpen 'unshare' share}}
                          @busy={{this.confirm.isRunning}}
                          @error={{this.changeError}}
                          @onOpenChange={{fn this.openChange 'unshare' share}}
                          @onConfirm={{this.startConfirm}}
                          @onCancel={{this.cancel}}
                        />
                      {{/if}}
                    </div>
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class='note' data-test-realm-api-keys-empty>
                No keys are shared with this workspace.
              </p>
            {{/if}}
            <div class='actions'>
              <Button
                @tone='primary'
                @appearance='accent'
                @size='s'
                {{on 'click' this.shareKey}}
                data-test-realm-api-keys-share
              >
                Share one of my keys
              </Button>
            </div>
            {{#if this.openError}}
              <p
                class='note error'
                role='alert'
                data-test-realm-api-keys-open-error
              >
                {{this.openError}}
              </p>
            {{/if}}
            <p
              class='visually-hidden'
              role='status'
              data-test-realm-api-keys-status
            >{{this.status}}</p>
          </div>
        </EntryFrame>
      {{/if}}
    </div>
    <style scoped>
      .realm-api-keys {
        display: contents;
      }
      .entry {
        display: grid;
        gap: var(--boxel-sp-sm);
      }
      .shares {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .share {
        display: grid;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        background: var(--background);
      }
      .share-summary {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .share-icon {
        flex-shrink: 0;
        color: var(--muted-foreground);
      }
      .share-text {
        display: grid;
        min-width: 0;
        flex: 1;
      }
      .share-label {
        font-weight: 600;
        font-size: var(--boxel-font-size-sm);
        overflow-wrap: break-word;
      }
      .share-owner {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        overflow-wrap: break-word;
      }
      .state {
        flex-shrink: 0;
      }
      .operations {
        display: grid;
        gap: var(--boxel-sp-5xs);
      }
      .operation-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp-5xs);
      }
      .operation {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .operation-text {
        display: grid;
        min-width: 0;
        flex: 1;
      }
      .operation-name {
        font-weight: 600;
        font-size: var(--boxel-font-size-xs);
        overflow-wrap: break-word;
      }
      .operation-detail {
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        overflow-wrap: anywhere;
      }
      .note {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .error {
        color: var(--destructive-ink);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }
    </style>
  </template>
}
