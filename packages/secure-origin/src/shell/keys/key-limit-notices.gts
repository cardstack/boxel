// Where the user's shares and keys stand against their budgets this UTC day
// or month, as the key page shows it above the keys: one entry per share or
// key and period, newest first, for where it stands now. A
// budget used up comes first in weight: calls with that key are refused until
// the period ends. Nearing one is quieter.
//
// Each entry says what to do about it. The key's owner changes its limits:
// a personal key's on its own tile (`@onChangeKeyLimits`, which opens the
// tile's usage and limits), a share's on its own page (`@onOpenShareLimits`).
// A realm's other direct writers are told too, since a share in their realm
// stops serving its cards. They can't change its limits, so their entry opens
// the share's usage, which says who can.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { TOC } from '@ember/component/template-only';

import Button from '../../components/button.gts';
import type { KeyLimitNotice } from '../../security/keys.ts';

import { addressOf } from './workspace-dropdown.gts';

interface Signature {
  Args: {
    notices: KeyLimitNotice[];
    // Whether the page shows this personal key's limits to change.
    canChangeKeyLimits: (keyId: string) => boolean;
    onChangeKeyLimits: (keyId: string) => void;
    onOpenShareLimits: (notice: KeyLimitNotice) => void;
  };
}

// One entry per share or key and period: the newest, which says where it
// stands now. The notices come newest first.
function entries(notices: KeyLimitNotice[]): KeyLimitNotice[] {
  let shown = new Map<string, KeyLimitNotice>();
  for (let notice of notices) {
    let subject = `${notice.share ?? notice.key}|${notice.period}|${notice.periodEndsAt}`;
    if (!shown.has(subject)) {
      shown.set(subject, notice);
    }
  }
  return [...shown.values()];
}

function reached(notice: KeyLimitNotice): boolean {
  return notice.threshold === 'budget';
}

function periodly(notice: KeyLimitNotice): string {
  return notice.period === 'day' ? 'daily' : 'monthly';
}

const COUNT = new Intl.NumberFormat('en-US');

function calls(n: number): string {
  return `${COUNT.format(n)} ${n === 1 ? 'call' : 'calls'}`;
}

function resets(notice: KeyLimitNotice): string {
  let date = new Date(notice.periodEndsAt);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

const KeyLimitNotices: TOC<Signature> = <template>
  {{#let (entries @notices) as |shown|}}
    {{#if shown.length}}
      <section
        aria-labelledby='key-limit-notices-heading'
        data-test-key-limit-notices
      >
        <h2 id='key-limit-notices-heading'>Usage limits</h2>
        <ul>
          {{#each shown key='id' as |notice|}}
            <li
              class='notice {{if (reached notice) "reached" "nearing"}}'
              data-test-key-limit-notice={{notice.label}}
              data-test-key-limit-notice-threshold={{notice.threshold}}
            >
              <p class='summary'>
                <span class='badge'>
                  {{#if (reached notice)}}
                    Limit reached
                  {{else}}
                    Nearing limit
                  {{/if}}
                </span>
                {{#if notice.realm}}
                  {{#if notice.yours}}
                    <strong>“{{notice.label}}”</strong>, your key shared with
                  {{else}}
                    <strong>“{{notice.label}}”</strong>
                    in
                  {{/if}}
                  <strong>{{addressOf notice.realm}}</strong>,
                {{else}}
                  Your key
                  <strong>“{{notice.label}}”</strong>
                {{/if}}
                {{#if (reached notice)}}
                  used its whole
                  {{periodly notice}}
                  budget of
                  {{calls notice.budget}}.
                {{else}}
                  is close to its
                  {{periodly notice}}
                  budget of
                  {{calls notice.budget}}.
                {{/if}}
              </p>
              <p class='explain' data-test-key-limit-notice-explain>
                {{#if (reached notice)}}
                  {{#if notice.realm}}
                    Cards there can’t use it until
                    {{resets notice}}.
                  {{else}}
                    Calls with it are refused until
                    {{resets notice}}.
                  {{/if}}
                {{else}}
                  Its count starts over
                  {{resets notice}}.
                {{/if}}
                {{#if notice.yours}}
                  Raise the budget to keep it working, or leave it as it is.
                {{else}}
                  Only the key’s owner can change its limits.
                {{/if}}
              </p>
              <div class='actions'>
                {{#if notice.yours}}
                  {{#if notice.realm}}
                    <Button
                      @kind='primary'
                      @size='small'
                      data-test-key-limit-notice-change
                      {{on 'click' (fn @onOpenShareLimits notice)}}
                    >Change limits…</Button>
                  {{else if (if notice.key (@canChangeKeyLimits notice.key))}}
                    <Button
                      @kind='primary'
                      @size='small'
                      data-test-key-limit-notice-change
                      {{on 'click' (fn @onChangeKeyLimits notice.key)}}
                    >Change limits…</Button>
                  {{/if}}
                {{else}}
                  <Button
                    @kind='secondary'
                    @size='small'
                    data-test-key-limit-notice-usage
                    {{on 'click' (fn @onOpenShareLimits notice)}}
                  >See usage…</Button>
                {{/if}}
              </div>
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
    .notice {
      padding: var(--boxel-sp-sm);
      border: 1px solid var(--border);
      border-left-width: 4px;
      border-radius: var(--boxel-border-radius);
    }
    .reached {
      border-color: var(--warning);
      background-color: color-mix(in oklab, var(--warning) 10%, var(--card));
    }
    .nearing {
      border-left-color: var(--muted-foreground);
    }
    .summary {
      line-height: var(--boxel-line-height-sm);
      overflow-wrap: anywhere;
    }
    .badge {
      display: inline-block;
      margin-right: var(--boxel-sp-4xs);
      padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
      border-radius: var(--boxel-border-radius-sm);
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      vertical-align: 1px;
    }
    .reached .badge {
      background-color: var(--warning);
      color: var(--warning-foreground);
    }
    .nearing .badge {
      background-color: var(--muted);
      color: var(--foreground);
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
  </style>
</template>;

export default KeyLimitNotices;
