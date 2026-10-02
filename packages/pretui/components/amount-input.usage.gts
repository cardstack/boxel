// Pretui — AmountInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { MASS_UNITS, currencyUnit, describeAmount } from '../internal/money';
import type { AmountUnit } from '../internal/money';
import { AmountInput } from './amount-input';
import { FreestyleUsage } from './freestyle-usage';
import { LOCALES, UNIT_MODES } from '../internal/money-fixtures';

/** Three currencies, so the segmented form has something to segment. */
const SHORT_LIST: AmountUnit[] = [
  currencyUnit('USD', 'US Dollar'),
  currencyUnit('EUR', 'Euro'),
  currencyUnit('JPY', 'Japanese Yen'),
];

/** A unit list `Intl` has never heard of — the case that proves the control is
 * not secretly a currency control. */
const COUNT_UNITS: AmountUnit[] = [
  { value: 'seat', label: 'seats', fractionDigits: 0, step: 1 },
  { value: 'box', label: 'boxes', fractionDigits: 0, step: 1 },
  { value: 'pallet', label: 'pallets', fractionDigits: 0, step: 1 },
];

class AmountInputUsage extends Component {
  @tracked locale = 'en-US';
  @tracked family = 'mass';
  @tracked unit = 'kilogram';
  @tracked amount: number | undefined = 2.5;
  @tracked unitControl: 'auto' | 'select' | 'segmented' | 'static' = 'auto';
  @tracked emitted = 'Nothing emitted yet.';

  localeOptions = LOCALES;
  familyOptions = ['mass', 'count', 'currency'];
  unitModeOptions = UNIT_MODES;

  setLocale = (v: string) => (this.locale = v);
  setUnitControl = (v: string) =>
    (this.unitControl = v as 'auto' | 'select' | 'segmented' | 'static');
  setFamily = (v: string) => {
    this.family = v;
    this.unit = this.units[0]?.value ?? '';
  };

  get units(): AmountUnit[] {
    if (this.family === 'count') {
      return COUNT_UNITS;
    }
    if (this.family === 'currency') {
      return SHORT_LIST;
    }
    return MASS_UNITS;
  }

  take = (value: number | undefined, unit: string | undefined) => {
    this.amount = value;
    this.emitted =
      value === undefined
        ? 'onChange with undefined'
        : 'onChange with ' + value + ' ' + (unit ?? '');
  };
  takeUnit = (next: string) => (this.unit = next);

  get spelled(): string {
    let chosen = this.units.find((u) => u.value === this.unit);
    return describeAmount(this.amount, chosen, this.locale);
  }

  get usage(): string {
    return (
      '<AmountInput @units={{this.units}}' +
      " @unit='" +
      this.unit +
      "'" +
      ' @value={{this.amount}} @onChange={{this.take}} />'
    );
  }

  <template>
    <FreestyleUsage
      @name='AmountInput'
      @description='The general form: an amount paired with a unit, where the unit decides the formatting. A CLDR unit gets Intl unit formatting and long-form words in the readout; a unit Intl has never heard of — seats, boxes, story points — gets a plain grouped number and its own label. MoneyInput is this component with the ISO list pre-loaded, not a fork of it.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-amount-demo'>
          <AmountInput
            @value={{this.amount}}
            @unit={{this.unit}}
            @units={{this.units}}
            @locale={{this.locale}}
            @label='Quantity'
            @unitLabel='Unit'
            @unitControl={{this.unitControl}}
            @onChange={{this.take}}
            @onUnitChange={{this.takeUnit}}
          />
          <p class='pretui-amount-demo-note'>{{this.emitted}}</p>
          <p class='pretui-amount-demo-spelled'>{{this.spelled}}</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='units'
          @value={{this.family}}
          @options={{this.familyOptions}}
          @description='Three families to switch between here — CLDR mass units, plain counts Intl has never heard of, and three currencies. The control adapts to all three without a mode flag.'
          @onInput={{this.setFamily}}
        />
        <Args.String
          @name='locale'
          @value={{this.locale}}
          @options={{this.localeOptions}}
          @defaultValue='en-US'
          @description='Separators, symbol placement and the long-form readout.'
          @onInput={{this.setLocale}}
        />
        <Args.String
          @name='unitControl'
          @value={{this.unitControl}}
          @options={{this.unitModeOptions}}
          @defaultValue='auto'
          @description='auto segments three or fewer units and selects above that. One unit renders as a static mark, because nothing to choose means nothing to choose from.'
          @onInput={{this.setUnitControl}}
        />
        <Args.Base
          @name='unit / defaultUnit'
          @typeLabel='String'
          @description='The current unit token, controlled or seeded. Switching units re-rounds the amount to the new precision in the same turn.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='AmountUnit'
          @typeLabel='Interface'
          @description='value, label, and at most one of currency (ISO 4217), unit (CLDR id) or symbol (a literal mark). Plus fractionDigits, step and search text for the picker.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onChange'
          @description='The parsed amount and the unit, together.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-amount-demo {
        display: grid;
        gap: var(--space-3, 8px);
        max-width: 420px;
      }
      .pretui-amount-demo-note {
        margin: 0;
        min-height: 1.4em;
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .pretui-amount-demo-spelled {
        margin: 0;
        min-height: 1.4em;
        font-size: var(--text-ui-md, 13px);
        font-variant-numeric: tabular-nums;
        color: var(--foreground);
      }
    </style>
  </template>
}

export const DEMOS_AMOUNT_INPUT: Record<string, unknown> = {
  AmountInput: AmountInputUsage,
};
