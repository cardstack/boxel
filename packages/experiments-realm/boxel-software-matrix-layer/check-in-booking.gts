import { CardDef, contains, field, linksTo } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import DateTimeField from '@cardstack/base/datetime';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';

import { Booking } from './booking';

export class CheckInBookingInput extends CardDef {
  @field booking = linksTo(Booking, { searchable: true });
  @field realm = contains(StringField);
}

export class CheckInBookingResult extends CardDef {
  @field booking = linksTo(Booking);
  @field checkedInAt = contains(DateTimeField);
  @field message = contains(StringField);
}

/**
 * Records that the holder actually arrived. Writes `checkedInAt` exactly
 * once — a second scan is refused with the original time, which is what
 * makes a ticket one-time-use — and flips intent to Going, because turning
 * up outranks whatever the RSVP said.
 *
 * A Declined booking is refused: the record says they cancelled, so the
 * front desk gets an error to resolve, not a silent re-admission.
 * Whatever should FOLLOW arrival — attendance points, a survey trigger —
 * is the consumer's move, chained after this command.
 */
export default class CheckInBookingCommand extends Command<
  typeof CheckInBookingInput,
  typeof CheckInBookingResult
> {
  static actionVerb = 'Check In';

  async getInputType() {
    return CheckInBookingInput;
  }

  protected async run(
    input: CheckInBookingInput,
  ): Promise<CheckInBookingResult> {
    let { booking, realm } = input;
    if (!booking) throw new Error('A booking is required');
    if (!realm) throw new Error('A realm is required');
    if (booking.id) {
      booking = (await new GetCardCommand(this.commandContext).execute({
        cardId: booking.id,
      })) as Booking;
    }

    let ref = booking.reference ?? 'booking';
    if (booking.checkedInAt) {
      throw new Error(
        `${ref} was already checked in at ${new Date(
          booking.checkedInAt,
        ).toISOString()}`,
      );
    }
    if (booking.rsvp === 'Declined') {
      throw new Error(`${ref} was declined — resolve before admitting`);
    }

    let now = new Date();
    booking.checkedInAt = now;
    booking.rsvp = 'Going';
    await new SaveCardCommand(this.commandContext).execute({
      card: booking,
      realm,
    } as any);

    return new CheckInBookingResult({
      booking,
      checkedInAt: now,
      message: `Checked in ${ref}`,
    });
  }
}
