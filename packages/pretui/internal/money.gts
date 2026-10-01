// Pretui — CONTROLS territory: AmountInput and MoneyInput.
//
// A number that is meaningless without the thing it counts. £42 and 42 kg and
// 42% are three different facts and none of them is the number 42, so the
// amount and its unit are ONE control with one accessible name, not a number
// field sitting next to an unrelated dropdown.
//
// `AmountInput` is the general control: an amount, a unit chosen from a list,
// and formatting derived from whichever unit is current. `MoneyInput` is the
// currency curry of it (the Tag-wraps-Pill idiom) — same component, the ISO
// 4217 list pre-loaded and currency semantics switched on.
//
// ── What this is NOT ────────────────────────────────────────────────────
//
// Not a second `NumberInput` and not a second `Stepper`.
// Reach for those when the number stands alone. Not a `FieldDef` either: this
// is the component layer a field wrapper consumes — `@value` in, `@onChange`
// out, no card model anywhere.
//
// ── Better than the inspiration ─────────────────────────────────────────
//
// The source this was distilled from (a vibe-coded `amount-with-currency`
// field over a `currency` field) got the SHAPE right — one input group, symbol
// affix, searchable currency picker — and then:
//
//  1. **Rebuilt the composite on every keystroke without copying the
//     currency**, so typing an amount silently reset the currency to USD.
//     Here the amount and the unit are separate tracked values that never
//     touch each other, and `@onChange` reports both together so a caller
//     cannot half-apply an edit.
//  2. **Fetched the entire currency table from a CDN at edit time**
//     (`esm.run/currency-code-symbol-map`). Law 9 forbids that outright, and
//     it is unnecessary: `Intl` already knows every symbol, every fraction
//     digit and — the part nobody uses — WHICH SIDE OF THE NUMBER the symbol
//     goes on in the reader's locale. `$1,234.50` in `en-US`, `1.234,50 €` in
//     `de-DE`, from the same data, with no table.
//  3. **Hard-locked the thousands separator to `en-US`** and rendered an
//     empty amount as `0`, so a field could never be blanked and a European
//     reader was shown American punctuation for euros.
//  4. **Only ever accepted the exact digits it printed.** Here a paste of
//     `$1,234.50`, `1 234,50 €`, `(1,234.50)` (accounting negative), `1.234,50`
//     or Arabic-indic digits all parse, because a reader who pasted a number
//     from a spreadsheet has communicated it perfectly well.
//  5. **Never showed the number back.** Two currencies share `$`; a bare `$`
//     affix is genuinely ambiguous. The confirmation line spells the unit out
//     in words (`1,234.50 US dollars`), which is the one readout that removes
//     the ambiguity, and it is reserved space so nothing jitters.
//
// ── Determinism ─────────────────────────────────────────────────────────
//
// Nothing here reads the clock or `Math.random()`. `Intl` is queried with
// fixed probe numbers so the same locale asks the same question on every
// render and in every index pass.
//
// Every component here lives in its own module under components/; this
// module re-exports them so existing imports keep working.
//
// (the money group)

// Pretui — the amount engine shared by AmountInput and MoneyInput: parsing, formatting and units.

// ═══════════════════════════════════════════════════════════════════════
// The pure layer. No DOM, no clock, no component state.
// Unit-tested in controls-money.test.gts
// ═══════════════════════════════════════════════════════════════════════

/**
 * One choice in the unit control.
 *
 * Exactly one of `currency` / `unit` / `symbol` decides how amounts are
 * written; with none of them the amount is a plain decimal and the unit is
 * label-only (which is the right answer for `boxes`, `seats`, `story points`
 * and everything else CLDR has never heard of).
 */
export interface AmountUnit {
  /** the token the caller stores — an ISO 4217 code, a CLDR unit id, or any
   * string of the caller's own */
  value: string;
  /** what the unit control shows */
  label: string;
  /** ISO 4217 code; switches on currency formatting, the fraction-digit
   * default, and the locale-placed symbol affix */
  currency?: string;
  /** CLDR unit identifier (`kilogram`, `kilometer-per-hour`); switches on
   * `Intl` unit formatting */
  unit?: string;
  /** a literal affix for units `Intl` does not know (`pt`, `req/s`) */
  symbol?: string;
  /** decimal places this unit commits to; wins over `@precision` and over the
   * currency default */
  fractionDigits?: number;
  /** keyboard step for this unit */
  step?: number;
  /** extra words the unit picker's search should match (a currency's country,
   * a unit's plural) */
  search?: string;
}

/** A fixed probe. Constant so the separator question is asked identically on
 * every render — a probe built from the value would ask a different question
 * for `0.5` than for `12345.6`. */
const SEPARATOR_PROBE = 12345.6;

/** Non-latin digit blocks folded on input, beyond whatever the locale itself
 * declares. These five cover the digit sets a reader is realistically pasting
 * from; the locale-derived map below catches the rest. */
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x0e50, 0xff10];

/** Spaces that appear as group separators and are not the space key:
 * NO-BREAK, NARROW NO-BREAK, THIN. */
const GROUP_SPACES = /[\u00a0\u202f\u2009]/g;

/**
 * What a locale writes between thousands and before decimals.
 *
 * Asked of `Intl` rather than kept as a table, so a locale nobody thought
 * about still parses. Falls back to the anglophone pair when the tag is
 * malformed — a caller's typo is not a reason to render nothing.
 */
export function separatorsFor(locale: string): {
  group: string;
  decimal: string;
} {
  try {
    let parts = new Intl.NumberFormat(locale).formatToParts(SEPARATOR_PROBE);
    let group = parts.find((p) => p.type === 'group')?.value ?? ',';
    let decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
    return { group, decimal };
  } catch {
    return { group: ',', decimal: '.' };
  }
}

/** Latin digits from whatever digits a locale actually prints, so a form
 * rendered in `ar-EG` accepts what it displays. */
function localeDigits(locale: string): Map<string, string> {
  let map = new Map<string, string>();
  try {
    let format = new Intl.NumberFormat(locale, { useGrouping: false });
    for (let digit = 0; digit <= 9; digit++) {
      let glyph = format.format(digit);
      if (glyph.length === 1 && glyph !== String(digit)) {
        map.set(glyph, String(digit));
      }
    }
  } catch {
    // A malformed tag leaves the map empty; latin digits still parse.
  }
  return map;
}

/** Fold every digit system this parser knows about down to `0`–`9`. */
function foldDigits(text: string, locale: string): string {
  let localeMap = localeDigits(locale);
  let out = '';
  for (let char of text) {
    let mapped = localeMap.get(char);
    if (mapped !== undefined) {
      out = out + mapped;
      continue;
    }
    let code = char.codePointAt(0) ?? 0;
    let folded = '';
    for (let zero of DIGIT_ZEROS) {
      if (code >= zero && code <= zero + 9) {
        folded = String(code - zero);
        break;
      }
    }
    out = out + (folded.length > 0 ? folded : char);
  }
  return out;
}

/**
 * A number from whatever a reader typed or pasted.
 *
 * Accepts, in one pass: the locale's own separators, the other locale's
 * separators, currency symbols and codes anywhere in the string, group
 * spaces, accounting parentheses, a leading or trailing minus, the Unicode
 * MINUS SIGN, and non-latin digits.
 *
 * **The separator rule, stated because it is the only ambiguous part.** With
 * both `.` and `,` present the LAST one is the decimal — that is true in every
 * locale and needs no guess. With only one present: it is the decimal if it is
 * the locale's decimal; it is grouping if it is the locale's group separator
 * AND exactly three digits follow it; otherwise it is a decimal typed with the
 * other locale's character, which is far more common than a lone group of
 * four. So `1,5` in `de-DE` is one and a half, `1,500` in `de-DE` is fifteen
 * hundred, and both are what the reader meant.
 *
 * Returns `undefined` for anything with no digits in it at all, which is how
 * an empty box stays empty instead of becoming zero.
 */
export function parseAmount(
  text: string | number | null | undefined,
  options: { locale?: string } = {},
): number | undefined {
  if (typeof text === 'number') {
    return Number.isFinite(text) ? text : undefined;
  }
  let locale = options.locale ?? 'en-US';
  let raw = String(text ?? '')
    .replace(GROUP_SPACES, ' ')
    .replace(/\u2212/g, '-');
  raw = foldDigits(raw, locale);
  if (!/[0-9]/.test(raw)) {
    return undefined;
  }
  let parenthesised = /\(.*[0-9].*\)/.test(raw);
  let negative =
    parenthesised || /^\s*-/.test(raw) || /-\s*$/.test(raw.replace(/\)/g, ''));

  let separators = separatorsFor(locale);
  // Everything that is not a digit or a candidate separator is noise: symbols,
  // codes, spaces, brackets, the sign we already read.
  let body = raw.replace(/[^0-9.,]/g, '');
  let lastDot = body.lastIndexOf('.');
  let lastComma = body.lastIndexOf(',');
  let decimalAt = -1;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalAt = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    let only = lastDot >= 0 ? lastDot : lastComma;
    let char = body.charAt(only);
    let occurrences = body.split(char).length - 1;
    let trailing = body.length - only - 1;
    if (occurrences > 1) {
      decimalAt = -1;
    } else if (char === separators.decimal) {
      decimalAt = only;
    } else if (char === separators.group && trailing === 3) {
      decimalAt = -1;
    } else {
      decimalAt = only;
    }
  }

  let integerPart =
    decimalAt >= 0 ? body.slice(0, decimalAt) : body;
  let fractionPart = decimalAt >= 0 ? body.slice(decimalAt + 1) : '';
  let digits = integerPart.replace(/[^0-9]/g, '');
  let fraction = fractionPart.replace(/[^0-9]/g, '');
  let assembled =
    (digits.length > 0 ? digits : '0') +
    (fraction.length > 0 ? '.' + fraction : '');
  let value = Number(assembled);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return negative ? -value : value;
}

/**
 * How many decimal places this unit commits to.
 *
 * A currency answers for itself — JPY has none, USD two, BHD three — and
 * hardcoding two is the classic money bug that renders `¥1,234.00`.
 * `undefined` means "the caller decides", which is the honest answer for a
 * plain count.
 */
export function fractionDigitsFor(
  amountUnit: AmountUnit | undefined,
  locale = 'en-US',
): number | undefined {
  if (amountUnit?.fractionDigits !== undefined) {
    return amountUnit.fractionDigits;
  }
  if (amountUnit?.currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: amountUnit.currency,
      }).resolvedOptions().maximumFractionDigits;
    } catch {
      return 2;
    }
  }
  return undefined;
}

/**
 * Which side of the number the unit's mark sits on, in this locale.
 *
 * This is the whole reason the affix is derived rather than configured:
 * `en-US` writes `$1,234.50` and `de-DE` writes `1.234,50 €`, and a component
 * that pins the symbol to the left is simply wrong half the time. Read
 * straight out of `formatToParts`, so it is right for locales nobody tested.
 */
export function amountAffixes(
  amountUnit: AmountUnit | undefined,
  locale = 'en-US',
): { prefix: string; suffix: string } {
  if (!amountUnit) {
    return { prefix: '', suffix: '' };
  }
  if (amountUnit.currency) {
    try {
      let parts = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: amountUnit.currency,
        currencyDisplay: 'narrowSymbol',
      }).formatToParts(1);
      let first = parts.findIndex((p) => p.type === 'integer');
      let prefix = parts
        .slice(0, first < 0 ? 0 : first)
        .map((p) => p.value)
        .join('')
        .trim();
      let last = -1;
      for (let index = 0; index < parts.length; index++) {
        let part = parts[index];
        if (
          part &&
          (part.type === 'integer' ||
            part.type === 'fraction' ||
            part.type === 'decimal' ||
            part.type === 'group')
        ) {
          last = index;
        }
      }
      let suffix = parts
        .slice(last + 1)
        .map((p) => p.value)
        .join('')
        .trim();
      return { prefix, suffix };
    } catch {
      return { prefix: '', suffix: '' };
    }
  }
  if (amountUnit.symbol) {
    return { prefix: '', suffix: amountUnit.symbol };
  }
  return { prefix: '', suffix: '' };
}

/** The `Intl` options a unit implies. Shared by every formatter below so the
 * box, the echo and the caller can never disagree about what the value is. */
function optionsFor(
  amountUnit: AmountUnit | undefined,
  locale: string,
  extra: Intl.NumberFormatOptions = {},
): Intl.NumberFormatOptions {
  let digits = fractionDigitsFor(amountUnit, locale);
  let base: Intl.NumberFormatOptions = { ...extra };
  if (digits !== undefined) {
    base.minimumFractionDigits = digits;
    base.maximumFractionDigits = digits;
  }
  if (amountUnit?.currency) {
    base.style = 'currency';
    base.currency = amountUnit.currency;
    return base;
  }
  if (amountUnit?.unit) {
    base.style = 'unit';
    base.unit = amountUnit.unit;
    return base;
  }
  return base;
}

/**
 * The bare grouped number for the input box — no symbol, because the symbol
 * is the affix beside it and printing it twice is how money inputs end up
 * unparseable by their own parser.
 */
export function formatAmountPlain(
  value: number | undefined,
  amountUnit: AmountUnit | undefined,
  locale = 'en-US',
  precision?: number,
): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '';
  }
  let digits = fractionDigitsFor(amountUnit, locale) ?? precision;
  try {
    return new Intl.NumberFormat(
      locale,
      digits === undefined
        ? {}
        : { minimumFractionDigits: digits, maximumFractionDigits: digits },
    ).format(value);
  } catch {
    return String(value);
  }
}

/** The amount written the way it would appear in prose — symbol placed by the
 * locale, unit words where the unit has them. */
export function formatAmount(
  value: number | undefined,
  amountUnit: AmountUnit | undefined,
  locale = 'en-US',
  extra: Intl.NumberFormatOptions = {},
): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '';
  }
  try {
    return new Intl.NumberFormat(
      locale,
      optionsFor(amountUnit, locale, extra),
    ).format(value);
  } catch {
    return String(value);
  }
}

/**
 * The unambiguous readout: the amount with its unit spelled out in words.
 *
 * `$` belongs to at least eight currencies, so a symbol affix alone cannot
 * tell a reader which one they are looking at. This is the line that can, and
 * it is why the confirmation row exists rather than echoing the box back.
 */
export function describeAmount(
  value: number | undefined,
  amountUnit: AmountUnit | undefined,
  locale = 'en-US',
): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '';
  }
  if (amountUnit?.currency) {
    return formatAmount(value, amountUnit, locale, {
      currencyDisplay: 'name',
    });
  }
  if (amountUnit?.unit) {
    return formatAmount(value, amountUnit, locale, { unitDisplay: 'long' });
  }
  let number = formatAmountPlain(value, amountUnit, locale);
  return amountUnit?.label ? number + ' ' + amountUnit.label : number;
}

/** Round to the unit's own precision. Money that survives a round trip has to
 * land on the minor unit; `1/3` of a dollar is 0.33, not 0.3333333333333333. */
export function roundToUnit(
  value: number,
  amountUnit: AmountUnit | undefined,
  locale = 'en-US',
  precision?: number,
): number {
  let digits = fractionDigitsFor(amountUnit, locale) ?? precision;
  if (digits === undefined) {
    return value;
  }
  let scale = Math.pow(10, digits);
  return Math.round(value * scale) / scale;
}

/** Build a currency unit from its code. The label is the code itself, which is
 * the only string that is stable across locales and is what a picker should
 * show; the readable name rides along as search text. */
export function currencyUnit(code: string, name?: string): AmountUnit {
  return {
    value: code,
    label: code,
    currency: code,
    search: name ? code + ' ' + name : code,
  };
}

/**
 * A working set of ISO 4217 codes — the ones a general product actually
 * offers. Deliberately not the full 180: a picker nobody can scroll is worse
 * than a short list plus `@units` for the caller who needs more.
 *
 * JPY, KRW and VND are in the list on purpose: they have no minor unit, and
 * they are how you find out whether a money input hardcoded two decimals.
 */
const CURRENCY_NAMES: Array<[string, string]> = [
  ['USD', 'US Dollar'],
  ['EUR', 'Euro'],
  ['GBP', 'British Pound'],
  ['JPY', 'Japanese Yen'],
  ['CNY', 'Chinese Yuan'],
  ['CHF', 'Swiss Franc'],
  ['CAD', 'Canadian Dollar'],
  ['AUD', 'Australian Dollar'],
  ['NZD', 'New Zealand Dollar'],
  ['SEK', 'Swedish Krona'],
  ['NOK', 'Norwegian Krone'],
  ['DKK', 'Danish Krone'],
  ['PLN', 'Polish Zloty'],
  ['CZK', 'Czech Koruna'],
  ['HUF', 'Hungarian Forint'],
  ['RON', 'Romanian Leu'],
  ['TRY', 'Turkish Lira'],
  ['RUB', 'Russian Ruble'],
  ['INR', 'Indian Rupee'],
  ['IDR', 'Indonesian Rupiah'],
  ['SGD', 'Singapore Dollar'],
  ['HKD', 'Hong Kong Dollar'],
  ['TWD', 'New Taiwan Dollar'],
  ['KRW', 'South Korean Won'],
  ['THB', 'Thai Baht'],
  ['VND', 'Vietnamese Dong'],
  ['PHP', 'Philippine Peso'],
  ['MYR', 'Malaysian Ringgit'],
  ['AED', 'UAE Dirham'],
  ['SAR', 'Saudi Riyal'],
  ['ILS', 'Israeli Shekel'],
  ['ZAR', 'South African Rand'],
  ['NGN', 'Nigerian Naira'],
  ['KES', 'Kenyan Shilling'],
  ['EGP', 'Egyptian Pound'],
  ['BRL', 'Brazilian Real'],
  ['MXN', 'Mexican Peso'],
  ['ARS', 'Argentine Peso'],
  ['CLP', 'Chilean Peso'],
  ['COP', 'Colombian Peso'],
  ['BHD', 'Bahraini Dinar'],
];

export const CURRENCIES: AmountUnit[] = CURRENCY_NAMES.map(([code, name]) =>
  currencyUnit(code, name),
);

/** A starter set for the non-money case, so `AmountInput` has something to
 * demonstrate without the caller inventing units first. */
export const MASS_UNITS: AmountUnit[] = [
  { value: 'gram', label: 'g', unit: 'gram', search: 'gram grams' },
  {
    value: 'kilogram',
    label: 'kg',
    unit: 'kilogram',
    fractionDigits: 2,
    search: 'kilogram kilograms kilo',
  },
  { value: 'pound', label: 'lb', unit: 'pound', search: 'pound pounds lbs' },
  { value: 'ounce', label: 'oz', unit: 'ounce', search: 'ounce ounces' },
];
