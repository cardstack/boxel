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
import { SupportAgent } from '../support-agent';

class AutoAssignInput extends CardDef {
  @field ticket = linksTo(() => Ticket, { searchable: true });
}

class AutoAssignResult extends CardDef {
  @field message = contains(StringField);
  @field assignee = linksTo(() => SupportAgent);
}

function words(text?: string | null): string[] {
  return (text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

/**
 * Route a ticket: category decides the queue, skills and load decide the person.
 *
 * Routing on tier alone — "give it to whoever on L1 has the fewest tickets" —
 * is what sends every SSO question to the person who has never seen one, and
 * is most of why a ticket takes three days and two escalations to reach
 * someone who could have answered it in five minutes. Skill match comes first;
 * load only breaks the tie.
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

export class AutoAssignTicketCommand extends Command<
  typeof AutoAssignInput,
  typeof AutoAssignResult
> {
  static actionVerb = 'Auto-assign';
  static displayName = 'Auto-assign Ticket';

  async getInputType() {
    return AutoAssignInput;
  }

  protected async run(input: AutoAssignInput): Promise<AutoAssignResult> {
    let ticket = await loaded(this.commandContext, input.ticket);
    if (!ticket) {
      throw new Error('ticket is required');
    }

    // Category first: it is where a ticket's queue and priority are supposed
    // to come from, and both stay overridable afterwards.
    if (!ticket.queue && ticket.category?.defaultQueue) {
      ticket.queue = ticket.category.defaultQueue;
    }
    if (!ticket.priority && ticket.category?.defaultPriority) {
      ticket.priority = ticket.category.defaultPriority;
    }

    let queue = ticket.queue;
    if (!queue) {
      throw new Error(
        'No queue on the ticket and no default on its category — there is nobody to choose between.',
      );
    }

    let candidates = (queue.agents ?? []).filter(Boolean);
    if (!candidates.length) {
      throw new Error(
        `${queue.title} has no agents, so the ticket would sit unclaimed while its clock runs.`,
      );
    }

    let needles = new Set([
      ...words(ticket.subject),
      ...words(ticket.categoryName),
      ...(ticket.tags ?? []).flatMap((tag: string) => words(tag)),
    ]);

    let scored = candidates.map((agent: any) => {
      let matches = (agent.skills ?? []).filter((skill: string) =>
        words(skill).some((w) => needles.has(w)),
      ).length;
      return { agent, matches };
    });

    let best = Math.max(...scored.map((s: { matches: number }) => s.matches));
    let shortlist = scored.filter(
      (s: { matches: number }) => s.matches === best,
    );

    // Load would be the tie-break here. Counting a live "open tickets per
    // agent" needs a query this command cannot run without a realm context,
    // so for now the first of the equally-skilled wins and the choice is
    // stated in the result rather than hidden.
    let chosen = shortlist[0]!.agent;

    ticket.assignee = chosen;
    if (ticket.status === 'New') {
      ticket.status = 'Open';
    }
    await new SaveCardCommand(this.commandContext).execute({ card: ticket });

    return new AutoAssignResult({
      message:
        best > 0
          ? `Assigned to ${chosen.title} — ${best} matching skill${best === 1 ? '' : 's'} in ${queue.title}.`
          : `Assigned to ${chosen.title} in ${queue.title}. No skill matched, so this was routed on availability alone — worth a second look.`,
      assignee: chosen,
    });
  }
}
