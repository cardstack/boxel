// Pretui — MoneyInput: an AmountInput with a currency chooser.
import Component from '@glimmer/component';
import { AmountInput } from './amount-input';
import type { AmountInputSignature } from './amount-input';
import { CURRENCIES } from '../internal/money';
import type { AmountUnit } from '../internal/money';

export interface MoneyInputSignature {
  Args: Omit<AmountInputSignature['Args'], 'units' | 'unit' | 'defaultUnit'> & {
    /** ISO 4217 code, controlled */
    currency?: string;
    /** uncontrolled seed; `USD` when the list is the default one */
    defaultCurrency?: string;
    /** the offered codes. Defaults to `CURRENCIES`; pass a shorter list when a
     * product only trades in three. */
    currencies?: AmountUnit[];
  };
  Element: HTMLDivElement;
}

/**
 * `AmountInput` curried for money — the wrap-and-curry idiom, not a fork.
 *
 * Everything currency-specific already lives in the general control (fraction
 * digits from the code, symbol placed by the locale, the spelled-out
 * readout); this supplies the list and renames `unit` to `currency` so the
 * caller's vocabulary matches their data.
 */
export class MoneyInput extends Component<MoneyInputSignature> {
  get currencies(): AmountUnit[] {
    return this.args.currencies ?? CURRENCIES;
  }

  get defaultCurrency(): string | undefined {
    return this.args.defaultCurrency ?? this.currencies[0]?.value;
  }

  <template>
    <AmountInput
      @value={{@value}}
      @defaultValue={{@defaultValue}}
      @unit={{@currency}}
      @defaultUnit={{this.defaultCurrency}}
      @units={{this.currencies}}
      @locale={{@locale}}
      @precision={{@precision}}
      @min={{@min}}
      @max={{@max}}
      @step={{@step}}
      @disabled={{@disabled}}
      @invalid={{@invalid}}
      @required={{@required}}
      @controlId={{@controlId}}
      @label={{@label}}
      @hint={{@hint}}
      @unitLabel={{if @unitLabel @unitLabel 'Currency'}}
      @affix={{@affix}}
      @unitControl={{@unitControl}}
      @quiet={{@quiet}}
      @onChange={{@onChange}}
      @onUnitChange={{@onUnitChange}}
      data-test-pretui-money
      ...attributes
    />
  </template>
}
