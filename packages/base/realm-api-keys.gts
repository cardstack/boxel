import type { CardContext } from './card-api';
import type { RealmKeyShareField } from './command';
import { isLiveRender } from './render-context';
// The edit format's other rows are the card API's field containers, which
// Pret UI has no counterpart for, so this row is one too.
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import KeyIcon from '@cardstack/boxel-icons/key';
import { Button } from '@cardstack/pretui/components/button';
import { Chip } from '@cardstack/pretui/components/chip';
import { Popconfirm } from '@cardstack/pretui/components/popconfirm';
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
      ? 'Cards in this workspace stop using this key until a direct writer swaps a key in.'
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

// The realm's API Keys entry: the keys its direct writers have shared into it
// for cards there to use, and what a direct writer does with them.
//
// The entry shows each share's label, its owner and whether it is in use, and
// why a suspended one is suspended. It never shows or takes a key's value:
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
        | { mode: 'swap-key'; share: string; reason: string },
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
      reason: 'Share one of your keys into this workspace',
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
                {{#each this.shares as |share|}}
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
                    <div class='actions'>
                      {{#if (eq share.state 'suspended')}}
                        <Button
                          @tone='primary'
                          @appearance='accent'
                          @size='s'
                          {{on 'click' (fn this.swapKey share)}}
                          data-test-realm-key-share-swap
                        >
                          Swap one of my keys in
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
                No keys are shared into this workspace.
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
