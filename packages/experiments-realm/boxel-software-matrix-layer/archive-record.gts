import {
  CardDef,
  StringField,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { GetCardCommand } from '@cardstack/boxel-host/commands/get-card';

import { canTransition } from './status-field';
import RecordStatusField from './record-status-field';

export class RecordLifecycleInput extends CardDef {
  @field card = linksTo(CardDef, { searchable: true });
}

export class RecordLifecycleResult extends CardDef {
  @field message = contains(StringField);
}

/** Re-fetch before reading — the caller's copy may have unloaded links. */
export async function loaded(context: any, card: any) {
  if (!card?.id) {
    return card;
  }
  return ((await new GetCardCommand(context).execute({
    cardId: card.id,
  } as any)) ?? card) as any;
}

export async function transitionRecordStatus(
  context: any,
  inputCard: any,
  to: 'Archived' | 'Active',
): Promise<string> {
  let card = await loaded(context, inputCard);
  if (!card) {
    throw new Error('card is required');
  }
  let from = (card as any).recordStatus as string | undefined;
  if (from === to) {
    return `${card.cardTitle ?? 'The record'} is already ${to.toLowerCase()}.`;
  }
  // A record that never carried a status is treated as live, so first-time
  // archiving works without a backfill.
  if (from && !canTransition(RecordStatusField, from, to)) {
    throw new Error(
      `A record cannot go from ${from} to ${to} under the record lifecycle.`,
    );
  }
  (card as any).recordStatus = to;
  await new SaveCardCommand(context).execute({ card } as any);
  return `${card.cardTitle ?? 'The record'} is now ${to.toLowerCase()}.`;
}

/**
 * The single writer for sending a record out of the working set. Archived is
 * the Record Status block's soft delete: kept, queryable, hidden from working
 * views, always reversible (Restore Record is the way back). The command only
 * writes `recordStatus` — hiding archived records is each consumer's query
 * filter, and hard deletion stays the platform's file-delete.
 */
export default class ArchiveRecordCommand extends Command<
  typeof RecordLifecycleInput,
  typeof RecordLifecycleResult
> {
  static actionVerb = 'Archive';
  static displayName = 'Archive Record';

  async getInputType() {
    return RecordLifecycleInput;
  }

  protected async run(
    input: RecordLifecycleInput,
  ): Promise<RecordLifecycleResult> {
    let message = await transitionRecordStatus(
      this.commandContext,
      input.card,
      'Archived',
    );
    return new RecordLifecycleResult({ message });
  }
}
