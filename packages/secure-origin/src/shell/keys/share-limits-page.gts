// The `share-limits` page: a share's usage and limits, for the owner of the
// key it holds to change the limits. Realm config's API Keys entry opens it,
// since changing a limit is a key-owner action that only this window's
// session may take: the app's session, which card code holds, can't raise a
// limit. The key page opens it too, from a notice that the share's use
// reached a limit (`#…&then=keys`), and then offers a way back to it. A direct
// writer of the realm who doesn't own the share sees its usage here and is
// told that only its owner changes the limits; anyone else, who can't see the
// share, is told the link names none.
// A share that no operation in the workspace is approved to send says so to
// its owner, with Approve for a card, which opens the key's use page for the
// share: until an operation is approved, no card there calls with it.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  realmShares,
  setShareLimits,
  shareUsage,
  windowContext,
  type KeyLimitChanges,
  type KeyLimits,
  type KeyShare,
  type KeyUsage,
} from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import { navigation } from '../navigation.js';
import { pageTitle } from './trail.ts';
import { keyUsePath } from '../pages.js';
import { pageURL } from '../urls.js';

import {
  failureMessage,
  isSignedOut,
  LinkError,
  loadFailure,
  type LoadFailure,
  type WindowContext,
} from './context.ts';
import EditPage from './edit-page.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LimitsForm from './limits-form.gts';
import LoadFailed from './load-failed.gts';
import NeedsAdmin from './needs-admin.gts';
import OpenedForSummary from './opened-for-summary.gts';
import { openedFor } from './opened-for.ts';
import UsageSummary from './usage-summary.gts';

type State =
  | { name: 'loading' }
  | { name: 'load-failed'; failure: LoadFailure }
  | { name: 'needs-admin'; context: WindowContext }
  | {
      name: 'not-owner';
      context: WindowContext;
      share: KeyShare;
      usage: KeyUsage;
    }
  | {
      name: 'editing';
      context: WindowContext;
      share: KeyShare;
      usage: KeyUsage;
    };

class ShareLimits extends Component<{ Args: { api: KeysWindowAPI } }> {
  <template>
    {{#if this.loading}}
      <BusyMessage class='busy' @title='Loading…' />
    {{else if this.loadFailed}}
      <LoadFailed
        @heading={{this.title}}
        @failure={{this.loadFailed.failure}}
        @onRetry={{this.load}}
      />
    {{else if this.needsAdmin}}
      <NeedsAdmin @realm={{this.needsAdmin.context.realm}} />
    {{else if this.notOwner}}
      <EditPage
        @heading='Only its owner changes these limits'
        data-test-share-limits-not-owner
      >
        <:intro><strong>{{this.notOwner.share.label}}</strong>
          in
          <strong>{{this.notOwner.context.realm.name}}</strong>
          holds someone else’s key. Only they change its limits. If you think
          it’s being overused, suspend it from the workspace’s settings.</:intro>
        <:default>
          <UsageSummary @usage={{this.notOwner.usage}} />
        </:default>
        <:actions>
          {{#if this.returnsToKeys}}
            <Button
              @kind='secondary'
              data-test-share-limits-back
              {{on 'click' this.backToKeys}}
            >Back to your keys</Button>
          {{/if}}
        </:actions>
      </EditPage>
    {{else if this.editing}}
      <EditPage @heading={{this.title}} data-test-share-limits>
        <:intro><strong>{{this.editing.share.label}}</strong>, your key shared
          with
          <strong>{{this.editing.context.realm.name}}</strong>. These limits
          count the calls made with it by every card there, the AI assistant and
          the CLI. What each call costs depends on your plan with the service.</:intro>
        <:default>
          <OpenedForSummary
            @context={{this.editing.context}}
            @reason={{this.opened.reason}}
          />
          {{#if this.unapproved}}
            <div class='unapproved' data-test-share-limits-unapproved>
              <p class='unapproved-text'>Not approved for any calls yet. No card
                in
                <strong>{{this.editing.context.realm.name}}</strong>
                calls with this key until you approve it for one.</p>
              <Button
                type='button'
                @kind='secondary'
                @size='extra-small'
                data-test-share-limits-approve
                {{on 'click' this.approveForCard}}
              >Approve for a card…</Button>
            </div>
          {{/if}}
          <UsageSummary @usage={{this.editing.usage}} />
          <LimitsForm
            @shared={{true}}
            @limits={{this.editing.usage.limits}}
            @onSave={{this.saveLimits}}
          />
        </:default>
        <:actions>
          {{#if this.returnsToKeys}}
            <Button
              @kind='secondary'
              data-test-share-limits-back
              {{on 'click' this.backToKeys}}
            >Back to your keys</Button>
          {{/if}}
        </:actions>
      </EditPage>
    {{/if}}
    {{! The pages above that have no buttons of their own still go back. }}
    {{#if this.backBelow}}
      <footer class='back'>
        <Button
          @kind='secondary'
          data-test-share-limits-back
          {{on 'click' this.backToKeys}}
        >Back to your keys</Button>
      </footer>
    {{/if}}
    <style scoped>
      .busy {
        margin-top: var(--boxel-sp-xl);
      }
      .unapproved {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        column-gap: var(--boxel-sp-xs);
        align-items: center;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background-color: var(--muted);
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .unapproved-text {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .back {
        display: flex;
        justify-content: flex-end;
        padding: 0 var(--boxel-sp-xl) var(--boxel-sp-xl);
      }
    </style>
  </template>

  private title = pageTitle('share-limits');

  private opened = openedFor();

  // Opened from the key page, which it goes back to.
  private returnsToKeys =
    new URLSearchParams(window.location.hash.replace(/^#/, '')).get('then') ===
    'keys';

  private backToKeys = () => navigation.back(pageURL('keys'));

  // A failed load and the needs-admin page draw no buttons of their own.
  private get backBelow() {
    return this.returnsToKeys && (!!this.loadFailed || !!this.needsAdmin);
  }
  // The owner's active share, when no operation in the workspace is approved
  // to send it.
  private get unapproved() {
    let share = this.editing?.share;
    return (
      share?.state === 'active' &&
      Boolean(share.keyId) &&
      share.operations?.length === 0
    );
  }

  // The share is set up for one of the workspace's cards on its key's use
  // page, which goes on to the key page when done.
  private approveForCard = () => {
    let share = this.editing?.share;
    if (!share?.keyId) {
      return;
    }
    navigation.assign(
      `${pageURL(keyUsePath(share.keyId))}#${new URLSearchParams({
        realm: share.realm,
        share: share.id,
      })}`,
    );
  };

  private page = trackedObject<{ state: State }>({
    state: { name: 'loading' },
  });

  constructor(owner: Owner, args: { api: KeysWindowAPI }) {
    super(owner, args);
    this.load();
  }

  private get loading() {
    return this.page.state.name === 'loading';
  }
  private get loadFailed() {
    return this.page.state.name === 'load-failed' ? this.page.state : undefined;
  }
  private get needsAdmin() {
    return this.page.state.name === 'needs-admin' ? this.page.state : undefined;
  }
  private get notOwner() {
    return this.page.state.name === 'not-owner' ? this.page.state : undefined;
  }
  private get editing() {
    return this.page.state.name === 'editing' ? this.page.state : undefined;
  }

  private load = async () => {
    let { realm, share: shareId } = this.opened;
    this.page.state = { name: 'loading' };
    let { config } = this.args.api;
    try {
      if (!realm || !shareId) {
        throw new LinkError(
          'this page names no workspace and shared key',
          'This link doesn’t name a workspace and a shared key.',
        );
      }
      let context = await windowContext(config, { realm });
      if (!context.realm.directWriter) {
        this.page.state = { name: 'needs-admin', context };
        this.args.api.visit.loaded();
        return;
      }
      let share = (await realmShares(config, context.realm.url)).find(
        (s) => s.id === shareId,
      );
      if (!share) {
        throw new LinkError(
          'that workspace has no such shared key',
          'This shared key isn’t in that workspace. It may have been removed.',
        );
      }
      let usage = await shareUsage(config, share.id);
      this.page.state = usage.canEditLimits
        ? { name: 'editing', context, share, usage }
        : { name: 'not-owner', context, share, usage };
      this.args.api.visit.loaded();
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
      } else {
        this.args.api.visit.loadFailed(e);
        this.page.state = { name: 'load-failed', failure: loadFailure(e) };
      }
    }
  };

  // Saves the limits, then reads the usage again for the budgets they set.
  // The limits are saved once the change is, whether or not that read
  // succeeds; a usage that can't be read again keeps what it showed, with
  // the new limits.
  private saveLimits = async (
    changes: KeyLimitChanges,
  ): Promise<KeyLimits | string> => {
    let editing = this.editing;
    if (!editing) {
      return 'This shared key isn’t open for changes.';
    }
    let limits: KeyLimits;
    try {
      limits = await setShareLimits(
        this.args.api.config,
        editing.share.id,
        changes,
      );
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
      }
      return failureMessage(e);
    }
    let usage: KeyUsage = { ...editing.usage, limits };
    try {
      usage = {
        ...(await shareUsage(this.args.api.config, editing.share.id)),
        limits,
      };
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return limits;
      }
    }
    this.page.state = { ...editing, usage };
    return limits;
  };
}

export default class ShareLimitsPage extends Component {
  <template>
    <KeysWindow @title='Boxel · Your keys' @page='share-limits' as |api|>
      <ShareLimits @api={{api}} />
    </KeysWindow>
  </template>
}
