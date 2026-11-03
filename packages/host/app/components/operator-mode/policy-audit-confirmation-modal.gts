import type { TOC } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { BoxelButton, Modal } from '@cardstack/boxel-ui/components';
import { cssVar } from '@cardstack/boxel-ui/helpers';

import type { PolicyShareAuditEntry } from '@cardstack/runtime-common';

import type PolicyAuditConfirmationService from '@cardstack/host/services/policy-audit-confirmation';

// The operation's class and name: the module is the realm's, and shown on
// the entry already.
function operationLabel(operation: string) {
  let hash = operation.lastIndexOf('#');
  return hash === -1 ? operation : operation.slice(hash + 1);
}

const EntryItem: TOC<{ Args: { entry: PolicyShareAuditEntry } }> = <template>
  <li
    class='entry'
    data-test-policy-audit-entry={{if @entry.label @entry.label @entry.realm}}
  >
    {{#if @entry.label}}
      <div class='label'>{{@entry.label}}</div>
      <div class='detail'>
        Shared by
        {{@entry.owner}}
        into
        {{@entry.realm}}
      </div>
    {{else}}
      <div class='label'>A key shared into {{@entry.realm}}</div>
      <div class='detail'>
        Only that workspace's writers can see which key it is and who shared it.
      </div>
    {{/if}}
    <div class='operations'>
      {{#each @entry.operations as |operation|}}
        <code>{{operationLabel operation}}</code>
      {{/each}}
    </div>
  </li>
  <style scoped>
    .entry {
      padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
    }
    .entry + .entry {
      border-top: 1px solid var(--border);
    }
    .label {
      font-weight: 600;
    }
    .detail {
      color: var(--muted-foreground);
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      overflow-wrap: anywhere;
    }
    .operations {
      display: flex;
      flex-wrap: wrap;
      gap: var(--boxel-sp-xxxs);
      margin-top: var(--boxel-sp-xxxs);
    }
    code {
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      background: var(--muted);
      padding: 0 var(--boxel-sp-xxxs);
      border-radius: var(--boxel-border-radius-xs);
    }
  </style>
</template>;

// The confirmation a policy save needs when it opens shared keys to people
// who aren't signed in: which keys visitors will start using, and which will
// refuse them until their owners allow it on the key. Saving tells each
// key's owner.
export default class PolicyAuditConfirmationModal extends Component {
  @service
  declare private policyAuditConfirmation: PolicyAuditConfirmationService;

  // While this is mounted the service can ask; without it, a refused save
  // reports the refusal rather than waiting on an answer nobody can give.
  private unregister: () => void;

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    this.unregister = this.policyAuditConfirmation.registerAsker();
  }

  willDestroy() {
    super.willDestroy();
    this.unregister();
  }

  private get audit() {
    return this.policyAuditConfirmation.pending;
  }

  private get starting() {
    return this.audit?.entries.filter((entry) => entry.keyAllowsAnonymous);
  }

  private get refusing() {
    return this.audit?.entries.filter((entry) => !entry.keyAllowsAnonymous);
  }

  private answer = (confirmed: boolean) => {
    this.policyAuditConfirmation.answer(confirmed);
  };

  private cancel = () => this.answer(false);

  <template>
    {{#if this.audit}}
      <Modal
        data-test-policy-audit-modal
        @layer='urgent'
        @size='medium'
        @isOpen={{true}}
        @onClose={{this.cancel}}
        style={{cssVar boxel-modal-offset-top='20vh'}}
      >
        <section class='policy-audit'>
          <header>
            <h2>Let people who aren't signed in use shared keys?</h2>
            <p>
              This change lets people who aren't signed in make calls that send
              a key shared into the workspace.
            </p>
          </header>
          {{#if this.starting.length}}
            <div class='group' data-test-policy-audit-starting>
              <h3>They will start using</h3>
              <ul>
                {{#each this.starting as |entry|}}
                  <EntryItem @entry={{entry}} />
                {{/each}}
              </ul>
            </div>
          {{/if}}
          {{#if this.refusing.length}}
            <div class='group' data-test-policy-audit-refusing>
              <h3>These keys will refuse them until their owners allow it</h3>
              <ul>
                {{#each this.refusing as |entry|}}
                  <EntryItem @entry={{entry}} />
                {{/each}}
              </ul>
            </div>
          {{/if}}
          <footer>
            <p class='save-note' data-test-policy-audit-save-note>
              {{#if this.refusing.length}}
                Owners of keys that don't allow it yet will be asked to approve
                anonymous use. Until they do, those keys refuse people who
                aren't signed in.
              {{/if}}
              {{#if this.starting.length}}
                Keys that already allow it are used as soon as you save, and
                their owners are told.
              {{/if}}
            </p>
            <div class='buttons'>
              <BoxelButton
                data-test-policy-audit-cancel
                @size='tall'
                @kind='secondary-light'
                {{on 'click' this.cancel}}
              >
                Don't save
              </BoxelButton>
              <BoxelButton
                data-test-policy-audit-confirm
                @size='tall'
                @kind='primary'
                {{on 'click' (fn this.answer true)}}
              >
                Save
              </BoxelButton>
            </div>
          </footer>
        </section>
      </Modal>
    {{/if}}

    <style scoped>
      .policy-audit {
        padding: var(--boxel-sp-lg);
        background-color: var(--card, var(--background));
        color: var(--card-foreground, var(--foreground));
        border-radius: var(--boxel-border-radius-xl);
        box-shadow: var(--boxel-deep-box-shadow);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      h2 {
        margin: 0 0 var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-lg);
        line-height: var(--boxel-line-height-lg);
        font-weight: 600;
      }
      header p {
        margin: 0;
        line-height: 1.4;
      }
      .group {
        margin-top: var(--boxel-sp);
      }
      h3 {
        margin: 0 0 var(--boxel-sp-xxs);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        font-weight: 600;
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
      }
      footer {
        margin-top: var(--boxel-sp-lg);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: var(--boxel-sp-sm);
      }
      .save-note {
        flex: 1 1 16rem;
        margin: 0;
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
      }
      .buttons {
        display: flex;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}
