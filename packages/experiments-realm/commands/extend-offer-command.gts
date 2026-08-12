import {
  CardDef,
  field,
  contains,
  linksTo,
  realmURL,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { Candidate } from '../candidate';
import { Offer } from '../offer';
import { Employee } from '../employee';
import { ApprovalChainField } from '../approval-chain-field';
import { ApprovalStepField } from '../approval-step-field';

class ExtendOfferInput extends CardDef {
  @field candidate = linksTo(() => Candidate, { searchable: true });
  @field approver = linksTo(() => Employee, { searchable: true });
  @field salary = contains(NumberField);
  @field startDate = contains(DateField);
}

class ExtendOfferResult extends CardDef {
  @field message = contains(StringField);
  @field offer = linksTo(() => Offer);
}

export class ExtendOfferCommand extends Command<
  typeof ExtendOfferInput,
  typeof ExtendOfferResult
> {
  static actionVerb = 'Extend Offer';
  static displayName = 'Extend Offer';

  async getInputType() {
    return ExtendOfferInput;
  }

  protected async run(input: ExtendOfferInput): Promise<ExtendOfferResult> {
    let { candidate, approver, salary, startDate } = input;
    if (!candidate) {
      throw new Error('candidate is required');
    }
    if (candidate.status !== 'offer') {
      throw new Error(
        `Only candidates at the "offer" stage can have an offer extended (current stage: ${
          candidate.status ?? 'none'
        })`,
      );
    }
    let existing = candidate.offer;
    let saved: Offer;

    if (existing) {
      // Advancing to the offer stage leaves a DRAFT behind. Sending is a flip
      // of that draft, not a second card — so a candidate never ends up with
      // two offers, and clicking twice is a clean error rather than a dupe.
      if (existing.status !== 'draft') {
        throw new Error(
          `This offer has already been sent (status: ${existing.status ?? 'unknown'})`,
        );
      }
      existing.status = 'extended';
      existing.extendedDate = new Date();
      if (salary != null) {
        existing.salary = salary;
      }
      if (startDate) {
        existing.startDate = startDate;
      }
      // `approver` seeds a one-step approval chain rather than setting a
      // single `approvedBy` link (that field was replaced by `approvalChain`
      // — see position.gts/offer.gts). Only seeds it if no chain has been
      // started yet, so extending an already-gated offer never resets its
      // in-progress approval history.
      if (approver && !existing.approvalChain?.steps?.length) {
        existing.approvalChain = new ApprovalChainField({
          steps: [new ApprovalStepField({ approver, decision: 'pending' })],
          startedAt: new Date(),
        });
      }
      saved = (await new SaveCardCommand(this.commandContext).execute({
        card: existing,
      } as any)) as Offer;
    } else {
      // No draft on record (a hand-built candidate, or one advanced before
      // drafts existed) — create the sent offer directly.
      let realm = candidate[realmURL]?.href;
      let offer = new Offer({
        candidate,
        position: candidate.position,
        offeredTitle: candidate.appliedRole,
        salary,
        startDate,
        extendedDate: new Date(),
        approvalChain: approver
          ? new ApprovalChainField({
              steps: [new ApprovalStepField({ approver, decision: 'pending' })],
              startedAt: new Date(),
            })
          : undefined,
        status: 'extended',
      });
      saved = (await new SaveCardCommand(this.commandContext).execute({
        card: offer,
        realm,
      } as any)) as Offer;
      candidate.offer = saved;
    }

    candidate.offerState = 'extended';
    await new SaveCardCommand(this.commandContext).execute({
      card: candidate,
    });

    return new ExtendOfferResult({
      message: `Offer sent to ${candidate.name ?? 'candidate'}.`,
      offer: saved,
    });
  }
}
