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
import { statusPausesSla } from '../ticket-taxonomy';

class ReplyInput extends CardDef {
  @field ticket = linksTo(() => Ticket, { searchable: true });
  @field body = contains(StringField);
  @field visibility = contains(StringField, {
    description: 'Public or Internal. Defaults to Public.',
  });
  @field authorName = contains(StringField);
  @field thenStatus = contains(StringField, {
    description:
      'Optional status to move to after sending, e.g. Pending. Validated by the caller.',
  });
}

class ReplyResult extends CardDef {
  @field message = contains(StringField);
}

const MINUTE = 60_000;

/**
 * Add an entry to a ticket's conversation.
 *
 * The single most frequent action in the whole application, so it does the
 * bookkeeping nobody should have to remember:
 *
 *   - a PUBLIC reply is what satisfies the first-response clock. An internal
 *     note is not, however carefully it was written — the customer has still
 *     heard nothing.
 *   - a public reply also stamps `firstRespondedAt` the first time, which is
 *     what every response-time report is computed from.
 *   - `thenStatus` exists because "reply and set pending" is one intention.
 *     Splitting it into two actions is how tickets end up sitting in Open with
 *     the clock running while everyone waits on the customer.
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

export class ReplyToTicketCommand extends Command<
  typeof ReplyInput,
  typeof ReplyResult
> {
  static actionVerb = 'Send';
  static displayName = 'Reply to Ticket';

  async getInputType() {
    return ReplyInput;
  }

  protected async run(input: ReplyInput): Promise<ReplyResult> {
    let { body, visibility, authorName, thenStatus } = input;
    let ticket = await loaded(this.commandContext, input.ticket);
    if (!ticket) {
      throw new Error('ticket is required');
    }
    if (!body?.trim()) {
      throw new Error('An empty reply would tell the customer nothing.');
    }

    let isInternal = visibility === 'Internal';
    let now = new Date();

    ticket.messages = [
      ...(ticket.messages ?? []),
      new TicketMessageField({
        author: authorName?.trim() || ticket.assigneeName || 'Agent',
        authorRole: 'Agent',
        visibility: isInternal ? 'Internal' : 'Public',
        body: body.trim(),
        sentAt: now,
      }),
    ];

    if (!isInternal) {
      if (!ticket.firstRespondedAt) {
        ticket.firstRespondedAt = now;
      }
      for (let timer of ticket.timers ?? []) {
        if (timer?.kind === 'First response' && !timer.satisfiedAt) {
          timer.satisfiedAt = now;
        }
      }
    }

    if (thenStatus && thenStatus !== ticket.status) {
      let wasHolding = statusPausesSla(ticket.status);
      let isHolding = statusPausesSla(thenStatus);
      for (let timer of ticket.timers ?? []) {
        if (!timer || timer.satisfiedAt) {
          continue;
        }
        if (!wasHolding && isHolding) {
          timer.pausedSince = now;
        } else if (wasHolding && !isHolding && timer.pausedSince) {
          let held = Math.max(
            0,
            Math.round((now.getTime() - timer.pausedSince.getTime()) / MINUTE),
          );
          if (timer.deadlineAt) {
            timer.deadlineAt = new Date(
              timer.deadlineAt.getTime() + held * MINUTE,
            );
          }
          timer.pausedSince = undefined as unknown as Date;
        }
      }
      ticket.status = thenStatus;
    }

    await new SaveCardCommand(this.commandContext).execute({ card: ticket });

    return new ReplyResult({
      message: isInternal
        ? 'Internal note added — the customer cannot see it.'
        : `Reply sent${thenStatus ? ` and the ticket is now ${thenStatus}` : ''}.`,
    });
  }
}
