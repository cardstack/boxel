import {
  FieldDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';
import NumberField from '@cardstack/base/number';
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

  // ---- Added for contract execution (app5) --------------------------------
  // Additive only: every field below is optional, so instances written before
  // this extension deserialize unchanged and every existing consumer
  // (approval-chain-field, offer.gts, position.gts, approve-chain-step-command)
  // keeps working without edits.

  /**
   * Reassignment target. Presence IS the delegated state — there is
   * deliberately no `delegated` value added to ApprovalDecisionField, because a
   * delegated step is still undecided, and widening a stored enum would force
   * every existing consumer's switch to grow a case.
   */
  @field delegatedTo = linksTo(() => Employee);

  /**
   * When this step became the current one.
   *
   * The chain can already infer a wait from the previous step's `decidedAt`,
   * but that breaks for step 0 and for any chain regenerated mid-flight.
   * Recording it explicitly is what lets a queue sort by longest-waiting rather
   * than by arrival order.
   */
  @field openedAt = contains(DateTimeField);

  /**
   * Why the step is paused. Presence means on-hold, for the same reason
   * `delegatedTo` means delegated: a reason is more useful than a flag, and it
   * cannot be set without saying why.
   */
  @field holdReason = contains(StringField);

  /**
   * Approve-with-conditions: "approved IF the liability cap is changed to 2x".
   *
   * Stored as its own field rather than folded into `comment`, because a
   * condition is a commitment the next reader must act on, whereas a comment is
   * commentary. Collapsing them means a condition can be scrolled past.
   */
  @field conditions = contains(TextAreaField);

  /**
   * Days this step has been open and undecided.
   *
   * CAVEAT, stated because it is easy to misuse: this reads the wall clock, so
   * the value stored in the index is only as fresh as the last reindex. It is
   * correct for display and for sorting a freshly-loaded queue; it must NOT be
   * used as a query filter, where a stale index would silently under-report.
   */
  @field waitingDays = contains(NumberField, {
    computeVia: function (this: ApprovalStepField) {
      if (this.decidedAt || !this.openedAt) return undefined;
      let opened = new Date(this.openedAt).getTime();
      if (!Number.isFinite(opened)) return undefined;
      return Math.max(0, Math.floor((Date.now() - opened) / 86_400_000));
    },
  });

  /**
   * The step's state as a consumer should read it, resolving the three
   * presence-flags above against the stored decision.
   *
   * Named `stepState` rather than `state` on purpose: `state` is a generic
   * enough name that Offer, Position or a future consumer could reasonably want
   * it for something else, and a shared field should not claim it.
   */
  @field stepState = contains(StringField, {
    computeVia: function (this: ApprovalStepField) {
      // A conditional approval is NOT a plain approval: something still has to
      // change before the contract is safe to sign, and reporting it as
      // 'approved' is how that condition gets lost.
      if (this.decision === 'approved' && this.conditions)
        return 'approved_with_conditions';
      if (this.decision === 'approved') return 'approved';
      if (this.decision === 'rejected') return 'rejected';
      if (this.holdReason) return 'on_hold';
      if (this.delegatedTo) return 'delegated';
      if (this.openedAt) return 'in_review';
      return 'pending';
    },
  });

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
