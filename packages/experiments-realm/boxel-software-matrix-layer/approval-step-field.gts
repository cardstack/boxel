import {
  FieldDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';
import TextAreaField from '@cardstack/base/text-area';
import enumField from '@cardstack/base/enum';
import { htmlSafe } from '@ember/template';

import { Employee } from './employee';
import { stateColor, stateColorOf, type StateColor } from './utils/index';

export const APPROVAL_DECISIONS = ['pending', 'approved', 'rejected'];

export const APPROVAL_DECISION_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

// Colocated with ApprovalStepField — the same map colors the decision pill
// wherever a chain step renders (ApprovalStepField's own embedded format,
// used by ApprovalChainField's stepper). Amber for the undecided middle
// state, green for a forward decision, red for a stop — the same polarity
// CANDIDATE_STAGE_COLORS and RECOMMENDATION_COLORS already use for
// hired/rejected and hire/no-hire.
export const APPROVAL_DECISION_COLORS: Record<string, StateColor> = {
  pending: stateColor('amber'),
  approved: stateColor('green'),
  rejected: stateColor('red'),
};

export const ApprovalDecisionField = enumField(StringField, {
  options: APPROVAL_DECISIONS.map((value) => ({
    value,
    label: APPROVAL_DECISION_LABELS[value],
  })),
  displayName: 'Approval Decision',
});

// One seat in an ApprovalChainField — who needs to sign off, what they
// decided, when, and why. See approval-chain-field.gts for the sequencing
// logic (currentStepIndex/status) built on top of a list of these.
export class ApprovalStepField extends FieldDef {
  static displayName = 'Approval Step';

  @field approver = linksTo(() => Employee);
  @field decision = contains(ApprovalDecisionField);
  @field decidedAt = contains(DateTimeField);
  @field comment = contains(TextAreaField);

  static embedded = class Embedded extends Component<typeof this> {
    get pillStyle() {
      let c = stateColorOf(APPROVAL_DECISION_COLORS, this.args.model?.decision);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    <template>
      <div class='approval-step-row'>
        <div class='row-top'>
          {{#if @model.approver}}
            <@fields.approver @format='atom' @displayContainer={{false}} />
          {{else}}
            <span class='row-empty'>No approver set</span>
          {{/if}}
          <span class='pill' style={{this.pillStyle}}>
            <span class='pill-dot'></span>{{@model.decision}}
          </span>
        </div>
        {{#if @model.decidedAt}}
          <span class='row-date'>decided <@fields.decidedAt /></span>
        {{/if}}
        {{#if @model.comment}}
          <p class='row-comment'>{{@model.comment}}</p>
        {{/if}}
      </div>
      <style scoped>
        .approval-step-row {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .row-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        .row-empty {
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .row-date {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .row-comment {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          line-height: 1.5;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          padding: 0.18em 0.5em;
          border-radius: 3px;
          white-space: nowrap;
          flex: none;
        }
        .pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
      </style>
    </template>
  };
}
