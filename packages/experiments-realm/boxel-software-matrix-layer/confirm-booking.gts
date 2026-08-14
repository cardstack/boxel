import {
  CardDef,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';

import { Booking } from './booking';
import RsvpStatusField from './rsvp-status-field';
import { canTransition } from './status-field';

export class ConfirmBookingInput extends CardDef {
  @field booking = linksTo(Booking, { searchable: true });
  @field realm = contains(StringField);
}

export class ConfirmBookingResult extends CardDef {
  @field booking = linksTo(Booking);
  @field message = contains(StringField);
}

/**
 * Moves a booking's attendance intent to Going — the purchase-complete /
 * "see you there" transition. Respects the RSVP graph: a booking already
 * Going is reported, not re-written, and a state the graph will not release
 * (there is none today, but the check is what keeps that true if the
 * vocabulary grows) is refused rather than forced.
 *
 * Deliberately does NOT touch paymentStatus: money is a different fact
 * with its own writer, and coupling them here would make every free event
 * wrong.
 */
export default class ConfirmBookingCommand extends Command<
  typeof ConfirmBookingInput,
  typeof ConfirmBookingResult
> {
  static actionVerb = 'Confirm Booking';

  async getInputType() {
    return ConfirmBookingInput;
  }

  protected async run(
    input: ConfirmBookingInput,
  ): Promise<ConfirmBookingResult> {
    let { booking, realm } = input;
    if (!booking) throw new Error('A booking is required');
    if (!realm) throw new Error('A realm is required');
    if (booking.id) {
      booking = (await new GetCardCommand(this.commandContext).execute({
        cardId: booking.id,
      })) as Booking;
    }

    let ref = booking.reference ?? 'booking';
    if (booking.rsvp === 'Going') {
      return new ConfirmBookingResult({
        booking,
        message: `${ref} was already confirmed`,
      });
    }
    if (booking.rsvp && !canTransition(RsvpStatusField, booking.rsvp, 'Going')) {
      throw new Error(`Cannot confirm a booking that is ${booking.rsvp}`);
    }

    booking.rsvp = 'Going';
    await new SaveCardCommand(this.commandContext).execute({
      card: booking,
      realm,
    } as any);

    return new ConfirmBookingResult({
      booking,
      message: `Confirmed ${ref} — holder is Going`,
    });
  }
}
