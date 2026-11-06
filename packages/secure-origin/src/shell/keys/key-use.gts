// Where one of the user's keys is used, as the key page's tile shows it: the
// services its approved requests go to, by registrable domain, and each
// workspace it is shared with, by name and address as the share page shows a
// workspace, with the labels cards there know it by. Both come with the key in
// the key listing (`usedWith`, `sharedInto`), so drawing them asks nothing
// more of the realm server. A domain is the realm server's; the page never
// derives one. A workspace the user can no longer read has no name, and is
// shown by its address alone.
//
// A key that can be shared also says whether people who aren't signed in can
// use it, with its anonymous cap, and offers to change that
// (`@onChangeAnonymousUse`). It is the key's own setting: a workspace it is
// shared into decides only whether such people can use its cards there.
//
// Each workspace can be unshared. Unshare asks first, saying what stops, and
// then hands the key and the workspace to `@onUnshare`, which takes the key's shares
// there out and answers whether it did. The key stays shared everywhere else.
// The question takes the place of Unshare, so focus moves to its Cancel, and
// Cancel gives it back to Unshare, once: when focus moves on from there, a
// later redraw of the list leaves it where it is.
//
// An active share that no operation in its workspace is approved to send
// says so, since until one is, no card there calls with it: the workspace's
// cards keep asking each caller for a key of their own. Approve for a card
// hands the share to `@onApproveShare`, which sets it up for one of the
// workspace's cards.
//
// Each row is a Pret UI Item led by its icon, each workspace an Item with its
// Unshare beside it, and the unapproved note and Unshare's question are Pret
// UI Alerts carrying their buttons.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { Alert } from '@cardstack/pretui/components/alert';
import { Item } from '@cardstack/pretui/components/item';
import { focusWhen } from '@cardstack/pretui/focus';

import { Button } from '@cardstack/pretui/components/button';
import Globe from '@cardstack/boxel-icons/globe';
import Users from '@cardstack/boxel-icons/users';
import HatGlasses from '@cardstack/boxel-icons/hat-glasses';
import { eq } from '@cardstack/pretui/helpers';

import { anonymousUseSummary } from './anonymous-use-fields.gts';
import type { ListedKey, SharedWorkspace } from './context.ts';
import { addressOf } from './workspace-dropdown.gts';

interface Signature {
  Args: {
    key: ListedKey;
    onUnshare: (key: ListedKey, workspace: SharedWorkspace) => Promise<boolean>;
    // Setting up a share that no operation is approved to send yet.
    onApproveShare?: (
      key: ListedKey,
      workspace: SharedWorkspace,
      share: Share,
    ) => void;
    // Given for a key that can be shared: changing whether people who aren't
    // signed in can use it.
    onChangeAnonymousUse?: (key: ListedKey) => void;
  };
  // Rows of the key's own, such as an OAuth key's details, listed first.
  Blocks: { default: [] };
}

type Share = SharedWorkspace['shares'][number];

// The workspace's active shares of the key that no operation there is
// approved to send.
function unapproved(workspace: SharedWorkspace): Share[] {
  return workspace.shares.filter(
    (share) => share.state === 'active' && share.approvedCalls === 0,
  );
}

// What an unapproved share says: the workspace's only share is the one its
// row is about, and one of several is named by its label.
function unapprovedText(workspace: SharedWorkspace, share: Share): string {
  return workspace.shares.length === 1
    ? 'Not approved for any calls yet'
    : `“${share.label}” isn’t approved for any calls yet`;
}

// What a workspace is called on the page: its name, or its address when it
// has none.
function workspaceTitle(workspace: SharedWorkspace): string {
  return workspace.name ?? addressOf(workspace.url);
}

// The labels the key's shares in a workspace go by, a suspended one marked.
function labelsOf(workspace: SharedWorkspace): string {
  return workspace.shares
    .map(({ label, state }) =>
      state === 'suspended' ? `“${label}” (suspended)` : `“${label}”`,
    )
    .join(', ');
}

export default class KeyUse extends Component<Signature> {
  <template>
    <div class='key-use'>
      {{yield}}
      <Item
        class='use-row'
        @size='s'
        @alignStart={{true}}
        data-test-key-used-with
      >
        <:leading><Globe class='use-icon' aria-hidden='true' /></:leading>
        <:default>
          {{#if @key.usedWith.length}}
            <p class='use-text'>Used with
              {{#each @key.usedWith as |domain index|}}{{#if index}},
                {{/if}}<span
                  class='domain'
                  data-test-key-used-with-domain
                >{{domain}}</span>{{/each}}</p>
          {{else}}
            <p class='use-text none'>Not used with any site yet</p>
          {{/if}}
        </:default>
      </Item>
      <Item
        class='use-row'
        @size='s'
        @alignStart={{true}}
        data-test-key-shared-into
      >
        <:leading><Users class='use-icon' aria-hidden='true' /></:leading>
        <:default>
          {{#if @key.sharedInto.length}}
            <p
              class='use-text heading'
              id='key-shared-into-{{@key.id}}'
              data-test-key-shared-into-summary
            >Shared with
              {{@key.sharedInto.length}}
              {{if (eq @key.sharedInto.length 1) 'workspace' 'workspaces'}}</p>
            <ul
              class='workspaces'
              aria-labelledby='key-shared-into-{{@key.id}}'
              data-test-key-shared-into-list
            >
              {{#each @key.sharedInto as |workspace|}}
                <li
                  class='workspace'
                  data-test-key-shared-into-workspace={{workspace.url}}
                >
                  <Item
                    class='workspace-item'
                    @size='s'
                    @alignStart={{true}}
                    @wrap={{true}}
                  >
                    <:title><span
                        class='workspace-name'
                        data-test-workspace-name
                      >{{workspaceTitle workspace}}</span></:title>
                    <:description>
                      {{#if workspace.name}}
                        <span class='address' data-test-workspace-address>
                          {{addressOf workspace.url}}
                        </span>
                      {{/if}}
                      <span class='labels' data-test-workspace-labels>As
                        {{labelsOf workspace}}</span>
                    </:description>
                    <:actions>
                      {{#unless (eq this.confirming workspace.url)}}
                        <Button
                          class='unshare'
                          type='button'
                          @variant='secondary'
                          @size='xs'
                          aria-label='Unshare {{@key.name}} from {{workspaceTitle
                            workspace
                          }}'
                          data-test-key-unshare
                          {{focusWhen (eq this.returnFocus workspace.url)}}
                          {{on 'blur' this.forgetReturnFocus}}
                          {{on 'click' (fn this.ask workspace)}}
                        >Unshare</Button>
                      {{/unless}}
                    </:actions>
                  </Item>
                  {{#if (eq this.confirming workspace.url)}}
                    <Alert
                      @tone='warning'
                      role='group'
                      aria-label='Unshare from {{workspaceTitle workspace}}'
                      data-test-key-unshare-confirm
                    >
                      <:default>
                        <p class='use-text'>Unshare from
                          <strong>{{workspaceTitle workspace}}</strong>? Cards
                          there stop using this key. It stays shared everywhere
                          else.</p>
                      </:default>
                      <:action>
                        <div class='alert-actions'>
                          <Button
                            type='button'
                            @variant='secondary'
                            @size='xs'
                            @disabled={{this.saving}}
                            data-test-key-unshare-cancel
                            {{focusWhen true}}
                            {{on 'click' this.cancel}}
                          >Cancel</Button>
                          <Button
                            type='button'
                            @variant='destructive'
                            @size='xs'
                            @loading={{this.saving}}
                            data-test-key-unshare-confirm-button
                            {{on 'click' (fn this.unshare workspace)}}
                          >Unshare</Button>
                        </div>
                      </:action>
                    </Alert>
                  {{/if}}
                  {{#each (unapproved workspace) as |share|}}
                    {{#if @onApproveShare}}
                      <Alert
                        @tone='info'
                        role='note'
                        data-test-key-share-unapproved={{share.id}}
                      >
                        <:default>
                          <p class='use-text'>{{unapprovedText
                              workspace
                              share
                            }}</p>
                        </:default>
                        <:action>
                          <Button
                            type='button'
                            @variant='secondary'
                            @size='xs'
                            aria-label='Approve for a card: “{{share.label}}” in {{workspaceTitle
                              workspace
                            }}'
                            data-test-key-share-approve={{share.id}}
                            {{on
                              'click'
                              (fn @onApproveShare @key workspace share)
                            }}
                          >Approve for a card…</Button>
                        </:action>
                      </Alert>
                    {{else}}
                      <Alert
                        @tone='info'
                        role='note'
                        data-test-key-share-unapproved={{share.id}}
                      >
                        <p class='use-text'>{{unapprovedText
                            workspace
                            share
                          }}</p>
                      </Alert>
                    {{/if}}
                  {{/each}}
                </li>
              {{/each}}
            </ul>
          {{else}}
            <p class='use-text none'>Not shared with any workspace</p>
          {{/if}}
        </:default>
      </Item>
      {{#if @onChangeAnonymousUse}}
        <Item
          class='use-row'
          @size='s'
          @alignStart={{true}}
          data-test-key-anonymous-use
        >
          <:leading><HatGlasses
              class='use-icon'
              aria-hidden='true'
            /></:leading>
          <:default>
            <p class='use-text' data-test-key-anonymous-use-summary>
              {{anonymousUseSummary @key}}
            </p>
          </:default>
          <:actions>
            <Button
              type='button'
              @variant='secondary'
              @size='xs'
              aria-label='Change whether people who aren’t signed in can use {{@key.name}}'
              data-test-key-anonymous-use-change
              {{on 'click' (fn @onChangeAnonymousUse @key)}}
            >Change</Button>
          </:actions>
        </Item>
      {{/if}}
    </div>

    <style scoped>
      .key-use {
        container-type: inline-size;
        display: grid;
        gap: var(--boxel-sp-xs);
        padding-top: var(--boxel-sp-xs);
        border-top: 1px solid var(--border);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
      }
      /* Each row is set in the tile's small type, its icon on the first
         line. A workspace's name and address wrap rather than being cut
         short: the part of an address that tells two workspaces apart may be
         at its end. */
      .use-row,
      .workspace-item {
        --pretui-item-gap: var(--boxel-sp-xs);
        font-size: inherit;
        letter-spacing: normal;
      }
      .workspace-name {
        font-weight: 600;
      }
      .address,
      .labels {
        display: block;
      }
      .use-icon {
        width: 0.875rem;
        height: 0.875rem;
        margin-top: 0.1875rem;
        color: var(--muted-foreground);
      }
      .use-text {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .none {
        color: var(--muted-foreground);
      }
      .domain,
      .heading {
        font-weight: 600;
      }
      .workspaces {
        list-style: none;
        margin: var(--boxel-sp-4xs) 0 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .workspace {
        display: grid;
        row-gap: var(--boxel-sp-4xs);
      }
      .alert-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-4xs);
      }
    </style>
  </template>

  // The workspace whose Unshare is waiting to be confirmed, whether it is
  // being unshared, and the workspace whose Unshare takes focus back once its
  // question is cancelled.
  private state = trackedObject({
    confirming: undefined as string | undefined,
    saving: false,
    returnFocus: undefined as string | undefined,
  });

  private get returnFocus() {
    return this.state.returnFocus;
  }

  private get confirming() {
    return this.state.confirming;
  }

  private get saving() {
    return this.state.saving;
  }

  private ask = (workspace: SharedWorkspace) => {
    this.state.returnFocus = undefined;
    this.state.confirming = workspace.url;
  };

  private cancel = () => {
    this.state.returnFocus = this.state.confirming;
    this.state.confirming = undefined;
  };

  private forgetReturnFocus = () => {
    this.state.returnFocus = undefined;
  };

  private unshare = async (workspace: SharedWorkspace) => {
    if (this.state.saving) {
      return;
    }
    this.state.saving = true;
    try {
      if (await this.args.onUnshare(this.args.key, workspace)) {
        this.state.confirming = undefined;
      }
    } finally {
      this.state.saving = false;
    }
  };
}
