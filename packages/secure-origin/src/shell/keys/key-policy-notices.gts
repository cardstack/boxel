// The notices a key's owner is owed when a workspace's policy comes to let
// people who aren’t signed in make calls with one of their shares there, as
// the key page lists them above the keys, newest first.
//
// For a key that allows it, the notice says visitors now use it in that
// workspace. For one that doesn’t, it says the workspace wants visitors to use
// it, and offers to allow it for the key (`@onAllow`), which opens the key's
// own setting with its optional cap. A notice whose key has since been deleted
// or allowed offers nothing more.
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

const KeyPolicyNotices: TOC<Signature> = <template>
  {{#if @notices.length}}
    <section class='notices' data-test-key-policy-notices>
      <h2>Workspaces opening your keys to people who aren’t signed in</h2>
      <ul>
        {{#each @notices key='id' as |notice|}}
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
  <style scoped>
    .notices {
      margin-bottom: var(--boxel-sp-lg, 20px);
    }
    h2 {
      margin: 0 0 var(--boxel-sp-xs, 10px);
      font-size: 0.875rem;
      font-weight: 600;
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      border: 1px solid var(--border, #e8e8e8);
      border-radius: 8px;
    }
    .notice {
      padding: 10px 14px;
    }
    .notice + .notice {
      border-top: 1px solid var(--border, #e8e8e8);
    }
    .summary {
      margin: 0;
      line-height: 1.4;
    }
    .detail {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 4px 0 8px;
      font-size: 0.75rem;
      color: var(--muted-foreground, #5f5f5f);
    }
    code {
      background: var(--muted, #f2f2f2);
      padding: 0 4px;
      border-radius: 4px;
    }
  </style>
</template>;

export default KeyPolicyNotices;
