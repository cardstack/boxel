// Pretui — MoneyInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { amountAffixes, currencyUnit, describeAmount } from '../internal/money';
import { FreestyleUsage } from './freestyle-usage';
import { MoneyInput } from './money-input';
import { LOCALES, UNIT_MODES } from '../internal/money-fixtures';

const CODES = ['USD', 'EUR', 'GBP', 'JPY', 'BHD', 'INR', 'KRW'];
const AFFIX_MODES = ['auto', 'always', 'never'];

/** One row of the ladder — a currency, its symbol, where the symbol goes, and
 * how the same amount reads. */
interface LadderRow {
  code: string;
  mark: string;
  side: string;
  written: string;
}

function ladderFor(locale: string, amount: number): LadderRow[] {
  return CODES.map((code) => {
    let money = currencyUnit(code);
    let affix = amountAffixes(money, locale);
    return {
      code,
      mark: affix.prefix.length > 0 ? affix.prefix : affix.suffix,
      side: affix.prefix.length > 0 ? 'before' : 'after',
      written: describeAmount(amount, money, locale),
    };
  });
}

class MoneyInputUsage extends Component {
  @tracked locale = 'en-US';
  @tracked currency = 'USD';
  @tracked amount: number | undefined = 1234.5;
  @tracked unitControl: 'auto' | 'select' | 'segmented' | 'static' = 'auto';
  @tracked affix: 'auto' | 'always' | 'never' = 'auto';
  @tracked hint = '0.00';
  @tracked label = 'Price';
  @tracked quiet = false;
  @tracked disabled = false;
  @tracked emitted = 'Nothing emitted yet.';

  localeOptions = LOCALES;
  unitModeOptions = UNIT_MODES;
  affixOptions = AFFIX_MODES;
  currencyOptions = CODES;

  setLocale = (v: string) => (this.locale = v);
  setCurrency = (v: string) => (this.currency = v);
  setUnitControl = (v: string) =>
    (this.unitControl = v as 'auto' | 'select' | 'segmented' | 'static');
  setAffix = (v: string) => (this.affix = v as 'auto' | 'always' | 'never');
  setHint = (v: string) => (this.hint = v);
  setLabel = (v: string) => (this.label = v);
  setQuiet = (v: boolean) => (this.quiet = v);
  setDisabled = (v: boolean) => (this.disabled = v);

  take = (value: number | undefined, unit: string | undefined) => {
    this.amount = value;
    this.emitted =
      value === undefined
        ? 'onChange with undefined — nothing typed, which is not zero.'
        : 'onChange with ' + value + ' ' + (unit ?? '');
  };

  takeCurrency = (code: string) => (this.currency = code);

  get ladder(): LadderRow[] {
    return ladderFor(this.locale, this.amount ?? 1234.5);
  }

  get usage(): string {
    return (
      '<MoneyInput' +
      " @locale='" +
      this.locale +
      "'" +
      " @currency='" +
      this.currency +
      "'" +
      ' @value={{this.amount}} @onChange={{this.take}} />'
    );
  }

  <template>
    <FreestyleUsage
      @name='MoneyInput'
      @description='An amount and the currency it is denominated in, as ONE control. The symbol is placed by the locale, not pinned to the left — en-US writes the dollar sign before the number and de-DE writes the euro sign after it, from the same data. Fraction digits come from the currency, so yen never grows a decimal point. Paste anything: a grouped amount, a foreign-formatted one, an accounting negative in brackets.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-money-demo'>
          <MoneyInput
            @value={{this.amount}}
            @currency={{this.currency}}
            @locale={{this.locale}}
            @label={{this.label}}
            @hint={{this.hint}}
            @quiet={{this.quiet}}
            @disabled={{this.disabled}}
            @unitControl={{this.unitControl}}
            @affix={{this.affix}}
            @onChange={{this.take}}
            @onUnitChange={{this.takeCurrency}}
          />
          <p class='pretui-money-demo-note'>{{this.emitted}}</p>

          <p class='pretui-money-demo-cap'>The same amount, seven currencies,
            one locale</p>
          <ul class='pretui-money-ladder'>
            {{#each this.ladder key='code' as |row|}}
              <li class='pretui-money-ladder-row'>
                <span class='pretui-money-ladder-code'>{{row.code}}</span>
                <span class='pretui-money-ladder-mark'>{{row.mark}}</span>
                <span class='pretui-money-ladder-side'>{{row.side}}</span>
                <span class='pretui-money-ladder-written'>{{row.written}}</span>
              </li>
            {{/each}}
          </ul>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='locale'
          @value={{this.locale}}
          @options={{this.localeOptions}}
          @defaultValue='en-US'
          @description='BCP-47 tag deciding separators, symbol placement and the spelled-out readout. Move it and every row of the ladder below moves with it.'
          @onInput={{this.setLocale}}
        />
        <Args.String
          @name='currency'
          @value={{this.currency}}
          @options={{this.currencyOptions}}
          @description='ISO 4217 code, controlled. JPY and KRW carry no minor unit and BHD carries three — switching between them re-rounds the amount rather than carrying a fraction the currency cannot write.'
          @onInput={{this.setCurrency}}
        />
        <Args.String
          @name='unitControl'
          @value={{this.unitControl}}
          @options={{this.unitModeOptions}}
          @defaultValue='auto'
          @description='auto segments three or fewer choices and drops to a searchable select above that. static renders the code as a mark with nothing to pick.'
          @onInput={{this.setUnitControl}}
        />
        <Args.String
          @name='affix'
          @value={{this.affix}}
          @options={{this.affixOptions}}
          @defaultValue='auto'
          @description='auto draws the symbol only for currencies, where the symbol and the code are different things. never suppresses it; always draws whatever mark the unit carries.'
          @onInput={{this.setAffix}}
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='Amount'
          @description='The accessible name. Ignored when a Field wrapper supplied a controlId, because then a real label element already points at the box.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='hint'
          @value={{this.hint}}
          @description='Ghost text drawn behind an empty box. Deliberately not a placeholder attribute — a placeholder doubles as the accessible name, so a field named by its placeholder loses its name the moment you type.'
          @onInput={{this.setHint}}
        />
        <Args.Bool
          @name='quiet'
          @value={{this.quiet}}
          @defaultValue={{false}}
          @description='Suppress the spelled-out confirmation row. The row is reserved space either way, so turning it off does not change the height.'
          @onInput={{this.setQuiet}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @defaultValue={{false}}
          @description='Dimmed and inert.'
          @onInput={{this.setDisabled}}
        />
        <Args.Base
          @name='value / defaultValue'
          @typeLabel='Number'
          @description='The amount. Controlled through value, uncontrolled through defaultValue — the hybrid Select uses. An empty box reports undefined, never 0: nothing and zero are different facts.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='min / max / step / precision'
          @typeLabel='Number'
          @description='Range and grain. The range is REPORTED while typing and CLAMPED only on commit, because a reader typing 120 into a box with a minimum of 10 passes through 1 on the way.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='currencies'
          @typeLabel='AmountUnit[]'
          @description='The offered codes; defaults to the shipped working set. Pass a shorter list when a product only trades in three.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onChange'
          @description='Fires on every keystroke with the parsed amount and the current currency, together — so a caller can never half-apply an edit.'
        />
        <Args.Action
          @name='onUnitChange'
          @description='Fires when the currency changes. The amount is re-reported through onChange in the same turn, rounded to the new minor unit.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-amount-mark-width'
          @type='length'
          @defaultValue='1.25ch'
          @description='Reserved width for the symbol, so swapping USD for EUR moves the glyph and nothing else.'
        />
        <Css.Basic
          @name='pretui-amount-align'
          @type='keyword'
          @defaultValue='end'
          @description='Text alignment inside the box. Amounts align right so a column of them lines up on the decimal.'
        />
        <Css.Basic
          @name='pretui-amount-select-width'
          @type='length'
          @defaultValue='7.5rem'
          @description='Minimum width of the searchable unit picker.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-money-demo {
        display: grid;
        gap: var(--space-3, 8px);
        max-width: 420px;
      }
      .pretui-money-demo-note {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
        min-height: 1.4em;
      }
      .pretui-money-demo-cap {
        margin: var(--space-3, 8px) 0 0;
        font-size: var(--text-ui-xs, 10.5px);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-money-ladder {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 2px;
      }
      .pretui-money-ladder-row {
        display: grid;
        grid-template-columns: 3.2rem 1.6rem 3.4rem 1fr;
        align-items: baseline;
        gap: var(--space-2, 6px);
        padding: 3px 0;
        font-size: var(--text-ui-sm, 11.5px);
        font-variant-numeric: tabular-nums;
      }
      .pretui-money-ladder-code {
        font-family: var(--font-mono);
        color: var(--muted-foreground);
      }
      .pretui-money-ladder-mark {
        text-align: center;
        color: var(--foreground);
      }
      .pretui-money-ladder-side {
        font-size: var(--text-ui-xs, 10.5px);
        color: var(--muted-foreground);
      }
      .pretui-money-ladder-written {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--foreground);
      }
    </style>
  </template>
}

export const DEMOS_MONEY_INPUT: Record<string, unknown> = {
  MoneyInput: MoneyInputUsage,
};
