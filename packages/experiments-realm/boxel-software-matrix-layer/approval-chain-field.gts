import {
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  StringField,
} from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';
import NumberField from '@cardstack/base/number';

import { ApprovalStepField } from './approval-step-field';
import { daysBetween } from './utils/index';

// A pending step this many days or more past its predecessor's decision (or
// past the chain's start, for step 0) is flagged as a bottleneck in the
// stepper. Matches the spec's "surface a stuck approval" intent.
const BOTTLENECK_THRESHOLD_DAYS = 3;

function currentStepIndexOf(steps: ApprovalStepField[] | undefined): number {
  let list = steps ?? [];
  let idx = list.findIndex((s) => s?.decision === 'pending');
  return idx === -1 ? list.length : idx;
}

function statusOf(steps: ApprovalStepField[] | undefined): string {
  let list = (steps ?? []).filter(Boolean);
  if (!list.length) {
    return 'not-started';
  }
  if (list.some((s) => s.decision === 'rejected')) {
    return 'rejected';
  }
  if (list.every((s) => s.decision === 'approved')) {
    return 'approved';
  }
  return 'in-progress';
}

// Reusable sequential sign-off block. Renders as a linear stepper (an
// ordered list) rather than a tree — every step here has exactly one
// predecessor and one successor, which is a different shape from the
// manager-hierarchy forest components/org-tree.gts builds, so this does not
// reuse OrgNode/buildOrgTree.
//
// The embedded/isolated format here is READ-ONLY: it shows the sequence,
// each approver, decision pill, decided-at date, and a bottleneck badge on
// whichever step is currently pending. The actual approve/reject action is
// NOT performed via `@set` inside this field's own template: a FieldDef's
// embedded format has no first-class way to mutate one element of its own
// parent's `containsMany` array and then persist the OWNING card — every
// other mutation in this app (ApproveOfferCommand, RejectCandidateCommand,
// etc.) instead goes through a Command invoked from the CONSUMING card, not
// from inside the field's own template. So Position and Offer's own isolated
// templates render the click-to-decide buttons next to
// `<@fields.approvalChain />` and call ApproveChainStepCommand
// (commands/approve-chain-step-command.gts) rather than this field mutating
// itself.
export class ApprovalChainField extends FieldDef {
  static displayName = 'Approval Chain';

  @field steps = containsMany(ApprovalStepField);
  @field startedAt = contains(DateTimeField);

  @field currentStepIndex = contains(NumberField, {
    computeVia: function (this: ApprovalChainField) {
      return currentStepIndexOf(this.steps);
    },
  });

  @field status = contains(StringField, {
    computeVia: function (this: ApprovalChainField) {
      return statusOf(this.steps);
    },
  });

  static embedded = class Stepper extends Component<typeof this> {
    get statusLabel(): string {
      switch (this.args.model?.status) {
        case 'approved':
          return 'Fully approved';
        case 'rejected':
          return 'Rejected';
        case 'in-progress':
          return 'In progress';
        default:
          return 'Not started';
      }
    }

    isCurrentPendingIndex = (index: number): boolean => {
      let steps = this.args.model?.steps ?? [];
      let currentIndex = this.args.model?.currentStepIndex ?? steps.length;
      return index === currentIndex && steps[index]?.decision === 'pending';
    };

    pendingDaysFor = (index: number): number | undefined => {
      if (!this.isCurrentPendingIndex(index)) {
        return undefined;
      }
      let steps = this.args.model?.steps ?? [];
      let priorDecidedAt = index > 0 ? steps[index - 1]?.decidedAt : undefined;
      let since = priorDecidedAt ?? this.args.model?.startedAt;
      return daysBetween(since);
    };

    isBottleneckIndex = (index: number): boolean => {
      let days = this.pendingDaysFor(index);
      return days != null && days >= BOTTLENECK_THRESHOLD_DAYS;
    };

    <template>
      <div class='approval-chain'>
        <div class='chain-head'>
          <span class='chain-status'>{{this.statusLabel}}</span>
        </div>
        {{#if @model.steps.length}}
          <ol class='steps'>
            {{#each @fields.steps as |StepComponent index|}}
              <li
                class='step
                  {{if (this.isCurrentPendingIndex index) "current"}}'
              >
                <span class='step-index'>{{index}}</span>
                <div class='step-body'>
                  <StepComponent
                    @format='embedded'
                    @displayContainer={{false}}
                  />
                  {{#if (this.isBottleneckIndex index)}}
                    <span class='pill bottleneck'>pending
                      {{this.pendingDaysFor index}}
                      days · bottleneck</span>
                  {{/if}}
                </div>
              </li>
            {{/each}}
          </ol>
        {{else}}
          <p class='empty'>No approval chain configured — this record
            proceeds without a sign-off gate.</p>
        {{/if}}
      </div>
      <style scoped>
        .approval-chain {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        .chain-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .chain-status {
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
        }
        .steps {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .step {
          display: flex;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs) 0;
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .step:last-child {
          border-bottom: 0;
        }
        .step-index {
          flex: none;
          width: 1.25rem;
          height: 1.25rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        .step.current .step-index {
          background: var(--primary, var(--boxel-highlight));
          color: var(--primary-foreground, var(--boxel-light));
        }
        .step-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
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
          align-self: flex-start;
        }
        .pill.bottleneck {
          background: color-mix(
            in oklch,
            var(--boxel-warning) 12%,
            var(--card, var(--boxel-light))
          );
          color: color-mix(
            in oklch,
            var(--boxel-warning) 45%,
            var(--card-foreground, var(--boxel-dark))
          );
        }
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static isolated = ApprovalChainField.embedded;
}
