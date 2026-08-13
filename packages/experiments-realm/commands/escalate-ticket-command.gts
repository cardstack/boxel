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
import { Queue } from '../queue';
import { TicketMessageField } from '../ticket-message-field';
import type { SupportAgent } from '../support-agent';
import { nextTier, AGENT_TIER_LABELS } from '../support-agent';

class EscalateInput extends CardDef {
  @field ticket = linksTo(() => Ticket, { searchable: true });
  @field toQueue = linksTo(() => Queue, {
    searchable: true,
    description: 'The queue one tier up. Required — escalation is a handover.',
  });
  @field reason = contains(StringField, {
    description: 'Why the current tier cannot resolve it. Required.',
  });
}

class EscalateResult extends CardDef {
  @field message = contains(StringField);
}

/**
 * Hand a ticket up a tier.
 *
 * Four decisions worth stating, because each one is a thing that goes wrong
 * when escalation is implemented as "change the queue field":
 *
 *   - A reason is mandatory. An escalation with no reason arrives as a ticket
 *     the next tier has to re-diagnose from scratch, which is most of why
 *     escalated tickets take so much longer than they should.
 *   - The assignee is cleared. Leaving it set hands the work to someone who
 *     is not on the receiving tier and cannot do it.
 *   - The SLA is NOT restarted. The customer has been waiting since they
 *     wrote in; resetting the clock hides that from every report.
 *   - It is recorded in the thread as a system event, so the next person can
 *     see the path the ticket took without opening an audit log.
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

export class EscalateTicketCommand extends Command<
  typeof EscalateInput,
  typeof EscalateResult
> {
  static actionVerb = 'Escalate';
  static displayName = 'Escalate Ticket';

  async getInputType() {
    return EscalateInput;
  }

  protected async run(input: EscalateInput): Promise<EscalateResult> {
    let { toQueue, reason } = input;
    let ticket = await loaded(this.commandContext, input.ticket);
    if (!ticket) {
      throw new Error('ticket is required');
    }
    if (!reason?.trim()) {
      throw new Error(
        'An escalation reason is required — without it the next tier starts the diagnosis over.',
      );
    }
    if (!toQueue) {
      throw new Error('toQueue is required — escalation is a handover.');
    }

    let fromQueue = ticket.queue;
    let fromTier = fromQueue?.tier;
    if (fromQueue?.id === toQueue.id) {
      throw new Error(
        `${toQueue.title} is already this ticket's queue — nothing would change.`,
      );
    }
    if (fromTier && toQueue.tier && toQueue.tier <= fromTier) {
      throw new Error(
        `${toQueue.title} is ${AGENT_TIER_LABELS[toQueue.tier] ?? toQueue.tier}, which is not above ${AGENT_TIER_LABELS[fromTier] ?? fromTier}. Escalation goes up.`,
      );
    }
    if (fromTier && !nextTier(fromTier)) {
      throw new Error(
        `${AGENT_TIER_LABELS[fromTier] ?? fromTier} is the top tier — there is nowhere to escalate to.`,
      );
    }

    let now = new Date();
    ticket.queue = toQueue;
    // Cleared so the receiving tier claims it. The cast is a typing gap:
    // the field is declared non-optional but undefined is how it is cleared.
    ticket.assignee = undefined as unknown as SupportAgent;
    if (ticket.status === 'New') {
      ticket.status = 'Open';
    }

    ticket.messages = [
      ...(ticket.messages ?? []),
      new TicketMessageField({
        author: 'System',
        authorRole: 'System',
        visibility: 'Public',
        body: `Escalated from ${fromQueue?.title ?? 'no queue'} to ${toQueue.title}. The SLA clock keeps running.`,
        sentAt: now,
        isSlaEvent: true,
      }),
      new TicketMessageField({
        author: 'System',
        authorRole: 'Agent',
        visibility: 'Internal',
        body: `Escalation reason: ${reason.trim()}`,
        sentAt: now,
      }),
    ];

    await new SaveCardCommand(this.commandContext).execute({ card: ticket });

    return new EscalateResult({
      message: `${ticket.reference ?? 'Ticket'} escalated to ${toQueue.title} and unassigned for the receiving tier to claim.`,
    });
  }
}
