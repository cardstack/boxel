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

import { ServiceRequest } from '../service-request';
import { SupportAgent } from '../support-agent';
import { TicketMessageField } from '../ticket-message-field';

class ApproveInput extends CardDef {
  @field request = linksTo(() => ServiceRequest, { searchable: true });
  @field approver = linksTo(() => SupportAgent, { searchable: true });
  @field decision = contains(StringField, {
    description: 'Approved or Declined. Defaults to Approved.',
  });
  @field note = contains(StringField, {
    description: 'Required when declining — the requester is owed a reason.',
  });
}

class ApproveResult extends CardDef {
  @field message = contains(StringField);
}

/**
 * Record the decision a service request is waiting on.
 *
 * The half of ITIL that incidents do not have. Two things it is careful about:
 * a decline must carry a reason, because a request that comes back "no" with
 * no explanation just gets raised again next week; and the decision is written
 * to the customer-visible thread rather than an internal note, because the
 * person who asked is entitled to see the answer.
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

export class ApproveServiceRequestCommand extends Command<
  typeof ApproveInput,
  typeof ApproveResult
> {
  static actionVerb = 'Decide';
  static displayName = 'Approve Service Request';

  async getInputType() {
    return ApproveInput;
  }

  protected async run(input: ApproveInput): Promise<ApproveResult> {
    let { approver, decision, note } = input;
    let request = await loaded(this.commandContext, input.request);
    if (!request) {
      throw new Error('request is required');
    }
    let verdict = decision?.trim() || 'Approved';
    if (verdict !== 'Approved' && verdict !== 'Declined') {
      throw new Error(`decision must be Approved or Declined, not ${verdict}`);
    }
    if (request.approvalState === 'Not required') {
      throw new Error(
        `${request.reference ?? 'This request'} does not need approval — fulfil it directly.`,
      );
    }
    if (
      request.approvalState === 'Approved' ||
      request.approvalState === 'Declined'
    ) {
      throw new Error(
        `${request.reference ?? 'This request'} was already ${request.approvalState.toLowerCase()}.`,
      );
    }
    if (verdict === 'Declined' && !note?.trim()) {
      throw new Error(
        'A decline needs a reason — otherwise the same request comes back next week.',
      );
    }

    let now = new Date();
    request.approvalState = verdict;
    request.approvedBy = approver;
    request.approvedAt = now;

    request.messages = [
      ...(request.messages ?? []),
      new TicketMessageField({
        author: approver?.title ?? 'Approver',
        authorRole: 'Agent',
        visibility: 'Public',
        body:
          verdict === 'Approved'
            ? `Approved${approver?.title ? ` by ${approver.title}` : ''}. Fulfilment starts now.`
            : `Declined${approver?.title ? ` by ${approver.title}` : ''}. ${note!.trim()}`,
        sentAt: now,
      }),
    ];

    await new SaveCardCommand(this.commandContext).execute({ card: request });

    return new ApproveResult({
      message: `${request.reference ?? 'Request'} ${verdict.toLowerCase()}.`,
    });
  }
}
