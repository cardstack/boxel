// Pretui — FormatNumber usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { FormatNumber } from './format-number';
import { LOCALES, NOTATIONS, NUMBER_STYLES, SPOKEN_MODES } from '../demo-reading-format';

// ── FormatNumber ─────────────────────────────────────────────────────────
const SIGN_DISPLAYS = ['auto', 'never', 'always', 'exceptZero', 'negative'];

// The accessibility case worth reading: compact notation abbreviates
// 1,234,567 to 1.2M, and an abbreviation is a LOSS for a screen reader.
// @spoken='auto' therefore mirrors the full-precision value whenever the
// visible text is abbreviated, which is what makes compact notation safe
// to use at all.
class FormatNumberUsage extends Component {
  styleOptions = NUMBER_STYLES;
  notationOptions = NOTATIONS;
  signOptions = SIGN_DISPLAYS;
  localeOptions = LOCALES;
  spokenOptions = SPOKEN_MODES;

  @tracked value = 1234567.891;
  @tracked style = 'currency';
  @tracked currency = 'USD';
  @tracked notation = 'standard';
  @tracked locale = 'en-US';
  @tracked signDisplay = 'auto';
  @tracked maximumFractionDigits: number | null = 2;
  @tracked token = false;
  @tracked spoken = 'auto';

  setValue = (v: number | null) => (this.value = v ?? 0);
  setStyle = (v: string) => (this.style = v);
  setCurrency = (v: string) => (this.currency = v);
  setNotation = (v: string) => (this.notation = v);
  setLocale = (v: string) => (this.locale = v);
  setSignDisplay = (v: string) => (this.signDisplay = v);
  setMaxFraction = (v: number | null) => (this.maximumFractionDigits = v);
  setToken = (v: boolean) => (this.token = v);
  setSpoken = (v: string) => (this.spoken = v);

  get styleVal() {
    return this.style as 'decimal' | 'currency' | 'percent' | 'unit';
  }
  get notationVal() {
    return this.notation as
      | 'standard'
      | 'compact'
      | 'scientific'
      | 'engineering';
  }
  get signVal() {
    return this.signDisplay as
      | 'auto'
      | 'never'
      | 'always'
      | 'exceptZero'
      | 'negative';
  }
  get spokenVal() {
    return this.spoken as 'auto' | 'always' | 'off';
  }
  get maxFractionVal() {
    return this.maximumFractionDigits ?? undefined;
  }
  get unitVal() {
    return this.style === 'unit' ? 'kilogram' : undefined;
  }
  get usage() {
    let bits = [`@value={{${this.value}}}`];
    if (this.style !== 'decimal') bits.push(`@style='${this.style}'`);
    if (this.style === 'currency') bits.push(`@currency='${this.currency}'`);
    if (this.style === 'unit') bits.push("@unit='kilogram'");
    if (this.notation !== 'standard') bits.push(`@notation='${this.notation}'`);
    if (this.locale !== 'en-US') bits.push(`@locale='${this.locale}'`);
    if (this.signDisplay !== 'auto')
      bits.push(`@signDisplay='${this.signDisplay}'`);
    if (this.token) bits.push('@token={{true}}');
    return `<FormatNumber ${bits.join(' ')} />`;
  }

  <template>
    <FreestyleUsage
      @name='FormatNumber'
      @description="Locale-aware numbers, currency, percentages, and units over Intl.NumberFormat, with the whole option surface exposed as separately-settable knobs rather than the two or three most libraries stop at. Every numeral sets tabular-nums so a column of them stays in register (Law 8). Compact notation abbreviates — and abbreviation loses information — so @spoken mirrors the full-precision value to assistive tech whenever the visible text is shortened."
      @source={{this.usage}}
    >
      <:example>
        <div class='fmt-stack'>
          <p class='fmt-line'>
            <em>Silver Peak Trading</em>
            settled the season at
            <FormatNumber
              @value={{this.value}}
              @style={{this.styleVal}}
              @currency={{this.currency}}
              @unit={{this.unitVal}}
              @notation={{this.notationVal}}
              @locale={{this.locale}}
              @signDisplay={{this.signVal}}
              @maximumFractionDigits={{this.maxFractionVal}}
              @token={{this.token}}
              @spoken={{this.spokenVal}}
            />
            across all lots.
          </p>

          <div class='fmt-grid'>
            {{#each this.notationOptions as |note|}}
              <div class='fmt-cell'>
                <span class='fmt-cap'>{{note}}</span>
                <FormatNumber
                  @value={{this.value}}
                  @style={{this.styleVal}}
                  @currency={{this.currency}}
                  @unit={{this.unitVal}}
                  @notation={{note}}
                  @locale={{this.locale}}
                  @maximumFractionDigits={{this.maxFractionVal}}
                />
              </div>
            {{/each}}
          </div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='value'
          @value={{this.value}}
          @description='The number. Strings are coerced; anything non-finite renders @placeholder rather than NaN.'
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='style'
          @defaultValue='decimal'
          @value={{this.style}}
          @options={{this.styleOptions}}
          @description='decimal, currency, percent (0.42 renders 42%), or unit.'
          @onInput={{this.setStyle}}
        />
        <Args.String
          @name='currency'
          @value={{this.currency}}
          @description='ISO 4217 code, required by style=currency. Without it the style degrades to decimal instead of throwing.'
          @onInput={{this.setCurrency}}
        />
        <Args.String
          @name='notation'
          @defaultValue='standard'
          @value={{this.notation}}
          @options={{this.notationOptions}}
          @description='standard, compact (1.2M), scientific, or engineering. Compact is an abbreviation, so it triggers the sr-only full-precision mirror.'
          @onInput={{this.setNotation}}
        />
        <Args.String
          @name='signDisplay'
          @defaultValue='auto'
          @value={{this.signDisplay}}
          @options={{this.signOptions}}
          @description='When the sign is shown. exceptZero is the one you want for deltas.'
          @onInput={{this.setSignDisplay}}
        />
        <Args.String
          @name='locale'
          @value={{this.locale}}
          @options={{this.localeOptions}}
          @description='BCP-47 tag; omit for the runtime default. hi-IN groups in lakhs, de-DE swaps separators, ar-EG changes the digits.'
          @onInput={{this.setLocale}}
        />
        <Args.Number
          @name='maximumFractionDigits'
          @value={{this.maximumFractionDigits}}
          @min={{0}}
          @max={{6}}
          @description='Ceiling on fraction digits. Significant-digit knobs win over the fraction-digit ones.'
          @onInput={{this.setMaxFraction}}
        />
        <Args.Bool
          @name='token'
          @defaultValue={{false}}
          @value={{this.token}}
          @description='Wear the Token dress (Law 3) — for parameter rows and machine contexts.'
          @onInput={{this.setToken}}
        />
        <Args.String
          @name='spoken'
          @defaultValue='auto'
          @value={{this.spoken}}
          @options={{this.spokenOptions}}
          @description='sr-only mirror policy. auto mirrors whenever the visible text is abbreviated, so 1.2M does not cost a screen-reader user the real figure.'
          @onInput={{this.setSpoken}}
        />
        <Args.String
          @name='currencyDisplay, currencySign, unit, unitDisplay, compactDisplay'
          @description='Wording controls: symbol/narrowSymbol/code/name, accounting negatives, the CLDR unit id, and short/long compact words.'
        />
        <Args.String
          @name='useGrouping, minimumIntegerDigits, minimum/maximumSignificantDigits, numberingSystem'
          @description='Grouping policy, integer padding, significant-digit bounds, and the digit system.'
        />
        <Args.Object
          @name='options'
          @description='Escape hatch for any Intl.NumberFormat option not named above. Named knobs win over it.'
        />
        <Args.String
          @name='placeholder'
          @defaultValue='—'
          @description='Rendered when the value is missing or non-finite.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .fmt-stack {
        display: flex;
        flex-direction: column;
        gap: var(--space-4, 14px);
      }
      .fmt-line {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        line-height: 1.6;
        color: var(--foreground);
      }
      .fmt-line em {
        font-style: normal;
        font-weight: 600;
      }
      .fmt-cap {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        letter-spacing: var(--track-eyebrow, 0.06em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .fmt-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: var(--space-3, 10px);
      }
      .fmt-cell {
        display: flex;
        flex-direction: column;
        gap: var(--space-1, 4px);
        padding: var(--space-3, 10px);
        border-radius: var(--radius-surface, 10px);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        font-size: var(--text-ui-md, 12.5px);
        color: var(--foreground);
      }
    </style>
  </template>
}

export const DEMOS_FORMAT_NUMBER: Record<string, unknown> = {
  FormatNumber: FormatNumberUsage,
};
