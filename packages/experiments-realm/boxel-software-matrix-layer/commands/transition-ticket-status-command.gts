import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { GetCardCommand } from '@cardstack/boxel-host/commands/get-card';

import { Ticket } from '../ticket';
import { TicketMessageField } from '../ticket-message-field';
import {
  TicketStatusField,
  canTransitionTicket,
  statusPausesSla,
  statusIsTerminal,
} from '../ticket-taxonomy';
import { nextStatuses } from '../status-field';

class TransitionInput extends CardDef {
  @field ticket = linksTo(() => Ticket, { searchable: true });
  @field toStatus = contains(TicketStatusField);
  @field note = contains(StringField, {
    description: 'Optional. Recorded as an internal note on the ticket.',
  });
}

class TransitionResult extends CardDef {
  @field message = contains(StringField);
}

const MINUTE = 60_000;

/**
 * Move a ticket to another status, and keep every clock honest about it.
 *
 * This is why status is read-only in the edit form. Three things have to
 * happen together or the ticket starts lying:
 *
 *   1. the move has to be legal (no New → Closed);
 *   2. entering a holding status has to STOP the clocks;
 *   3. leaving one has to push every deadline out by however long the pause
 *      lasted, or the ticket silently loses the time it spent waiting for
 *      someone else.
 *
 * Point 3 is the one that gets forgotten, and it is the one customers notice:
 * they take a day to reply and the ticket comes back already breached.
 */
/**
 * Re-fetch the subject before reading anything through its links.
 *
 * A caller may hand over a card whose linked fields were never loaded — a
 * queue row, a search result, a card that arrived over a command boundary.
 * Reading `ticket.queue?.defaultPolicy` off one of those silently yields
 * `undefined` and the command quietly does the wrong thing rather than
 * failing, which is how a live run produced an ownerless record.
 */
async function loaded(context: any, ticket: any) {
  if (!ticket?.id) {
    return ticket;
  }
  return ((await new GetCardCommand(context).execute({
    cardId: ticket.id,
  } as any)) ?? ticket) as any;
}

export class TransitionTicketStatusCommand extends Command<
  typeof TransitionInput,
  typeof TransitionResult
> {
  static actionVerb = 'Set status';
  static displayName = 'Change Ticket Status';

  async getInputType() {
    return TransitionInput;
  }

  protected async run(input: TransitionInput): Promise<TransitionResult> {
    let { toStatus, note } = input;
    let ticket = await loaded(this.commandContext, input.ticket);
    if (!ticket) {
      throw new Error('ticket is required');
    }
    if (!toStatus) {
      throw new Error('toStatus is required');
    }

    let from = ticket.status;
    if (!canTransitionTicket(from, toStatus)) {
      let allowed = nextStatuses(TicketStatusField, from)
        .map((o) => o.value)
        .join(', ');
      throw new Error(
        `A ticket cannot go from ${from ?? 'no status'} to ${toStatus}. From here you can move to: ${allowed || 'nothing'}.`,
      );
    }

    let now = new Date();
    let wasHolding = statusPausesSla(from);
    let isHolding = statusPausesSla(toStatus);

    // Re-opening a settled ticket un-satisfies the resolution promise.
    //
    // Resolving stamps `satisfiedAt` on the Resolution timer, and the loop
    // below skips any timer that carries one — so a re-opened ticket kept
    // reading "Met" forever. `urgencyRank` then returns MAX_SAFE_INTEGER for
    // it, which sorts it last in every queue and makes it structurally
    // incapable of ever breaching again: the ticket is live work that no
    // clock is watching.
    let reopening = statusIsTerminal(from) && !statusIsTerminal(toStatus);

    for (let timer of ticket.timers ?? []) {
      if (!timer) {
        continue;
      }
      if (reopening && timer.kind === 'Resolution' && timer.satisfiedAt) {
        // The interval spent resolved is not the agent's time, so push the
        // deadline out by it rather than resuming against a stale one — the
        // same treatment a pause gets, for the same reason.
        let settledMinutes = Math.max(
          0,
          Math.round((now.getTime() - timer.satisfiedAt.getTime()) / MINUTE),
        );
        if (timer.deadlineAt) {
          timer.deadlineAt = new Date(
            timer.deadlineAt.getTime() + settledMinutes * MINUTE,
          );
        }
        timer.satisfiedAt = undefined as unknown as Date;
      }
      if (timer.satisfiedAt) {
        continue;
      }
      if (!wasHolding && isHolding) {
        timer.pausedSince = now;
      } else if (wasHolding && !isHolding && timer.pausedSince) {
        let heldMinutes = Math.max(
          0,
          Math.round((now.getTime() - timer.pausedSince.getTime()) / MINUTE),
        );
        if (timer.deadlineAt) {
          timer.deadlineAt = new Date(
            timer.deadlineAt.getTime() + heldMinutes * MINUTE,
          );
        }
        timer.pausedSince = undefined as unknown as Date;
      }

      // Resolving satisfies the resolution clock. Anything else would leave a
      // resolved ticket counting down towards a breach nobody can act on.
      if (toStatus === 'Resolved' && timer.kind === 'Resolution') {
        timer.satisfiedAt = now;
      }
    }

    ticket.status = toStatus;
    if (toStatus === 'Resolved') {
      ticket.resolvedAt = now;
    }
    if (toStatus === 'Closed') {
      ticket.closedAt = now;
    }

    let entries = [...(ticket.messages ?? [])];
    entries.push(
      new TicketMessageField({
        author: 'System',
        authorRole: 'System',
        visibility: 'Public',
        body: `Status changed from ${from ?? 'new'} to ${toStatus}${
          isHolding && !wasHolding ? ' — the clock is stopped' : ''
        }${wasHolding && !isHolding ? ' — the clock is running again' : ''}.`,
        sentAt: now,
        isSlaEvent: true,
      }),
    );
    if (note?.trim()) {
      entries.push(
        new TicketMessageField({
          author: 'System',
          authorRole: 'Agent',
          visibility: 'Internal',
          body: note.trim(),
          sentAt: now,
        }),
      );
    }
    ticket.messages = entries;

    await new SaveCardCommand(this.commandContext).execute({ card: ticket });

    return new TransitionResult({
      message: `${ticket.reference ?? 'Ticket'} is now ${toStatus}.`,
    });
  }
}
