import type { CardContext } from './card-api';
import type { RealmKeyShareField } from './command';
import { isLiveRender } from './render-context';
import {
  Button,
  FieldContainer,
  LoadingIndicator,
  Pill,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import KeyIcon from '@cardstack/boxel-icons/key';
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

// What a share's owner sees in its place when the share is suspended, by the
// reason the realm server records.
function suspensionText(share: RealmKeyShareField): string {
  switch (share.suspensionReason) {
    case 'owner-lost-write':
      return 'Its owner no longer has direct write access to this workspace.';
    case 'suspended-by-writer':
      return share.suspendedBy
        ? `Suspended by ${share.suspendedBy}.`
        : 'Suspended by a direct writer of this workspace.';
    case 'key-deleted':
      return 'Its owner deleted the key.';
    default:
      return 'Suspended.';
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A change to one share that asks first, and what it says when it asks.
type PendingChange = {
  kind: 'suspend' | 'unshare';
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
        font: 600 var(--boxel-font);
        margin: 0 0 var(--boxel-sp-xs);
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
// server refuses the listing and the entry isn't drawn at all. The listing is
// asked for only in a live render, since prerendered HTML is shared by
// everyone who reads the card. The app learns what was done in the secure
// window only by asking again, so the listing is read again whenever this
// page comes back into focus, as it does when that window closes.
export default class RealmApiKeys extends GlimmerComponent<RealmApiKeysSignature> {
  @tracked private visible = false;
  @tracked private loaded = false;
  @tracked private shares: RealmKeyShareField[] = [];
  @tracked private loadError: string | undefined;
  @tracked private pending: PendingChange | undefined;
  @tracked private changeError: string | undefined;
  @tracked private openError: string | undefined;

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
    } finally {
      this.loaded = true;
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

  private ask = (kind: PendingChange['kind'], share: RealmKeyShareField) => {
    this.pending = { kind, share };
    this.changeError = undefined;
  };

  private cancel = () => {
    this.pending = undefined;
    this.changeError = undefined;
  };

  private confirm = task(async () => {
    let pending = this.pending;
    let toolContext = this.toolContext;
    let shareId = pending?.share.shareId;
    if (!pending || !toolContext || !shareId) {
      return;
    }
    try {
      if (pending.kind === 'suspend') {
        await new SuspendKeyShareTool(toolContext).execute({ shareId });
      } else {
        await new UnshareKeyTool(toolContext).execute({ shareId });
      }
      this.pending = undefined;
      this.changeError = undefined;
    } catch (err) {
      this.changeError = errorText(err);
    }
    if (this.args.realm) {
      await this.load.perform(this.args.realm);
    }
  });

  private isPending = (share: RealmKeyShareField) =>
    this.pending?.share.shareId === share.shareId;

  private ownerText = (share: RealmKeyShareField) =>
    share.own ? 'You' : share.owner;

  <template>
    <div class='realm-api-keys' {{this.follow @realm}}>
      {{#if this.visible}}
        <EntryFrame @format={{@format}}>
          <div class='entry' data-test-realm-api-keys>
            {{#if this.loadError}}
              <p class='note error' data-test-realm-api-keys-error>
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
                      <KeyIcon class='share-icon' />
                      <div class='share-text'>
                        <span class='share-label'>{{share.label}}</span>
                        <span
                          class='share-owner'
                          data-test-realm-key-share-owner
                        >
                          {{this.ownerText share}}
                        </span>
                      </div>
                      {{#if (eq share.state 'active')}}
                        <Pill
                          class='state active'
                          data-test-realm-key-share-pill
                        >
                          Active
                        </Pill>
                      {{else}}
                        <Pill
                          class='state suspended'
                          data-test-realm-key-share-pill
                        >
                          Suspended
                        </Pill>
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
                    {{#if (this.isPending share)}}
                      <div
                        class='confirm'
                        role='alertdialog'
                        data-test-realm-key-share-confirm={{this.pending.kind}}
                      >
                        {{#if (eq this.pending.kind 'suspend')}}
                          <p class='confirm-text'>
                            Suspend “{{share.label}}”? Cards in this workspace
                            stop using this key until a direct writer swaps a
                            key in.
                          </p>
                        {{else}}
                          <p class='confirm-text'>
                            Unshare “{{share.label}}”? Cards in this workspace
                            stop using your key. The key itself is kept, and
                            stays shared everywhere else.
                          </p>
                        {{/if}}
                        {{#if this.changeError}}
                          <p
                            class='note error'
                            data-test-realm-key-share-change-error
                          >
                            {{this.changeError}}
                          </p>
                        {{/if}}
                        <div class='actions'>
                          <Button
                            @kind='secondary'
                            @size='small'
                            @disabled={{this.confirm.isRunning}}
                            {{on 'click' this.cancel}}
                            data-test-realm-key-share-cancel
                          >
                            Cancel
                          </Button>
                          <Button
                            @kind='destructive'
                            @size='small'
                            @loading={{this.confirm.isRunning}}
                            {{on 'click' this.confirm.perform}}
                            data-test-realm-key-share-confirm-button
                          >
                            {{if
                              (eq this.pending.kind 'suspend')
                              'Suspend'
                              'Unshare'
                            }}
                          </Button>
                        </div>
                      </div>
                    {{else}}
                      <div class='actions'>
                        {{#if (eq share.state 'suspended')}}
                          <Button
                            @kind='primary'
                            @size='small'
                            {{on 'click' (fn this.swapKey share)}}
                            data-test-realm-key-share-swap
                          >
                            Swap one of my keys in
                          </Button>
                        {{else}}
                          <Button
                            @kind='secondary'
                            @size='small'
                            {{on 'click' (fn this.ask 'suspend' share)}}
                            data-test-realm-key-share-suspend
                          >
                            Suspend
                          </Button>
                        {{/if}}
                        {{#if share.own}}
                          <Button
                            @kind='secondary'
                            @size='small'
                            {{on 'click' (fn this.ask 'unshare' share)}}
                            data-test-realm-key-share-unshare
                          >
                            Unshare
                          </Button>
                        {{/if}}
                      </div>
                    {{/if}}
                  </li>
                {{/each}}
              </ul>
            {{else if this.loaded}}
              <p class='note' data-test-realm-api-keys-empty>
                No keys are shared into this workspace.
              </p>
            {{else}}
              <LoadingIndicator />
            {{/if}}
            <div class='actions'>
              <Button
                @kind='primary'
                @size='small'
                {{on 'click' this.shareKey}}
                data-test-realm-api-keys-share
              >
                Share one of my keys
              </Button>
            </div>
            {{#if this.openError}}
              <p class='note error' data-test-realm-api-keys-open-error>
                {{this.openError}}
              </p>
            {{/if}}
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
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: var(--boxel-border-radius);
        background: var(--background, var(--boxel-light));
      }
      .share-summary {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .share-icon {
        flex-shrink: 0;
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .share-text {
        display: grid;
        min-width: 0;
        flex: 1;
      }
      .share-label {
        font: 600 var(--boxel-font-sm);
        overflow-wrap: anywhere;
      }
      .share-owner {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
        overflow-wrap: anywhere;
      }
      .state {
        flex-shrink: 0;
      }
      .active {
        --boxel-pill-background-color: color-mix(
          in oklch,
          var(--boxel-success-100) 22%,
          var(--background, var(--boxel-light))
        );
        --boxel-pill-font-color: var(--boxel-success-300);
        --boxel-pill-border: 1px solid var(--boxel-success-300);
      }
      .suspended {
        --boxel-pill-background-color: color-mix(
          in oklch,
          var(--boxel-warning-100) 22%,
          var(--background, var(--boxel-light))
        );
        --boxel-pill-font-color: var(--foreground, var(--boxel-dark));
        --boxel-pill-border: 1px solid var(--boxel-warning-200);
      }
      .note {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .error {
        color: var(--destructive, var(--boxel-danger));
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
      }
      .confirm {
        display: grid;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--muted, var(--boxel-100));
        border-radius: var(--boxel-border-radius-sm);
      }
      .confirm-text {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}
