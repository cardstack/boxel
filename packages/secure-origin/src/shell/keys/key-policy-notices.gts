// What workspaces' policies have done with the user's shared keys, as the key
// page shows it above the keys, newest first, in two parts.
//
// Requests come first and ask for an answer: a workspace whose policy lets
// people who aren’t signed in make calls with one of the user's shares wants
// them to use a key that doesn’t allow it. Each request offers to allow
// anonymous use for the key (`@onAllow`, which opens the key's own setting
// with its optional cap) or to decline (`@onDecline`). A request is settled,
// and no longer shown, once the key allows it or the user declines it. One
// whose key has since been deleted is settled too.
//
// Below them, quieter, is where visitors already use one of the user's keys
// that allows it: nothing to answer, a record of where the key is used.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { TOC } from '@ember/component/template-only';

import { Alert } from '@cardstack/pretui/components/alert';
import { StatusChip } from '@cardstack/pretui/components/status-chip';

import { Button } from '@cardstack/pretui/components/button';
import type { KeyPolicyNotice } from '../../security/keys.ts';

import type { ListedKey } from './context.ts';
import { addressOf } from './workspace-dropdown.gts';

interface Signature {
  Args: {
    notices: KeyPolicyNotice[];
    keys: ListedKey[];
    onAllow: (key: ListedKey) => void;
    onDecline: (notice: KeyPolicyNotice) => void;
    // The request being declined, while the request is under way.
    declining?: string;
  };
}

interface OpenRequest {
  notice: KeyPolicyNotice;
  key: ListedKey;
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

// The requests still waiting on an answer, each with the key it asks about:
// one of the user's keys, still there, that doesn’t allow it yet, and not
// declined.
function openRequests(
  notices: KeyPolicyNotice[],
  keys: ListedKey[],
): OpenRequest[] {
  let requests: OpenRequest[] = [];
  for (let notice of notices) {
    if (notice.reason !== 'visitors-wanted' || notice.declinedAt) {
      continue;
    }
    let key = keys.find((candidate) => candidate.id === notice.key);
    if (key && !key.anonymous) {
      requests.push({ notice, key });
    }
  }
  return requests;
}

function visitorsUse(notices: KeyPolicyNotice[]): KeyPolicyNotice[] {
  return notices.filter((notice) => notice.reason === 'visitors-use');
}

function isOne(requests: OpenRequest[]): boolean {
  return requests.length === 1;
}

function isDeclining(declining: string | undefined, id: string): boolean {
  return declining === id;
}

const Operations: TOC<{ Args: { notice: KeyPolicyNotice } }> = <template>
  <p class='detail'>
    {{#each @notice.operations as |operation|}}
      <code>{{operationLabel operation}}</code>
    {{/each}}
    {{#if @notice.savedBy}}
      <span>· policy saved by {{@notice.savedBy}}</span>
    {{/if}}
    <span>· {{when @notice.createdAt}}</span>
  </p>
  <style scoped>
    .detail {
      display: flex;
      flex-wrap: wrap;
      gap: var(--boxel-sp-4xs);
      margin: var(--boxel-sp-4xs) 0 0;
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

const KeyPolicyNotices: TOC<Signature> = <template>
  {{#let (openRequests @notices @keys) as |requests|}}
    {{#if requests.length}}
      <section
        class='requests'
        aria-labelledby='key-policy-requests-heading'
        data-test-key-policy-requests
      >
        <h2 id='key-policy-requests-heading'>
          <StatusChip
            @value='Action needed'
            @tone='warning'
            @appearance='soft'
            @dot={{false}}
          />
          {{#if (isOne requests)}}
            A workspace is asking to let people who aren’t signed in use one of
            your keys
          {{else}}
            Workspaces are asking to let people who aren’t signed in use your
            keys
          {{/if}}
        </h2>
        <ul>
          {{#each requests key='notice.id' as |request|}}
            <li
              data-test-key-policy-notice={{request.notice.label}}
              data-test-key-policy-notice-reason='visitors-wanted'
            >
              <Alert @tone='warning' role='note'>
                <p class='summary'>
                  <strong>{{addressOf request.notice.realm}}</strong>
                  wants people who aren’t signed in to use your key
                  <strong>“{{request.notice.label}}”</strong>
                  ({{request.key.name}}).
                </p>
                <p class='explain'>
                  They are refused until you allow it. Allowing it lets anyone
                  who opens that workspace’s cards make these calls with your
                  key, up to the daily cap you set.
                </p>
                <Operations @notice={{request.notice}} />
                <div class='actions'>
                  <Button
                    @variant='primary'
                    @size='s'
                    data-test-key-policy-notice-allow
                    {{on 'click' (fn @onAllow request.key)}}
                  >Allow anonymous use…</Button>
                  <Button
                    @variant='secondary'
                    @size='s'
                    @loading={{isDeclining @declining request.notice.id}}
                    data-test-key-policy-notice-decline
                    {{on 'click' (fn @onDecline request.notice)}}
                  >Decline</Button>
                </div>
              </Alert>
            </li>
          {{/each}}
        </ul>
      </section>
    {{/if}}
  {{/let}}
  {{#let (visitorsUse @notices) as |used|}}
    {{#if used.length}}
      <section class='used' data-test-key-policy-notices>
        <h2>Where people who aren’t signed in use your keys</h2>
        <ul>
          {{#each used key='id' as |notice|}}
            <li
              class='notice'
              data-test-key-policy-notice={{notice.label}}
              data-test-key-policy-notice-reason='visitors-use'
            >
              <p class='summary'>
                People who aren’t signed in now use
                <strong>“{{notice.label}}”</strong>
                in
                {{addressOf notice.realm}}.
              </p>
              <Operations @notice={{notice}} />
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
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--boxel-sp-xs);
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
      margin-top: var(--boxel-sp-sm);
    }
    .used ul {
      gap: 0;
      border: 1px solid var(--border);
      border-radius: var(--boxel-border-radius);
    }
    .notice {
      padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
    }
    .notice + .notice {
      border-top: 1px solid var(--border);
    }
  </style>
</template>;

export default KeyPolicyNotices;
