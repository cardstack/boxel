import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { Candidate } from '../candidate';

class RejectCandidateInput extends CardDef {
  @field candidate = linksTo(() => Candidate, { searchable: true });
  @field reason = contains(StringField);
}

class RejectCandidateResult extends CardDef {
  @field message = contains(StringField);
}

export class RejectCandidateCommand extends Command<
  typeof RejectCandidateInput,
  typeof RejectCandidateResult
> {
  static actionVerb = 'Reject';
  static displayName = 'Reject Candidate';

  async getInputType() {
    return RejectCandidateInput;
  }

  protected async run(
    input: RejectCandidateInput,
  ): Promise<RejectCandidateResult> {
    let { candidate, reason } = input;
    if (!candidate) {
      throw new Error('candidate is required');
    }
    if (candidate.status === 'hired') {
      throw new Error('Cannot reject a candidate who is already hired');
    }
    candidate.status = 'rejected';
    candidate.rejectionReason = reason || 'Not a fit at this time';
    candidate.decisionDate = new Date();
    await new SaveCardCommand(this.commandContext).execute({
      card: candidate,
    });
    return new RejectCandidateResult({
      message: `${candidate.name ?? 'Candidate'} was rejected.`,
    });
  }
}
