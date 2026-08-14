import {
  CardDef,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import DateTimeField from '@cardstack/base/datetime';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';

import { LoyaltyAccount, PointsTransaction } from './loyalty-account';

export class CreditPointsInput extends CardDef {
  @field account = linksTo(LoyaltyAccount, { searchable: true });
  /** Signed: earn positive, redeem/expire negative. */
  @field amount = contains(NumberField);
  @field reason = contains(StringField);
  /** Program vocabulary: Attendance, Purchase, Survey, Manual… */
  @field source = contains(StringField);
  @field expiresAt = contains(DateTimeField);
  @field realm = contains(StringField);
}

export class CreditPointsResult extends CardDef {
  @field transaction = linksTo(PointsTransaction);
  @field newBalance = contains(NumberField);
  @field message = contains(StringField);
}

/**
 * The single writer for a loyalty account's points. Appends one
 * PointsTransaction to the ledger and moves the account's maintained
 * numbers (`pointsBalance`, and `lifetimePoints` for earns) in the same
 * run — which is exactly why nothing else may assign them.
 *
 * The command takes the FINAL signed amount. Tier multipliers, promo
 * doublings and rounding are program arithmetic the caller does first
 * (`tierMultiplier` from the tier field helps); baking one program's rules
 * in here would make every other program's wrong.
 */
export default class CreditPointsCommand extends Command<
  typeof CreditPointsInput,
  typeof CreditPointsResult
> {
  static actionVerb = 'Credit Points';

  async getInputType() {
    return CreditPointsInput;
  }

  protected async run(input: CreditPointsInput): Promise<CreditPointsResult> {
    let { account, amount, reason, source, expiresAt, realm } = input;
    if (!account) throw new Error('A loyalty account is required');
    if (!realm) throw new Error('A realm is required');
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
      throw new Error('A non-zero points amount is required');
    }
    if (!Number.isInteger(amount)) {
      throw new Error('Points are whole numbers');
    }
    if (account.id) {
      account = (await new GetCardCommand(this.commandContext).execute({
        cardId: account.id,
      })) as LoyaltyAccount;
    }
    if (account.status === 'Closed') {
      throw new Error('A closed account cannot move points');
    }

    let balance = account.pointsBalance ?? 0;
    let newBalance = balance + amount;
    if (newBalance < 0) {
      throw new Error(
        `Insufficient points: balance is ${balance}, tried to deduct ${-amount}`,
      );
    }

    let save = async <T extends CardDef>(card: T): Promise<T> =>
      (await new SaveCardCommand(this.commandContext).execute({
        card,
        realm,
      } as any)) as T;

    let transaction = await save(
      new PointsTransaction({
        account,
        amount,
        reason,
        source,
        occurredAt: new Date(),
        expiresAt,
      }),
    );

    account.pointsBalance = newBalance;
    if (amount > 0) {
      account.lifetimePoints = (account.lifetimePoints ?? 0) + amount;
    }
    await save(account);

    let verb = amount > 0 ? 'Credited' : 'Deducted';
    return new CreditPointsResult({
      transaction,
      newBalance,
      message: `${verb} ${Math.abs(amount)} points${
        reason ? ` for ${reason}` : ''
      } — balance ${newBalance}`,
    });
  }
}
