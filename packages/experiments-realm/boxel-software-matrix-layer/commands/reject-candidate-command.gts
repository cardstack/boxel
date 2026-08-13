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
import { RejectionReasonField } from '../rejection-reason-field';

class RejectCandidateInput extends CardDef {
  @field candidate = linksTo(() => Candidate, { searchable: true });
  @field reason = contains(RejectionReasonField);
  @field note = contains(StringField, {
    description: 'Optional free-text detail, folded into rejectionReason',
  });
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
    let { candidate, reason, note } = input;
    if (!candidate) {
      throw new Error('candidate is required');
    }
    if (candidate.status === 'hired') {
      throw new Error('Cannot reject a candidate who is already hired');
    }
    if (!reason) {
      throw new Error(
        'A rejection reason is required — it drives the rejection-reason breakdown on the Offers dashboard',
      );
    }
    candidate.status = 'rejected';

    // Cascade to the Offer, mirroring ApproveOfferCommand. Without this the
    // two surfaces disagree: the candidate reads 'rejected' while the offer
    // still reads as sent-and-awaiting-reply, and 'declined' — a value that
    // exists in OFFER_STATUSES and has its own timeline rendering — stays
    // permanently unreachable through the UI.
    if (candidate.offer) {
      candidate.offer.status = 'declined';
      candidate.offer.decisionDate = new Date();
      await new SaveCardCommand(this.commandContext).execute({
        card: candidate.offer,
      } as any);
    }
    candidate.offerState = 'declined';
    candidate.rejectionReason = reason;
    candidate.rejectionNote = note?.trim() || undefined;
    candidate.decisionDate = new Date();
    await new SaveCardCommand(this.commandContext).execute({
      card: candidate,
    });
    return new RejectCandidateResult({
      message: `${candidate.name ?? 'Candidate'} was rejected.`,
    });
  }
}
