// The notices a key's owner is owed when a workspace's policy comes to let
// people who aren’t signed in make calls with one of their shares there, as
// the key page lists them above the keys, newest first.
//
// For a key that allows it, the notice says visitors now use it in that
// workspace. For one that doesn’t, it says the workspace wants visitors to use
// it, and offers to allow it for the key (`@onAllow`), which opens the key's
// own setting with its optional cap. Once the key allows it, that notice is
// settled and no longer shown. One whose key has since been deleted is shown
// and offers nothing more.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { TOC } from '@ember/component/template-only';

import Button from '../../components/button.gts';
import { eq } from '../../helpers/truth-helpers.ts';
import type { KeyPolicyNotice } from '../../security/keys.ts';

import type { ListedKey } from './context.ts';
import { addressOf } from './workspace-dropdown.gts';

interface Signature {
  Args: {
    notices: KeyPolicyNotice[];
    keys: ListedKey[];
    onAllow: (key: ListedKey) => void;
  };
}

// The operation's class and name: its module is the workspace's own.
function operationLabel(operation: string): string {
  let hash = operation.lastIndexOf('#');
  return hash === -1 ? operation : operation.slice(hash + 1);
}

function when(createdAt: string): string {
  let date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

// The key a notice can still offer to allow: one of the user's, still there,
// that doesn’t allow it yet.
function allowable(
  notice: KeyPolicyNotice,
  keys: ListedKey[],
): ListedKey | undefined {
  if (notice.reason !== 'visitors-wanted' || !notice.key) {
    return undefined;
  }
  let key = keys.find((candidate) => candidate.id === notice.key);
  return key && !key.anonymous ? key : undefined;
}

// The notices still worth showing. One saying a workspace wants visitors to
// use a key is settled once the key allows them, so it is left out then; one
// saying visitors use a key stays, as the record of where they do.
function shownNotices(
  notices: KeyPolicyNotice[],
  keys: ListedKey[],
): KeyPolicyNotice[] {
  return notices.filter(
    (notice) =>
      notice.reason !== 'visitors-wanted' ||
      !keys.find((key) => key.id === notice.key)?.anonymous,
  );
}

const KeyPolicyNotices: TOC<Signature> = <template>
  {{#let (shownNotices @notices @keys) as |shown|}}
    {{#if shown.length}}
      <section class='notices' data-test-key-policy-notices>
        <h2>Workspaces opening your keys to people who aren’t signed in</h2>
        <ul>
          {{#each shown key='id' as |notice|}}
            <li
              class='notice'
              data-test-key-policy-notice={{notice.label}}
              data-test-key-policy-notice-reason={{notice.reason}}
            >
              <p class='summary'>
                {{#if (eq notice.reason 'visitors-use')}}
                  People who aren’t signed in now use
                  <strong>“{{notice.label}}”</strong>
                  in
                  {{addressOf notice.realm}}.
                {{else}}
                  {{addressOf notice.realm}}
                  wants people who aren’t signed in to use
                  <strong>“{{notice.label}}”</strong>. The key doesn’t allow it,
                  so they are refused until you allow it.
                {{/if}}
              </p>
              <p class='detail'>
                {{#each notice.operations as |operation|}}
                  <code>{{operationLabel operation}}</code>
                {{/each}}
                {{#if notice.savedBy}}
                  <span>· policy saved by {{notice.savedBy}}</span>
                {{/if}}
                <span>· {{when notice.createdAt}}</span>
              </p>
              {{#let (allowable notice @keys) as |key|}}
                {{#if key}}
                  <Button
                    @kind='secondary'
                    @size='extra-small'
                    data-test-key-policy-notice-allow
                    {{on 'click' (fn @onAllow key)}}
                  >Allow for this key…</Button>
                {{/if}}
              {{/let}}
            </li>
          {{/each}}
        </ul>
      </section>
    {{/if}}
  {{/let}}
  <style scoped>
    .notices {
      margin-bottom: var(--boxel-sp-lg);
    }
    h2 {
      margin: 0 0 var(--boxel-sp-xs);
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
    .notice {
      padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
    }
    .notice + .notice {
      border-top: 1px solid var(--border);
    }
    .summary {
      margin: 0;
      line-height: var(--boxel-line-height-sm);
    }
    .detail {
      display: flex;
      flex-wrap: wrap;
      gap: var(--boxel-sp-4xs);
      margin: var(--boxel-sp-4xs) 0 var(--boxel-sp-xs);
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      color: var(--muted-foreground);
    }
    code {
      background: var(--muted);
      padding: 0 var(--boxel-sp-4xs);
      border-radius: var(--boxel-border-radius-xs);
    }
  </style>
</template>;

export default KeyPolicyNotices;
