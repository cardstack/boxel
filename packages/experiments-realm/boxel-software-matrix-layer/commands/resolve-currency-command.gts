import {
  CardDef,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import DateField from '@cardstack/base/date';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';

import { CurrencyRegistry, rateAgeDays } from '../currency-registry';

// Resolve Currency — converts an amount through the registry's dated rates,
// and REFUSES on a stale or missing rate instead of guessing: a match panel
// comparing money across currencies must never silently use last quarter's
// rate. Read-only; the result names the exact rate row used (value, as-of
// date, source) so the conversion is auditable.

export class ResolveCurrencyInput extends CardDef {
  @field amount = contains(NumberField);
  @field fromCurrency = contains(StringField, {
    description: 'ISO code of the amount, e.g. EUR',
  });
  @field registry = linksTo(() => CurrencyRegistry, { searchable: true });
  @field asOf = contains(DateField, {
    description: 'Staleness is judged from this date (default: today)',
  });
}

export class ResolveCurrencyResult extends CardDef {
  @field convertedAmount = contains(NumberField);
  @field toCurrency = contains(StringField);
  @field rateUsed = contains(NumberField);
  @field rateAsOf = contains(DateField);
  @field rateSource = contains(StringField);
  @field message = contains(StringField);
}

export default class ResolveCurrencyCommand extends Command<
  typeof ResolveCurrencyInput,
  typeof ResolveCurrencyResult
> {
  static actionVerb = 'Resolve';
  static displayName = 'Resolve Currency';

  async getInputType() {
    return ResolveCurrencyInput;
  }

  protected async run(
    input: ResolveCurrencyInput,
  ): Promise<ResolveCurrencyResult> {
    let { amount, fromCurrency, registry, asOf } = input;
    if (amount == null) {
      throw new Error('An amount is required');
    }
    let from = fromCurrency?.trim()?.toUpperCase();
    if (!from) {
      throw new Error('A source currency code is required');
    }
    if (!registry) {
      throw new Error('A currency registry is required');
    }
    if (registry.id) {
      registry = (await new GetCardCommand(this.commandContext).execute({
        cardId: registry.id,
      })) as CurrencyRegistry;
    }
    let base = registry.baseCurrency?.trim()?.toUpperCase();
    if (!base) {
      throw new Error('The registry has no base currency set');
    }

    if (from === base) {
      return new ResolveCurrencyResult({
        convertedAmount: amount,
        toCurrency: base,
        rateUsed: 1,
        message: `${from} is the base currency — no conversion needed.`,
      });
    }

    let row = (registry.rates ?? [])
      .filter(Boolean)
      .filter((r) => r.currency?.trim()?.toUpperCase() === from)
      .sort((a, b) => (b.asOf?.getTime() ?? 0) - (a.asOf?.getTime() ?? 0))[0];
    if (!row || row.rate == null) {
      throw new Error(
        `No ${from}→${base} rate in the registry — record one before converting (refusing beats guessing)`,
      );
    }

    let judgedFrom = asOf ?? new Date();
    let age = rateAgeDays(row.asOf, judgedFrom);
    let staleAfter = registry.staleAfterDays ?? 30;
    if (age > staleAfter) {
      throw new Error(
        `The ${from} rate is ${age} days old (policy: ${staleAfter}) — refresh the registry instead of converting on a stale rate`,
      );
    }

    let converted = Math.round(amount * row.rate * 100) / 100;
    return new ResolveCurrencyResult({
      convertedAmount: converted,
      toCurrency: base,
      rateUsed: row.rate,
      rateAsOf: row.asOf,
      rateSource: row.source,
      message: `${amount} ${from} = ${converted} ${base} @ ${row.rate} (${row.source ?? 'unsourced'}, ${age}d old)`,
    });
  }
}
