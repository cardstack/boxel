// Pretui — FormatBytes usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { FormatBytes } from './format-bytes';
import { LOCALES, SPOKEN_MODES } from '../demo-reading-format';

// ── FormatBytes ──────────────────────────────────────────────────────────
const BYTE_BASES = ['binary', 'decimal'];

const BYTE_UNITS = ['byte', 'bit'];

const BYTE_DISPLAYS = ['short', 'narrow', 'long'];

// The page leads with the binary/decimal split because conflating them is
// the classic bytes bug — the same number renders two different ways and
// both are correct, which is exactly why it is a knob and never an
// assumption. The specimen ladder shows one value crossing every scale
// step, which is where an off-by-one-power error would show itself.
const BYTE_LADDER = [512, 8_192, 1_048_576, 734_003_200, 5_497_558_138_880];

class FormatBytesUsage extends Component {
  baseOptions = BYTE_BASES;
  unitOptions = BYTE_UNITS;
  displayOptions = BYTE_DISPLAYS;
  spokenOptions = SPOKEN_MODES;
  localeOptions = LOCALES;
  ladder = BYTE_LADDER;

  @tracked value = 734003200;
  @tracked base = 'binary';
  @tracked unit = 'byte';
  @tracked display = 'short';
  @tracked locale = 'en-US';
  @tracked maximumFractionDigits: number | null = 1;
  @tracked token = false;
  @tracked spoken = 'auto';

  setValue = (v: number | null) => (this.value = v ?? 0);
  setBase = (v: string) => (this.base = v);
  setUnit = (v: string) => (this.unit = v);
  setDisplay = (v: string) => (this.display = v);
  setLocale = (v: string) => (this.locale = v);
  setMaxFraction = (v: number | null) => (this.maximumFractionDigits = v);
  setToken = (v: boolean) => (this.token = v);
  setSpoken = (v: string) => (this.spoken = v);

  get baseVal() {
    return this.base as 'binary' | 'decimal';
  }
  get unitVal() {
    return this.unit as 'byte' | 'bit';
  }
  get displayVal() {
    return this.display as 'short' | 'narrow' | 'long';
  }
  get spokenVal() {
    return this.spoken as 'auto' | 'always' | 'off';
  }
  get maxFractionVal() {
    return this.maximumFractionDigits ?? undefined;
  }
  get otherBase() {
    return this.base === 'binary' ? 'decimal' : 'binary';
  }
  get otherBaseVal() {
    return this.otherBase as 'binary' | 'decimal';
  }
  get usage() {
    let bits = [`@value={{${this.value}}}`];
    if (this.base !== 'binary') bits.push(`@base='${this.base}'`);
    if (this.unit !== 'byte') bits.push(`@unit='${this.unit}'`);
    if (this.display !== 'short') bits.push(`@display='${this.display}'`);
    if (this.locale !== 'en-US') bits.push(`@locale='${this.locale}'`);
    if (this.maximumFractionDigits !== 1)
      bits.push(`@maximumFractionDigits={{${this.maximumFractionDigits}}}`);
    if (this.token) bits.push('@token={{true}}');
    if (this.spoken !== 'auto') bits.push(`@spoken='${this.spoken}'`);
    return `<FormatBytes ${bits.join(' ')} />`;
  }

  <template>
    <FreestyleUsage
      @name='FormatBytes'
      @description="Human-readable byte sizes. The binary/decimal split is the point: 734,003,200 bytes is either 700 MiB or 734 MB depending on which convention you mean, and both are right — so the base is a required decision rather than a silent default. Reach for it wherever a file, payload, or quota size appears in prose; wear @token in machine contexts like an artifact table. Sibling of RelativeTime and FormatNumber."
      @source={{this.usage}}
    >
      <:example>
        <div class='fmt-stack'>
          <p class='fmt-line'>
            The
            <em>Da Hong Pao</em>
            origin scan uploaded from Wuyishan is
            <FormatBytes
              @value={{this.value}}
              @base={{this.baseVal}}
              @unit={{this.unitVal}}
              @display={{this.displayVal}}
              @locale={{this.locale}}
              @maximumFractionDigits={{this.maxFractionVal}}
              @token={{this.token}}
              @spoken={{this.spokenVal}}
            />
            in the manifest.
          </p>

          <div class='fmt-compare'>
            <span class='fmt-cap'>{{this.base}}</span>
            <FormatBytes
              @value={{this.value}}
              @base={{this.baseVal}}
              @unit={{this.unitVal}}
              @display={{this.displayVal}}
              @locale={{this.locale}}
              @maximumFractionDigits={{this.maxFractionVal}}
            />
            <span class='fmt-cap'>{{this.otherBase}}</span>
            <FormatBytes
              @value={{this.value}}
              @base={{this.otherBaseVal}}
              @unit={{this.unitVal}}
              @display={{this.displayVal}}
              @locale={{this.locale}}
              @maximumFractionDigits={{this.maxFractionVal}}
            />
          </div>

          <ul class='fmt-ladder'>
            {{#each this.ladder as |step|}}
              <li>
                <FormatBytes
                  @value={{step}}
                  @base={{this.baseVal}}
                  @unit={{this.unitVal}}
                  @display={{this.displayVal}}
                  @locale={{this.locale}}
                  @maximumFractionDigits={{this.maxFractionVal}}
                />
              </li>
            {{/each}}
          </ul>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='value'
          @value={{this.value}}
          @min={{0}}
          @max={{5497558138880}}
          @description='The size, counted in bytes (or bits when @unit is bit). Strings are coerced; a non-finite value renders @placeholder instead of NaN.'
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='base'
          @defaultValue='binary'
          @value={{this.base}}
          @options={{this.baseOptions}}
          @description="binary = IEC, divide by 1024, KiB/MiB labels. decimal = SI, divide by 1000, kB/MB labels. Never inferred — conflating the two is the classic bytes bug."
          @onInput={{this.setBase}}
        />
        <Args.String
          @name='unit'
          @defaultValue='byte'
          @value={{this.unit}}
          @options={{this.unitOptions}}
          @description='What the raw number counts. bit is for throughput figures, where a factor of eight is a real defect.'
          @onInput={{this.setUnit}}
        />
        <Args.String
          @name='display'
          @defaultValue='short'
          @value={{this.display}}
          @options={{this.displayOptions}}
          @description='Unit wording: short (2.4 MB), narrow (2.4MB), long (2.4 megabytes). Decimal base only — binary always uses the IEC symbol.'
          @onInput={{this.setDisplay}}
        />
        <Args.String
          @name='locale'
          @value={{this.locale}}
          @options={{this.localeOptions}}
          @description='BCP-47 tag; omit for the runtime default. An unknown tag falls back rather than throwing.'
          @onInput={{this.setLocale}}
        />
        <Args.Number
          @name='maximumFractionDigits'
          @value={{this.maximumFractionDigits}}
          @min={{0}}
          @max={{4}}
          @description='Ceiling on fraction digits. Defaults to 0 for raw bytes and 1 once the value has been scaled.'
          @onInput={{this.setMaxFraction}}
        />
        <Args.Number
          @name='minimumFractionDigits'
          @defaultValue={{0}}
          @description='Floor on fraction digits — pin it to keep a column of sizes from jittering in width.'
        />
        <Args.Bool
          @name='token'
          @defaultValue={{false}}
          @value={{this.token}}
          @description='Wear the Token dress (Law 3) — mono and accent-tinted, for machine contexts rather than prose.'
          @onInput={{this.setToken}}
        />
        <Args.String
          @name='spoken'
          @defaultValue='auto'
          @value={{this.spoken}}
          @options={{this.spokenOptions}}
          @description='sr-only mirror policy. auto mirrors only when the visible text reads badly aloud (IEC symbols, narrow units); always forces it; off suppresses it.'
          @onInput={{this.setSpoken}}
        />
        <Args.String
          @name='placeholder'
          @defaultValue='—'
          @description='Rendered when the value is missing or non-finite. The component never emits NaN.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      /* Every value rides a token with a LIGHT fallback; no dark branch
         anywhere — the theme frame supplies the swap. */
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
      .fmt-compare {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: baseline;
        gap: var(--space-2, 6px) var(--space-3, 10px);
        padding: var(--space-3, 10px);
        border-radius: var(--radius-surface, 10px);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .fmt-ladder {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2, 6px) var(--space-4, 14px);
        margin: 0;
        padding: 0;
        list-style: none;
        font-variant-numeric: tabular-nums;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_FORMAT_BYTES: Record<string, unknown> = {
  FormatBytes: FormatBytesUsage,
};
