import {
  CardDef,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';

import { Invoice } from '../invoice';
import { VarianceActionField, VARIANCE_ACTIONS } from '../three-way-match';

// Resolve Variance — records one human decision about one failing match
// line, on the invoice, permanently. Reason is REQUIRED: the resolution IS
// the audit line. Resolving does not recompute anything — the panel
// re-derives the match and treats a resolved line as no longer blocking;
// the invoice moves to `matching` so the ladder shows it is being worked.

export class ResolveVarianceInput extends CardDef {
  @field invoice = linksTo(() => Invoice, { searchable: true });
  @field lineNumber = contains(NumberField);
  @field action = contains(VarianceActionField);
  @field reason = contains(StringField);
}

export class ResolveVarianceResult extends CardDef {
  @field message = contains(StringField);
}

export default class ResolveVarianceCommand extends Command<
  typeof ResolveVarianceInput,
  typeof ResolveVarianceResult
> {
  static actionVerb = 'Resolve';
  static displayName = 'Resolve Variance';

  async getInputType() {
    return ResolveVarianceInput;
  }

  protected async run(
    input: ResolveVarianceInput,
  ): Promise<ResolveVarianceResult> {
    let { invoice, lineNumber, action, reason } = input;
    if (!invoice) {
      throw new Error('An invoice is required');
    }
    if (lineNumber == null) {
      throw new Error('A line number is required');
    }
    if (!VARIANCE_ACTIONS.includes(action ?? '')) {
      throw new Error('action must be accept, short-pay, or reject-line');
    }
    if (!reason?.trim()) {
      throw new Error(
        'A reason is required — the resolution is the audit line',
      );
    }
    if (invoice.id) {
      invoice = (await new GetCardCommand(this.commandContext).execute({
        cardId: invoice.id,
      })) as Invoice;
    }
    let existing = (invoice.varianceResolutions ?? []).filter(Boolean);
    if (existing.some((r) => r.lineNumber === lineNumber)) {
      throw new Error(
        `Line ${lineNumber} already has a resolution — a change of mind is a new decision on the record, not an edit`,
      );
    }

    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: Invoice,
    }).execute({
      cardId: invoice.id,
      patch: {
        attributes: {
          status: 'matching',
          varianceResolutions: [
            ...existing.map((r) => ({
              lineNumber: r.lineNumber,
              action: r.action,
              reason: r.reason,
              resolvedAt: r.resolvedAt,
            })),
            {
              lineNumber,
              action,
              reason,
              resolvedAt: new Date().toISOString(),
            },
          ],
        },
      },
    });

    return new ResolveVarianceResult({
      message: `Line ${lineNumber} resolved (${action}): ${reason}`,
    });
  }
}
