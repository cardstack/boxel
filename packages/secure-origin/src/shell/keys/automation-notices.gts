// The automation runs that didn't start for want of something the user fixes
// here, as the key page shows them above the keys: one entry per automation
// and operation, newest first. Admission checks every operation an
// automation's card declares before a run that acts as the user costs
// anything, and refuses the run when one of them would be refused.
//
// An operation the user hasn't approved for automations offers Approve…, and
// one whose request changed since they approved it offers Review changes…:
// each opens the approve page for that operation, which comes back to this
// page when it is done. A suspended share and a key the vendor refused are
// fixed elsewhere (the share by a direct writer of its workspace or its key's
// owner, the key on its own tile below), so they only say so.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { TOC } from '@ember/component/template-only';

import { Alert } from '@cardstack/pretui/components/alert';
import { Button } from '@cardstack/pretui/components/button';
import { StatusChip } from '@cardstack/pretui/components/status-chip';

import type { AutomationNotice } from '../../security/keys.ts';

import { addressOf } from './workspaces.ts';

interface Signature {
  Args: {
    notices: AutomationNotice[];
    onOpenApproval: (notice: AutomationNotice) => void;
  };
}

// One entry per automation, reason and operation: the newest. The notices
// come newest first.
function entries(notices: AutomationNotice[]): AutomationNotice[] {
  let shown = new Map<string, AutomationNotice>();
  for (let notice of notices) {
    let subject = `${notice.automationId}|${notice.reason}|${notice.operation ?? ''}`;
    if (!shown.has(subject)) {
      shown.set(subject, notice);
    }
  }
  return [...shown.values()];
}

// The automation card's own name: the last part of its address.
function automationName(notice: AutomationNotice): string {
  let parts = notice.automationId.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || notice.automationId;
}

function is(notice: AutomationNotice, reason: AutomationNotice['reason']) {
  return notice.reason === reason;
}

function approvable(notice: AutomationNotice): boolean {
  return (
    !!notice.operation &&
    !!notice.targetType &&
    (notice.reason === 'binding-not-approved' ||
      notice.reason === 'binding-needs-reapproval')
  );
}

const AutomationNotices: TOC<Signature> = <template>
  {{#let (entries @notices) as |shown|}}
    {{#if shown.length}}
      <section
        aria-labelledby='automation-notices-heading'
        data-test-automation-notices
      >
        <h2 id='automation-notices-heading'>Automations</h2>
        <ul>
          {{#each shown key='id' as |notice|}}
            <li
              data-test-automation-notice={{automationName notice}}
              data-test-automation-notice-reason={{notice.reason}}
            >
              <Alert @tone='warning' role='note'>
                <:default>
                  <p class='summary'>
                    <StatusChip
                      class='badge'
                      @value='Run didn’t start'
                      @tone='warning'
                      @appearance='soft'
                      @dot={{false}}
                    />
                    The automation
                    <strong>“{{automationName notice}}”</strong>
                    in
                    <strong>{{addressOf notice.realm}}</strong>
                    didn’t start a run:
                    {{#if (is notice 'binding-not-approved')}}
                      the operation
                      <strong>“{{notice.operation}}”</strong>
                      isn’t approved for automations.
                    {{else if (is notice 'binding-needs-reapproval')}}
                      the request the operation
                      <strong>“{{notice.operation}}”</strong>
                      sends changed since you approved the operation.
                    {{else if (is notice 'share-suspended')}}
                      the workspace’s share that the operation
                      <strong>“{{notice.operation}}”</strong>
                      uses is suspended.
                    {{else}}
                      the service refused the key that the operation
                      <strong>“{{notice.operation}}”</strong>
                      uses.
                    {{/if}}
                  </p>
                  <p class='explain' data-test-automation-notice-explain>
                    {{#if (is notice 'binding-not-approved')}}
                      Approve the operation, and the automation’s next run goes
                      ahead.
                    {{else if (is notice 'binding-needs-reapproval')}}
                      Review the changes and approve the operation again, and
                      the automation’s next run goes ahead.
                    {{else if (is notice 'share-suspended')}}
                      A direct writer of the workspace resumes the share, or the
                      key’s owner swaps another key into the share.
                    {{else}}
                      Reconnect or replace the key on the key’s tile below, and
                      the automation’s next run goes ahead.
                    {{/if}}
                  </p>
                </:default>
                <:action>
                  {{#if (approvable notice)}}
                    <div class='actions'>
                      <Button
                        @variant='primary'
                        @size='s'
                        data-test-automation-notice-approve
                        {{on 'click' (fn @onOpenApproval notice)}}
                      >
                        {{#if (is notice 'binding-needs-reapproval')}}
                          Review changes…
                        {{else}}
                          Approve…
                        {{/if}}
                      </Button>
                    </div>
                  {{/if}}
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

export default AutomationNotices;
