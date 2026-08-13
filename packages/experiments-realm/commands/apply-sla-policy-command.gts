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
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';

import { Ticket } from '../ticket';
import { SlaPolicy } from '../sla-policy';
import { addBusinessMinutes, ALWAYS_ON } from '../utils/sla';

class ApplySlaPolicyInput extends CardDef {
  @field ticket = linksTo(() => Ticket, { searchable: true });
  @field policy = linksTo(() => SlaPolicy, {
    searchable: true,
    description:
      'The policy to apply. The CALLER picks it — this command validates the ' +
      'choice against the conditions and refuses a policy that does not fit. ' +
      'It does not search: it has no view of the realm. Falls back to the ' +
      "ticket's already-linked policy when omitted.",
  });
}

class ApplySlaPolicyResult extends CardDef {
  @field message = contains(StringField);
}

/**
 * Apply a promise to a ticket and start the clocks.
 *
 * **It validates, it does not select.** The description on `policy` used to
 * say "omit to let the conditions decide", which this code never did — it
 * took whatever it was given (or the linked policy) and only checked it.
 * A caller that relied on the promise got the queue's default applied blind,
 * which on a VIP ticket is rejected by its own conditions while the VIP
 * policy sits unused in the same realm. Selection belongs to whoever can see
 * the realm; the check belongs here.
 *
 * This is the only place business-hours arithmetic runs. It resolves each
 * target to a plain wall-clock `deadlineAt` and stores it on the timer, which
 * is what lets everything downstream — the computed fields, the live badge,
 * the queue's sort — do nothing but subtract two numbers.
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

export class ApplySlaPolicyCommand extends Command<
  typeof ApplySlaPolicyInput,
  typeof ApplySlaPolicyResult
> {
  static actionVerb = 'Apply SLA';
  static displayName = 'Apply SLA Policy';

  async getInputType() {
    return ApplySlaPolicyInput;
  }

  protected async run(
    input: ApplySlaPolicyInput,
  ): Promise<ApplySlaPolicyResult> {
    let { policy } = input;
    let ticket = await loaded(this.commandContext, input.ticket);
    if (!ticket) {
      throw new Error('ticket is required');
    }

    let chosen = policy ?? ticket.slaPolicy;
    if (!chosen) {
      throw new Error(
        'No policy given and none linked. Link a policy, or pass one — a ticket with no policy is measured against nothing.',
      );
    }

    // The conditions are checked against the ticket's flattened attributes,
    // the same strings the tiles and the queue read. Matching against linked
    // records instead would make a policy that behaves differently depending
    // on whether the links happen to be resolved.
    let subject: Record<string, unknown> = {
      customerTier: ticket.customer?.tier ?? '',
      priority: ticket.priority ?? '',
      categoryName: ticket.categoryName ?? '',
      queueName: ticket.queueName ?? '',
      channel: ticket.channel ?? '',
      ticketType: ticket.ticketType ?? '',
    };
    if (!chosen.applies(subject)) {
      throw new Error(
        `${chosen.title} does not apply to this ticket — its conditions are: ${chosen.conditionSummary}`,
      );
    }

    let schedule = chosen.businessHours?.businessSchedule ?? ALWAYS_ON;
    let start = ticket.openedAt ?? new Date();
    let timers: Record<string, unknown>[] = [];

    for (let metric of ['First response', 'Resolution'] as const) {
      let minutes = chosen.targetFor(metric, ticket.priority);
      if (minutes == null) {
        continue;
      }
      // Preserve a clock that has already been satisfied. Re-applying a policy
      // — which happens whenever a ticket is re-prioritised — must not erase
      // the fact that we DID answer inside the old target.
      let existing = (ticket.timers ?? []).find((t: any) => t?.kind === metric);
      // Plain JSON, not `new SlaTimerField(...)`. A compound value handed to
      // the field class here is constructed outside the card's own
      // deserialization, which is where the dates quietly stop being dates —
      // it is patched in below instead.
      timers.push({
        kind: metric,
        targetMinutes: minutes,
        startedAt: start.toISOString(),
        deadlineAt: addBusinessMinutes(start, minutes, schedule).toISOString(),
        satisfiedAt: existing?.satisfiedAt
          ? new Date(existing.satisfiedAt).toISOString()
          : undefined,
        pausedSince: existing?.pausedSince
          ? new Date(existing.pausedSince).toISOString()
          : undefined,
      });
    }

    if (!timers.length) {
      throw new Error(
        `${chosen.title} has no targets set, so there is nothing to measure.`,
      );
    }

    ticket.slaPolicy = chosen;
    await new SaveCardCommand(this.commandContext).execute({ card: ticket });
    // The timers go through a patch so the card deserializes them itself.
    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: Ticket,
    }).execute({
      cardId: ticket.id,
      patch: { attributes: { timers } },
    } as any);

    return new ApplySlaPolicyResult({
      message: `${chosen.title} applied — ${timers
        .map((t) => t.kind)
        .join(' and ')} clocks started.`,
    });
  }
}
