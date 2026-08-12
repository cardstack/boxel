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

import { JobRequisition } from '../job-requisition';

class FillRequisitionInput extends CardDef {
  @field requisition = linksTo(() => JobRequisition, { searchable: true });
  @field filledCount = contains(NumberField, {
    description: 'Number of positions filled',
  });
}

class FillRequisitionResult extends CardDef {
  @field message = contains(StringField);
  @field requisition = linksTo(() => JobRequisition);
}

export class FillRequisitionCommand extends Command<
  typeof FillRequisitionInput,
  typeof FillRequisitionResult
> {
  static actionVerb = 'Fill';
  static displayName = 'Fill Job Requisition';

  async getInputType() {
    return FillRequisitionInput;
  }

  protected async run(
    input: FillRequisitionInput,
  ): Promise<FillRequisitionResult> {
    let { requisition, filledCount } = input;

    if (!requisition) {
      throw new Error('requisition is required');
    }

    if (filledCount == null) {
      throw new Error('filledCount is required');
    }

    let headcount = requisition.headcount ?? 0;
    if (filledCount < 0 || filledCount > headcount) {
      throw new Error(
        `filledCount must be between 0 and headcount (${headcount}); got ${filledCount}`,
      );
    }

    let currentStatus = requisition.status;
    if (currentStatus !== 'posted' && currentStatus !== 'approved') {
      throw new Error(
        `Requisition must be in "posted" or "approved" status to be filled (current status: ${
          currentStatus ?? 'draft'
        })`,
      );
    }

    // Mark as filled if all positions are filled
    if (filledCount >= headcount) {
      requisition.status = 'filled';
      requisition.filledDate = new Date();
    }

    await new SaveCardCommand(this.commandContext).execute({
      card: requisition,
    });

    return new FillRequisitionResult({
      message: `Requisition updated: ${filledCount}/${headcount} positions filled. Status: ${
        requisition.status
      }`,
      requisition: requisition,
    });
  }
}
