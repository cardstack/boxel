import { Command } from '@cardstack/runtime-common';
import {
  CardDef,
  StringField,
  contains,
  field,
  realmURL,
} from '@cardstack/base/card-api';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { CollectionItem } from './collection-item';
import {
  AuthenticationRecord,
  AuthOutcomeField,
} from './authentication-record';
import { canTransition } from './status-field';

export class AuthenticateItemInput extends CardDef {
  @field itemId = contains(StringField);
  @field orderId = contains(StringField);
  @field service = contains(StringField);
  @field authenticator = contains(StringField);
  @field certificateId = contains(StringField);
  @field notes = contains(StringField);
  // 'passed' | 'failed' — the verdict this call resolves the check to. A
  // fresh `AuthenticationRecord` is created in `pending` and immediately
  // moved to this value in the same call, rather than modelling a real
  // asynchronous submit-then-poll round trip this realm cannot run.
  @field outcome = contains(StringField);
}

export class AuthenticateItemResult extends CardDef {
  @field authenticationRecordId = contains(StringField);
  @field outcome = contains(StringField);
}

// Authenticate Item (AI) — runs a legit check and records the verdict.
//
// TWO CARDS UPDATE, NOT ONE, AND FOR A STATED REASON.
// `AuthenticationRecord` is the full record (service, authenticator, the
// certificate, submitted photos) — everything a dispute needs. But a
// collection grid is prerendered fitted, which cannot resolve a link to this
// record, so `CollectionItem` keeps only the OUTCOME (`verifiedOn`,
// `verifiedBy`, `verificationReference`) so a tile can show a verified badge
// without resolving anything. See `authentication-record.gts`'s own header
// note — this command is what keeps the two in sync rather than leaving the
// second write to whoever remembers.
//
// A FAILED VERDICT DOES NOT AUTO-REFUND. `authentication-record.gts` says
// failure "in an escrow flow this refunds the buyer" — that is a fact about
// what SHOULD happen next, not something this command does for you. Refund
// is money moving, and `RefundOrderCommand` is its own explicit call, so a
// failed check is never silently followed by an unrequested charge reversal.
export default class AuthenticateItemCommand extends Command<
  typeof AuthenticateItemInput,
  typeof AuthenticateItemResult
> {
  static actionVerb = 'Authenticate item';
  description =
    'Record an authentication verdict for a collection item, and sync the outcome onto the item itself.';

  async getInputType() {
    return AuthenticateItemInput;
  }

  protected async run(
    input: AuthenticateItemInput,
  ): Promise<AuthenticateItemResult> {
    let itemId = input.itemId?.trim();
    if (!itemId) {
      throw new Error('itemId is required');
    }
    let outcome = input.outcome?.trim();
    if (outcome !== 'passed' && outcome !== 'failed') {
      throw new Error("outcome must be 'passed' or 'failed'");
    }
    if (!canTransition(AuthOutcomeField, 'pending', outcome)) {
      throw new Error(`Authentication outcome cannot resolve to ${outcome}`);
    }

    let item = (await new GetCardCommand(this.toolContext).execute({
      cardId: itemId,
    })) as CollectionItem;
    if (!item) {
      throw new Error(`CollectionItem not found: ${itemId}`);
    }

    let now = new Date();

    let record = new AuthenticationRecord();
    record.item = item;
    if (input.orderId?.trim()) {
      record.order = (await new GetCardCommand(this.toolContext).execute({
        cardId: input.orderId.trim(),
      })) as any;
    }
    record.service = input.service?.trim() || 'In-house';
    record.outcome = outcome as 'passed' | 'failed';
    record.submittedAt = now;
    record.completedAt = now;
    record.certificateId = input.certificateId?.trim() || '';
    record.authenticator = input.authenticator?.trim() || '';
    record.authenticatorNotes = input.notes?.trim() || '';

    // Save into the SOURCE card's own realm. Without `realm`, SaveCard
    // defaults to the base realm and the write 401s — verified live when a
    // ProcessPayment run tried to save its Payment to cardstack.com/base/.
    let realm = (item as any)?.[realmURL]?.href;
    let saved = (await new SaveCardCommand(this.toolContext).execute({
      card: record,
      realm,
    })) as AuthenticationRecord;

    if (outcome === 'passed') {
      await new PatchCardInstanceCommand(this.toolContext, {
        cardType: CollectionItem,
      }).execute({
        cardId: itemId,
        patch: {
          attributes: {
            verifiedOn: now.toISOString().slice(0, 10),
            verifiedBy: record.authenticator,
            verificationReference: record.certificateId,
          },
        },
      });
    }

    let result = new AuthenticateItemResult();
    result.authenticationRecordId = saved.id;
    result.outcome = outcome;
    return result;
  }
}
