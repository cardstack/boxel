import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { ApprovalDecisionField } from '../approval-step-field';

class ApproveChainStepInput extends CardDef {
  // Position or Offer — whichever card owns the `approvalChain` field being
  // decided on. Typed as CardDef rather than a union so this command works
  // against either consumer without importing both (Offer already imports
  // Position, so importing Position here too risks a cycle through offer.gts).
  @field target = linksTo(() => CardDef, { searchable: true });
  @field stepIndex = contains(NumberField);
  @field decision = contains(ApprovalDecisionField);
  @field comment = contains(StringField);
}

class ApproveChainStepResult extends CardDef {
  @field message = contains(StringField);
}

export class ApproveChainStepCommand extends Command<
  typeof ApproveChainStepInput,
  typeof ApproveChainStepResult
> {
  static actionVerb = 'Decide';
  static displayName = 'Approve/Reject Chain Step';

  async getInputType() {
    return ApproveChainStepInput;
  }

  protected async run(
    input: ApproveChainStepInput,
  ): Promise<ApproveChainStepResult> {
    let { target, stepIndex, decision, comment } = input;
    if (!target) {
      throw new Error('target is required');
    }
    if (stepIndex == null) {
      throw new Error('stepIndex is required');
    }
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new Error(
        `decision must be "approved" or "rejected" (got: ${decision ?? 'none'})`,
      );
    }
    let chain = (target as any).approvalChain;
    if (!chain) {
      throw new Error('target has no approvalChain to decide on');
    }
    let steps = chain.steps ?? [];
    let step = steps[stepIndex];
    if (!step) {
      throw new Error(`No approval step at index ${stepIndex}`);
    }
    // Out-of-order attempts are refused: a step can only be decided once it
    // is the chain's current pending step. This keeps the sequence honest —
    // approving step 2 while step 0 still sits pending would silently skip
    // the earlier approver's sign-off.
    if (chain.currentStepIndex !== stepIndex) {
      throw new Error(
        `Step ${stepIndex} is not the current step (current step is ${chain.currentStepIndex}); steps must be decided in order`,
      );
    }
    step.decision = decision;
    step.decidedAt = new Date();
    if (comment != null) {
      step.comment = comment;
    }
    await new SaveCardCommand(this.commandContext).execute({
      card: target,
    } as any);

    return new ApproveChainStepResult({
      message: `Step ${stepIndex} ${decision}.`,
    });
  }
}
