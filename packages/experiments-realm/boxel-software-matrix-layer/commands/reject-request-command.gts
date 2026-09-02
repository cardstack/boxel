import {
  CardDef,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

// Reject Request — the symmetric half of approval, domain-neutral: any
// request-shaped card (a PO pending approval, a service request, an offer)
// can be sent back. A reason is REQUIRED — an unexplained rejection is
// unactionable for the requester and useless in an audit — and the card's
// document identity (its number) is never touched: a rejected PO keeps its
// number. The block stays neutral about lifecycles: the consumer names the
// status the card returns to, because only the domain knows whether "back"
// means draft, rejected, or needs-work.

export class RejectRequestInput extends CardDef {
  @field target = linksTo(() => CardDef, { searchable: true });
  @field reason = contains(StringField);
  @field returnToStatus = contains(StringField, {
    description: 'The status the card returns to (default: "rejected")',
  });
}

export class RejectRequestResult extends CardDef {
  @field message = contains(StringField);
}

export default class RejectRequestCommand extends Command<
  typeof RejectRequestInput,
  typeof RejectRequestResult
> {
  static actionVerb = 'Reject';
  static displayName = 'Reject Request';

  async getInputType() {
    return RejectRequestInput;
  }

  protected async run(input: RejectRequestInput): Promise<RejectRequestResult> {
    let { target, reason, returnToStatus } = input;
    if (!target) {
      throw new Error('A request card is required');
    }
    if (!reason?.trim()) {
      throw new Error(
        'A reason is required — an unexplained rejection is unactionable for the requester',
      );
    }
    if (target.id) {
      target = (await new GetCardCommand(this.commandContext).execute({
        cardId: target.id,
      })) as CardDef;
    }
    let current = (target as any).status;
    let next = returnToStatus?.trim() || 'rejected';
    if (current === next) {
      throw new Error(`This request is already "${next}"`);
    }

    // Mutate-and-save (the ApproveChainStepCommand idiom) rather than a
    // schema-typed patch: the target's concrete type is unknown here, and a
    // reason field the type doesn't declare simply won't serialize — the
    // status write is the load-bearing one.
    (target as any).status = next;
    try {
      (target as any).rejectionReason = reason;
    } catch {
      // type doesn't carry the field — reason still lives in the result
    }
    await new SaveCardCommand(this.commandContext).execute({
      card: target,
    } as any);

    return new RejectRequestResult({
      message: `Rejected → ${next}. Reason recorded: ${reason}`,
    });
  }
}
