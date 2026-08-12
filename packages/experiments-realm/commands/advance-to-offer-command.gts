import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { realmURL } from '@cardstack/base/card-api';

import { Candidate } from '../candidate';
import { Offer } from '../offer';

class AdvanceToOfferInput extends CardDef {
  @field candidate = linksTo(() => Candidate, { searchable: true });
}

class AdvanceToOfferResult extends CardDef {
  @field message = contains(StringField);
  @field offer = linksTo(() => Offer);
}

export class AdvanceToOfferCommand extends Command<
  typeof AdvanceToOfferInput,
  typeof AdvanceToOfferResult
> {
  static actionVerb = 'Advance to Offer';
  static displayName = 'Advance Candidate to Offer';

  async getInputType() {
    return AdvanceToOfferInput;
  }

  protected async run(
    input: AdvanceToOfferInput,
  ): Promise<AdvanceToOfferResult> {
    let { candidate } = input;
    if (!candidate) {
      throw new Error('candidate is required');
    }
    // Two legitimate entry points: advancing an interviewing candidate, and
    // drafting the missing Offer for a candidate already AT the offer stage
    // (e.g. the stage was set by hand, or the draft was deleted) — the
    // board's "Create offer" button is the second case. Anything else is a
    // wrong-stage call.
    if (
      candidate.status !== 'interviewing' &&
      !(candidate.status === 'offer' && !candidate.offerState)
    ) {
      throw new Error(
        `Only candidates at the "interviewing" stage (or at "offer" with no draft yet) can be advanced to offer (current stage: ${
          candidate.status ?? 'none'
        })`,
      );
    }
    candidate.status = 'offer';

    // Reaching the offer stage and having sent an offer are different facts.
    // Advancing creates the offer as a DRAFT so the package can be assembled
    // before anything goes to the candidate; ExtendOfferCommand is what flips
    // it to 'extended'. Without this the 'draft' status in OFFER_STATUSES was
    // unreachable and the intermediate state lived only in a UI pill.
    let offer = candidate.offer;
    if (!offer) {
      let realm = candidate[realmURL]?.href;
      offer = new Offer({
        candidate,
        position: candidate.position,
        offeredTitle: candidate.appliedRole,
        status: 'draft',
      }) as Offer;
      offer = (await new SaveCardCommand(this.commandContext).execute({
        card: offer,
        realm,
      } as any)) as Offer;
      candidate.offer = offer;
    }
    candidate.offerState = offer.status ?? 'draft';

    await new SaveCardCommand(this.commandContext).execute({
      card: candidate,
    });
    return new AdvanceToOfferResult({
      message: `${candidate.name ?? 'Candidate'} moved to the offer stage; a draft offer was created.`,
      offer,
    });
  }
}
