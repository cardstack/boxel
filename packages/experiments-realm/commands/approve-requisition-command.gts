import {
  CardDef,
  field,
  contains,
  linksTo,
  realmURL,
  StringField,
  BooleanField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import TextAreaField from '@cardstack/base/text-area';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { JobRequisition } from '../job-requisition';
import { Position } from '../position';
import { ApproveChainStepCommand } from './approve-chain-step-command';

class ApproveRequisitionInput extends CardDef {
  @field requisition = linksTo(() => JobRequisition, { searchable: true });
  @field stepIndex = contains(NumberField);
  @field decision = contains(StringField);
  @field comment = contains(StringField);
  @field createPosition = contains(BooleanField, {
    description:
      'Whether to create a Position when requisition is fully approved',
  });
  @field positionTitle = contains(StringField);
  @field positionDescription = contains(TextAreaField);
}

class ApproveRequisitionResult extends CardDef {
  @field message = contains(StringField);
  @field requisition = linksTo(() => JobRequisition);
  @field position = linksTo(() => Position);
}

export class ApproveRequisitionCommand extends Command<
  typeof ApproveRequisitionInput,
  typeof ApproveRequisitionResult
> {
  static actionVerb = 'Approve';
  static displayName = 'Approve Job Requisition';

  async getInputType() {
    return ApproveRequisitionInput;
  }

  protected async run(
    input: ApproveRequisitionInput,
  ): Promise<ApproveRequisitionResult> {
    let {
      requisition,
      stepIndex,
      decision,
      comment,
      createPosition,
      positionTitle,
      positionDescription,
    } = input;

    if (!requisition) {
      throw new Error('requisition is required');
    }

    if (stepIndex == null) {
      throw new Error('stepIndex is required');
    }

    // Delegate approval to ApproveChainStepCommand
    let approveStep = new ApproveChainStepCommand(this.commandContext);
    await approveStep.execute({
      target: requisition,
      stepIndex: stepIndex,
      decision: decision,
      comment: comment,
    } as any);

    // Check if the chain is now fully approved after this step
    let chain = requisition.approvalChain;
    let isFullyApproved = chain?.status === 'approved';

    let createdPosition: Position | undefined;

    // If fully approved and user chose to create a Position, do it
    if (isFullyApproved && createPosition) {
      let salary =
        requisition.salaryRangeMin && requisition.salaryRangeMax
          ? (requisition.salaryRangeMin + requisition.salaryRangeMax) / 2
          : (requisition.salaryRangeMin ?? requisition.salaryRangeMax);

      createdPosition = new Position({
        title: positionTitle || requisition.title || 'Unnamed Position',
        description: positionDescription || requisition.description,
        department: requisition.department,
        salary: salary,
        requisition: requisition,
      });
      let realm = requisition[realmURL]?.href;
      let saved = (await new SaveCardCommand(this.commandContext).execute({
        card: createdPosition,
        realm,
      } as any)) as Position;
      createdPosition = saved;
    }

    // Update requisition status to 'approved' after chain approval
    if (isFullyApproved) {
      requisition.status = 'approved';
      await new SaveCardCommand(this.commandContext).execute({
        card: requisition,
      });
    }

    return new ApproveRequisitionResult({
      message: `Requisition approval step processed. Status: ${requisition.status || 'pending'}`,
      requisition: requisition,
      position: createdPosition,
    });
  }
}
