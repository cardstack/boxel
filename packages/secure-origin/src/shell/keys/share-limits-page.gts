// The `share-limits` page: a share's usage and limits, for the owner of the
// key it holds to change the limits. Realm config's API Keys entry opens it,
// since changing a limit is a key-owner action that only this window's
// session may take: the app's session, which card code holds, can't raise a
// limit. A direct writer of the realm who doesn't own the share sees its
// numbers in realm config and is told here that only its owner changes them;
// anyone else, who can't see the share, is told the link names none.
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  realmShares,
  setShareLimits,
  shareUsage,
  windowContext,
  type KeyLimitChanges,
  type KeyShare,
  type KeyUsage,
} from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';

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
  | { name: 'not-owner'; context: WindowContext; share: KeyShare }
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
        @heading='Limits for a shared key'
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
      </EditPage>
    {{else if this.editing}}
      <EditPage
        @heading='Limits for {{this.editing.share.label}}'
        data-test-share-limits
      >
        <:intro>Your key, shared with
          <strong>{{this.editing.context.realm.name}}</strong>. Limits apply to
          every card there that uses it, and to the AI assistant and the CLI.
          They count calls; what the service charges for one is set by your plan
          with it.</:intro>
        <:default>
          <OpenedForSummary
            @context={{this.editing.context}}
            @reason={{this.opened.reason}}
          />
          <UsageSummary @usage={{this.editing.usage}} />
          <LimitsForm
            @limits={{this.editing.usage.limits}}
            @onSave={{this.saveLimits}}
          />
        </:default>
      </EditPage>
    {{/if}}
    <style scoped>
      .busy {
        margin-top: var(--boxel-sp-xl);
      }
    </style>
  </template>

  private opened = openedFor();
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
        : { name: 'not-owner', context, share };
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

  private saveLimits = async (
    changes: KeyLimitChanges,
  ): Promise<string | undefined> => {
    let editing = this.editing;
    if (!editing) {
      return undefined;
    }
    try {
      let limits = await setShareLimits(
        this.args.api.config,
        editing.share.id,
        changes,
      );
      this.page.state = {
        ...editing,
        usage: { ...editing.usage, limits },
      };
      return undefined;
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return undefined;
      }
      return failureMessage(e);
    }
  };
}

export default class ShareLimitsPage extends Component {
  <template>
    <KeysWindow @title='Boxel · Your keys' @page='share-limits' as |api|>
      <ShareLimits @api={{api}} />
    </KeysWindow>
  </template>
}
