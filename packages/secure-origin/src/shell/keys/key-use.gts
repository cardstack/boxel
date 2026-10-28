// Where one of the user's keys is used, as the key page's tile shows it: the
// services its approved requests go to, by registrable domain, and each
// workspace it is shared with, by name and address as the share page shows a
// workspace, with the labels cards there know it by. Both come with the key in
// the key listing (`usedWith`, `sharedInto`), so drawing them asks nothing
// more of the realm server. A domain is the realm server's; the page never
// derives one. A workspace the user can no longer read has no name, and is
// shown by its address alone.
//
// Each workspace can be unshared. Unshare asks first, saying what stops, and
// then hands the key and the workspace to `@onUnshare`, which takes the key's shares
// there out and answers whether it did. The key stays shared everywhere else.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import Button from '../../components/button.gts';
import Globe from '../../components/icons/globe.gts';
import LayoutGrid from '../../components/icons/layout-grid.gts';
import { eq } from '../../helpers/truth-helpers.ts';

import type { ListedKey, SharedWorkspace } from './context.ts';
import { addressOf } from './workspace-dropdown.gts';

interface Signature {
  Args: {
    key: ListedKey;
    onUnshare: (key: ListedKey, workspace: SharedWorkspace) => Promise<boolean>;
  };
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
      <div class='use-row' data-test-key-used-with>
        <Globe class='use-icon' aria-hidden='true' />
        {{#if @key.usedWith.length}}
          <p class='use-text'>Used with
            {{#each @key.usedWith as |domain index|}}{{#if index}},
              {{/if}}<span
                class='domain'
                data-test-key-used-with-domain
              >{{domain}}</span>{{/each}}</p>
        {{else}}
          <p class='use-text none'>Not used with any service yet</p>
        {{/if}}
      </div>
      <div class='use-row' data-test-key-shared-into>
        <LayoutGrid class='use-icon' aria-hidden='true' />
        {{#if @key.sharedInto.length}}
          <div class='shared'>
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
                  <div class='workspace-text'>
                    <span class='workspace-name' data-test-workspace-name>
                      {{workspaceTitle workspace}}
                    </span>
                    {{#if workspace.name}}
                      <span class='address' data-test-workspace-address>
                        {{addressOf workspace.url}}
                      </span>
                    {{/if}}
                    <span class='labels' data-test-workspace-labels>As
                      {{labelsOf workspace}}</span>
                  </div>
                  {{#if (eq this.confirming workspace.url)}}
                    <div
                      class='confirm'
                      role='group'
                      aria-label='Unshare from {{workspaceTitle workspace}}'
                      data-test-key-unshare-confirm
                    >
                      <p class='confirm-text'>Unshare from
                        <strong>{{workspaceTitle workspace}}</strong>? Cards
                        there stop using this key. It stays shared everywhere
                        else.</p>
                      <div class='confirm-actions'>
                        <Button
                          type='button'
                          @kind='secondary'
                          @size='extra-small'
                          @disabled={{this.saving}}
                          data-test-key-unshare-cancel
                          {{on 'click' this.cancel}}
                        >Cancel</Button>
                        <Button
                          type='button'
                          @kind='destructive'
                          @size='extra-small'
                          @loading={{this.saving}}
                          data-test-key-unshare-confirm-button
                          {{on 'click' (fn this.unshare workspace)}}
                        >Unshare</Button>
                      </div>
                    </div>
                  {{else}}
                    <Button
                      class='unshare'
                      type='button'
                      @kind='secondary'
                      @size='extra-small'
                      aria-label='Unshare {{@key.name}} from {{workspaceTitle
                        workspace
                      }}'
                      data-test-key-unshare
                      {{on 'click' (fn this.ask workspace)}}
                    >Unshare</Button>
                  {{/if}}
                </li>
              {{/each}}
            </ul>
          </div>
        {{else}}
          <p class='use-text none'>Not shared with any workspace</p>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .key-use {
        display: grid;
        gap: var(--boxel-sp-4xs);
        padding-top: var(--boxel-sp-4xs);
        border-top: 1px solid var(--border);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
      }
      .use-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        column-gap: var(--boxel-sp-xs);
        align-items: start;
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
      .heading,
      .workspace-name {
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
        grid-template-columns: minmax(0, 1fr) auto;
        column-gap: var(--boxel-sp-xs);
        row-gap: var(--boxel-sp-4xs);
        align-items: start;
      }
      .workspace-text {
        display: grid;
        min-width: 0;
      }
      .workspace-name {
        overflow-wrap: anywhere;
      }
      /* An address wraps rather than being cut short, since the part that
         tells two workspaces apart may be at its end. */
      .address,
      .labels {
        color: var(--muted-foreground);
        overflow-wrap: anywhere;
      }
      .confirm {
        grid-column: 1 / -1;
        display: grid;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
        background-color: var(--muted);
      }
      .confirm-text {
        margin: 0;
      }
      .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-4xs);
      }
    </style>
  </template>

  // The workspace whose Unshare is waiting to be confirmed, and whether it is
  // being unshared.
  private state = trackedObject({
    confirming: undefined as string | undefined,
    saving: false,
  });

  private get confirming() {
    return this.state.confirming;
  }

  private get saving() {
    return this.state.saving;
  }

  private ask = (workspace: SharedWorkspace) => {
    this.state.confirming = workspace.url;
  };

  private cancel = () => {
    this.state.confirming = undefined;
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
