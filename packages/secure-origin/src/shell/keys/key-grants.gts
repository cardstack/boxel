// Where one of the user's keys may be sent, as the key page's tile lists it:
// each grant's full host and path, and the approvals that send the key there
// (an operation, on a card, in a workspace). Removing a grant first lists
// those approvals, since removing it revokes every one, then hands the grant
// to `@onRemove`, which removes it and answers whether it did. A card that
// needs the key there again asks for its approval again.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import Button from '../../components/button.gts';
import { eq, not } from '../../helpers/truth-helpers.ts';

import type { KeyBinding, KeyGrant, ListedKey } from '../../security/keys.ts';
import { addressOf } from './workspace-dropdown.gts';

interface Signature {
  Args: {
    key: ListedKey;
    // Undefined when they couldn't be read.
    bindings: KeyBinding[] | undefined;
    onRemove: (grant: KeyGrant) => Promise<boolean>;
  };
}

function hostAndPath(destination: string): string {
  let url = new URL(destination);
  return `${url.host}${url.pathname}`;
}

// An operation's name split into words, as the window names an operation
// that has no label: `listPRs` as `List PRs`.
function operationWords(name: string): string {
  let words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default class KeyGrants extends Component<Signature> {
  <template>
    {{#if @key.grants.length}}
      <ul class='grants' data-test-key-grants>
        {{#each @key.grants key='id' as |grant|}}
          <li
            class='grant'
            data-test-key-grant={{hostAndPath grant.destination}}
          >
            <div class='grant-row'>
              <span class='where'>{{hostAndPath grant.destination}}</span>
              {{#if @bindings}}
                <span class='count' data-test-key-grant-count>
                  {{#let (this.bindingsOf grant) as |bindings|}}
                    {{bindings.length}}
                    {{if (eq bindings.length 1) 'approval' 'approvals'}}
                  {{/let}}
                </span>
              {{/if}}
              {{#unless (this.isRemoving grant)}}
                <Button
                  @kind='text-only'
                  @size='extra-small'
                  data-test-key-grant-remove
                  {{on 'click' (fn this.startRemove grant)}}
                >Remove</Button>
              {{/unless}}
            </div>
            <ul class='bindings'>
              {{#each (this.bindingsOf grant) as |binding|}}
                <li data-test-key-grant-binding={{binding.operation}}>
                  {{operationWords binding.operation}}
                  on
                  {{binding.type.name}}
                  in
                  {{addressOf binding.realm}}
                </li>
              {{/each}}
            </ul>
            {{#if (this.isRemoving grant)}}
              <div class='panel' role='alert' data-test-key-grant-remove-panel>
                <p class='confirm'>
                  {{#let (this.bindingsOf grant) as |bindings|}}
                    {{#if (not @bindings)}}
                      Removing this stops the key being sent to
                      {{hostAndPath grant.destination}}
                      and revokes every approval that sends it there.
                    {{else if bindings.length}}
                      Removing this stops the key being sent to
                      {{hostAndPath grant.destination}}
                      and revokes
                      {{if
                        (eq bindings.length 1)
                        'the approval'
                        'the approvals'
                      }}
                      above. A card that needs it there will ask you again.
                    {{else}}
                      Removing this stops the key being sent to
                      {{hostAndPath grant.destination}}.
                    {{/if}}
                  {{/let}}
                </p>
                <div class='panel-actions'>
                  <Button
                    @kind='secondary'
                    @size='extra-small'
                    data-test-key-grant-remove-cancel
                    {{on 'click' this.cancel}}
                  >Cancel</Button>
                  <Button
                    @kind='destructive'
                    @size='extra-small'
                    @loading={{this.state.removing}}
                    data-test-key-grant-remove-confirm
                    {{on 'click' (fn this.remove grant)}}
                  >Remove</Button>
                </div>
              </div>
            {{/if}}
          </li>
        {{/each}}
      </ul>
    {{/if}}

    <style scoped>
      .grants {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
      }
      .grant-row {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
      }
      .where {
        font-family: var(--boxel-monospace-font-family);
        overflow-wrap: anywhere;
      }
      .count {
        color: var(--muted-foreground);
      }
      .bindings {
        margin: var(--boxel-sp-5xs, 2px) 0 0;
        padding-inline-start: var(--boxel-sp-lg);
        color: var(--muted-foreground);
        overflow-wrap: anywhere;
      }
      .panel {
        margin-top: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
        background-color: var(--muted);
      }
      .confirm {
        margin: 0;
      }
      .panel-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
        margin-top: var(--boxel-sp-xs);
      }
    </style>
  </template>

  private state = trackedObject({
    removing: false,
    grant: undefined as string | undefined,
  });

  private bindingsOf = (grant: KeyGrant) =>
    (this.args.bindings ?? []).filter((b) => b.grantId === grant.id);

  private isRemoving = (grant: KeyGrant) => this.state.grant === grant.id;

  private startRemove = (grant: KeyGrant) => {
    this.state.grant = grant.id;
  };

  private cancel = () => {
    this.state.grant = undefined;
  };

  private remove = async (grant: KeyGrant) => {
    this.state.removing = true;
    try {
      if (await this.args.onRemove(grant)) {
        this.state.grant = undefined;
      }
    } finally {
      this.state.removing = false;
    }
  };
}
