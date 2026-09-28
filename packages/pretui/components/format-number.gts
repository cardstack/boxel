// Pretui — FormatNumber: a number, percent, currency or unit through Intl.
import Component from '@glimmer/component';
import { FormattedValue } from './formatted-value';
import { defined, formatNumber, toNumber } from '../internal/reading-format';
import type { FormatOptionBag } from '../internal/reading-format';

// ── FormatNumber ← wa-format-number ──────────────────────────────────────
// Better than the inspiration: the whole Intl.NumberFormat surface is named
// and separately settable (Law 7) with `@options` as the escape hatch for
// anything not named; `style: 'currency'` with no currency (and `'unit'` with
// no unit) degrades to a decimal instead of throwing; and compact/scientific
// notation keeps its full-precision value for a screen reader — '1.2M' is
// visible, '1,234,567' is spoken.
export interface FormatNumberSignature {
  Args: {
    /** the number to render (strings are coerced; anything non-finite renders @placeholder) */
    value?: number | string;
    /** BCP-47 locale tag; omit for the runtime default. An unknown tag falls back rather than throwing. */
    locale?: string;
    /** 'decimal' (default), 'currency', 'percent' (value 0.42 → 42%), or 'unit' */
    style?: 'decimal' | 'currency' | 'percent' | 'unit';
    /** ISO 4217 code, required by style='currency'; without it the style degrades to decimal instead of throwing */
    currency?: string;
    /** how the currency is written */
    currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code' | 'name';
    /** how negative currency amounts are marked */
    currencySign?: 'standard' | 'accounting';
    /** CLDR unit identifier for style='unit', e.g. 'kilogram' or 'kilogram-per-hour' */
    unit?: string;
    /** unit wording for style='unit' */
    unitDisplay?: 'short' | 'narrow' | 'long';
    /** 'standard' (default), 'compact' (1.2M), 'scientific', 'engineering' */
    notation?: 'standard' | 'compact' | 'scientific' | 'engineering';
    /** compact wording: 'short' (1.2M) or 'long' (1.2 million) */
    compactDisplay?: 'short' | 'long';
    /** when the sign is shown */
    signDisplay?: 'auto' | 'never' | 'always' | 'exceptZero' | 'negative';
    /** grouping separators: true/false, or 'always' | 'auto' | 'min2' */
    useGrouping?: boolean | 'always' | 'auto' | 'min2';
    /** pad the integer part to at least this many digits */
    minimumIntegerDigits?: number;
    /** floor on fraction digits */
    minimumFractionDigits?: number;
    /** ceiling on fraction digits */
    maximumFractionDigits?: number;
    /** floor on significant digits (wins over fraction digits) */
    minimumSignificantDigits?: number;
    /** ceiling on significant digits (wins over fraction digits) */
    maximumSignificantDigits?: number;
    /** digit system, e.g. 'deva' */
    numberingSystem?: string;
    /** any Intl.NumberFormat option not named above; named knobs win over it */
    options?: FormatOptionBag;
    /** wear the Token dress (Law 3) — for machine contexts like a parameter row */
    token?: boolean;
    /** sr-only mirror policy: 'auto' mirrors whenever the visible text is abbreviated (compact/scientific/engineering notation), 'always' forces it, 'off' suppresses it */
    spoken?: 'auto' | 'always' | 'off';
    /** rendered when the value is missing or not a finite number (default '—') */
    placeholder?: string;
  };
  Element: HTMLSpanElement;
}

export class FormatNumber extends Component<FormatNumberSignature> {
  get num(): number | undefined {
    return toNumber(this.args.value);
  }
  get options(): FormatOptionBag {
    let a = this.args;
    return defined({
      ...(a.options ?? {}),
      style: a.style,
      currency: a.currency,
      currencyDisplay: a.currencyDisplay,
      currencySign: a.currencySign,
      unit: a.unit,
      unitDisplay: a.unitDisplay,
      notation: a.notation,
      compactDisplay: a.compactDisplay,
      signDisplay: a.signDisplay,
      useGrouping: a.useGrouping,
      minimumIntegerDigits: a.minimumIntegerDigits,
      minimumFractionDigits: a.minimumFractionDigits,
      maximumFractionDigits: a.maximumFractionDigits,
      minimumSignificantDigits: a.minimumSignificantDigits,
      maximumSignificantDigits: a.maximumSignificantDigits,
      numberingSystem: a.numberingSystem,
    });
  }
  get text(): string {
    let n = this.num;
    if (n === undefined) {
      return this.args.placeholder ?? '—';
    }
    return formatNumber(n, this.args.locale, this.options);
  }
  get abbreviated(): boolean {
    let notation = this.options['notation'];
    return (
      notation === 'compact' ||
      notation === 'scientific' ||
      notation === 'engineering'
    );
  }
  get spoken(): string | undefined {
    let mode = this.args.spoken ?? 'auto';
    let n = this.num;
    if (mode === 'off' || n === undefined) {
      return undefined;
    }
    if (mode !== 'always' && !this.abbreviated) {
      return undefined;
    }
    // Full precision: same currency/unit dress, standard notation, grouped.
    let bag: FormatOptionBag = { ...this.options };
    delete bag['notation'];
    delete bag['compactDisplay'];
    delete bag['maximumFractionDigits'];
    delete bag['minimumFractionDigits'];
    delete bag['maximumSignificantDigits'];
    delete bag['minimumSignificantDigits'];
    let full = formatNumber(n, this.args.locale, bag);
    return full === this.text ? undefined : full;
  }
  get isEmpty(): boolean {
    return this.num === undefined;
  }
  <template>
    <FormattedValue
      @text={{this.text}}
      @spoken={{this.spoken}}
      @token={{@token}}
      @empty={{this.isEmpty}}
      data-test-pretui-format-number
      ...attributes
    />
  </template>
}
