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

class MergeInput extends CardDef {
  @field primary = linksTo(() => Ticket, {
    searchable: true,
    description: 'The ticket that survives.',
  });
  @field duplicate = linksTo(() => Ticket, {
    searchable: true,
    description: 'The ticket that is folded in and closed.',
  });
}

class MergeResult extends CardDef {
  @field message = contains(StringField);
}

/**
 * Fold a duplicate into the ticket that survives.
 *
 * The conversations combine in time order — merging by appending one thread
 * after the other produces a transcript where the customer appears to answer
 * questions before they were asked.
 *
 * The duplicate is cancelled rather than deleted. Somebody has its number, it
 * may be in a report, and a support system where records vanish is one nobody
 * trusts. Its clocks stop with it.
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

export class MergeTicketsCommand extends Command<
  typeof MergeInput,
  typeof MergeResult
> {
  static actionVerb = 'Merge';
  static displayName = 'Merge Tickets';

  async getInputType() {
    return MergeInput;
  }

  protected async run(input: MergeInput): Promise<MergeResult> {
    let primary = await loaded(this.commandContext, input.primary);
    let duplicate = await loaded(this.commandContext, input.duplicate);
    if (!primary || !duplicate) {
      throw new Error('both primary and duplicate are required');
    }
    if (primary.id === duplicate.id) {
      throw new Error('A ticket cannot be merged into itself.');
    }
    if (duplicate.status === 'Cancelled') {
      throw new Error(
        `${duplicate.reference ?? 'That ticket'} has already been merged or cancelled.`,
      );
    }

    let now = new Date();
    let combined = [
      ...(primary.messages ?? []),
      ...(duplicate.messages ?? []),
    ].sort((a, b) => {
      let at = a?.sentAt ? new Date(a.sentAt).getTime() : 0;
      let bt = b?.sentAt ? new Date(b.sentAt).getTime() : 0;
      return at - bt;
    });

    combined.push(
      new TicketMessageField({
        author: 'System',
        authorRole: 'System',
        visibility: 'Public',
        body: `${duplicate.reference ?? 'A duplicate ticket'} was merged into this one. Its conversation is above, in time order.`,
        sentAt: now,
        isSlaEvent: true,
      }),
    );
    primary.messages = combined;

    // The tags come along: they are how the merged ticket stays findable under
    // whatever the duplicate was filed as.
    let tags = new Set([...(primary.tags ?? []), ...(duplicate.tags ?? [])]);
    primary.tags = [...tags].filter(Boolean);

    let related = (primary.relatedTickets ?? []).filter(Boolean);
    if (!related.some((t: any) => t.id === duplicate.id)) {
      primary.relatedTickets = [...related, duplicate];
    }

    duplicate.status = 'Cancelled';
    duplicate.closedAt = now;
    for (let timer of duplicate.timers ?? []) {
      if (timer && !timer.satisfiedAt) {
        timer.pausedSince = now;
      }
    }
    duplicate.messages = [
      ...(duplicate.messages ?? []),
      new TicketMessageField({
        author: 'System',
        authorRole: 'System',
        visibility: 'Public',
        body: `Merged into ${primary.reference ?? 'another ticket'} and closed. Follow that one for updates.`,
        sentAt: now,
        isSlaEvent: true,
      }),
    ];

    await new SaveCardCommand(this.commandContext).execute({ card: duplicate });
    await new SaveCardCommand(this.commandContext).execute({ card: primary });

    return new MergeResult({
      message: `${duplicate.reference ?? 'Duplicate'} merged into ${primary.reference ?? 'the primary ticket'}; ${combined.length} entries now in one thread.`,
    });
  }
}
