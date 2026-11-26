// Automations that wait for key approval on the user, as the key page shows
// them above the keys, newest first. A switched-on automation waits until the
// owner of each key the automation sends approves the automation's use of the
// key, so each entry asks the user for something:
//
// - **Approval needed**: the user's key serves operations the automation
//   declares. Review and approve… opens the `approve` page for the automation
//   (`@onApprove`), which gathers every operation the user's approval is
//   missing for, in one confirmation.
// - **Key needed**: no share in the automation's workspace has a key for an
//   operation, and the user, a realm administrator there, can share one.
//   Share a key… opens the `share-key` page for the workspace (`@onShareKey`);
//   once the key is shared, the entry asks the user to approve the
//   automation's use of the key.
//
// Each entry names the automation, its workspace and each operation it asks
// about with where the operation sends. The automation's title is whatever a
// realm writer typed, so it and the workspace address are isolated (`<bdi>`)
// rather than let a right-to-left or bidi-override title reorder the sentence
// around them. An entry ends once the approval lands,
// the operation leaves the automation's card, or the automation stops
// waiting.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { TOC } from '@ember/component/template-only';

import { Alert } from '@cardstack/pretui/components/alert';
import { Button } from '@cardstack/pretui/components/button';
import { StatusChip } from '@cardstack/pretui/components/status-chip';

import type {
  KeyApprovalNotice,
  KeyApprovalNoticeOperation,
} from '../../security/keys.ts';

import { addressOf } from './workspaces.ts';

interface Signature {
  Args: {
    notices: KeyApprovalNotice[];
    onApprove: (notice: KeyApprovalNotice) => void;
    onShareKey: (notice: KeyApprovalNotice) => void;
  };
}

interface Entry {
  notice: KeyApprovalNotice;
  ask: KeyApprovalNoticeOperation['ask'];
  operations: KeyApprovalNoticeOperation[];
}

// One entry per notice and ask: a key needed comes after the approval, since
// sharing a key leads to an approval of its own.
function entries(notices: KeyApprovalNotice[]): Entry[] {
  let shown: Entry[] = [];
  for (let notice of notices) {
    for (let ask of ['approve', 'share-a-key'] as const) {
      let operations = notice.operations.filter((o) => o.ask === ask);
      if (operations.length) {
        shown.push({ notice, ask, operations });
      }
    }
  }
  return shown;
}

function approving(entry: Entry): boolean {
  return entry.ask === 'approve';
}

// The automation as the entry names it: the card's title, or else the last
// part of the card's address.
function automationName(notice: KeyApprovalNotice): string {
  if (notice.title) {
    return notice.title;
  }
  let path = notice.automation.replace(/\/+$/, '');
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)) || path;
}

const KeyApprovalNotices: TOC<Signature> = <template>
  {{#let (entries @notices) as |shown|}}
    {{#if shown.length}}
      <section
        aria-labelledby='key-approval-notices-heading'
        data-test-key-approval-notices
      >
        <h2 id='key-approval-notices-heading'>Automations waiting on you</h2>
        <ul>
          {{#each shown as |entry|}}
            <li
              data-test-key-approval-notice={{automationName entry.notice}}
              data-test-key-approval-notice-ask={{entry.ask}}
            >
              <Alert @tone='warning' role='note'>
                <:default>
                  <p class='summary'>
                    <StatusChip
                      class='badge'
                      @value={{if
                        (approving entry)
                        'Approval needed'
                        'Key needed'
                      }}
                      @tone='warning'
                      @appearance='soft'
                      @dot={{false}}
                    />
                    The automation
                    <strong>“<bdi>{{automationName
                          entry.notice
                        }}</bdi>”</strong>
                    in
                    <strong><bdi>{{addressOf entry.notice.realm}}</bdi></strong>
                    {{#if (approving entry)}}
                      waits for your approval to use your key.
                    {{else}}
                      needs a key that is not currently shared in the workspace.
                    {{/if}}
                  </p>
                  <ul
                    class='operations'
                    data-test-key-approval-notice-operations
                  >
                    {{#each entry.operations as |operation|}}
                      <li
                        data-test-key-approval-notice-operation={{operation.operation}}
                      >
                        <code>{{operation.operation}}</code>
                        sends to
                        <span
                          class='destination'
                        >{{operation.destination}}</span>
                      </li>
                    {{/each}}
                  </ul>
                  <p class='explain' data-test-key-approval-notice-explain>
                    {{#if (approving entry)}}
                      The automation waits until each key owner approves the
                      automation’s use of the key.
                    {{else}}
                      Share a key with the workspace, then approve the
                      automation’s use of the key.
                    {{/if}}
                  </p>
                </:default>
                <:action>
                  <div class='actions'>
                    {{#if (approving entry)}}
                      <Button
                        @variant='primary'
                        @size='s'
                        data-test-key-approval-notice-approve
                        {{on 'click' (fn @onApprove entry.notice)}}
                      >Review and approve…</Button>
                    {{else}}
                      <Button
                        @variant='primary'
                        @size='s'
                        data-test-key-approval-notice-share
                        {{on 'click' (fn @onShareKey entry.notice)}}
                      >Share a key…</Button>
                    {{/if}}
                  </div>
                </:action>
              </Alert>
            </li>
          {{/each}}
        </ul>
      </section>
    {{/if}}
  {{/let}}
  <style scoped>
    section {
      margin-bottom: var(--boxel-sp-lg);
    }
    h2 {
      margin: 0 0 var(--boxel-sp-xs);
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
      font-weight: 600;
    }
    ul {
      display: flex;
      flex-direction: column;
      gap: var(--boxel-sp-xs);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    p {
      margin: 0;
    }
    .summary {
      line-height: var(--boxel-line-height-sm);
      overflow-wrap: anywhere;
    }
    .badge {
      margin-right: var(--boxel-sp-4xs);
    }
    .operations {
      gap: var(--boxel-sp-5xs);
      margin-top: var(--boxel-sp-xs);
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      overflow-wrap: anywhere;
    }
    .destination {
      font-family: var(--boxel-monospace-font-family);
    }
    .explain {
      margin-top: var(--boxel-sp-4xs);
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--boxel-sp-xs);
      margin-top: var(--boxel-sp-xs);
    }
  </style>
</template>;

export default KeyApprovalNotices;
