// Pretui — FormatBytes: byte and bit sizes in SI or IEC units, labelled honestly.
import Component from '@glimmer/component';
import { FormattedValue } from './formatted-value';
import { formatNumber, toNumber } from '../internal/reading-format';
import type { FormatOptionBag } from '../internal/reading-format';

// ── FormatBytes ← wa-format-bytes ────────────────────────────────────────
// Better than the inspiration: `@base` separates IEC binary (÷1024, KiB) from
// SI decimal (÷1000, kB) instead of quietly conflating them; the decimal path
// runs through Intl `style: 'unit'` so the unit is localised and placed by
// CLDR data, and the binary path (Intl has no kibibyte unit — an honest,
// documented limit) formats the NUMBER through Intl and appends the IEC
// symbol with a non-breaking space, mirroring it sr-only as the spelled-out
// "2.4 mebibytes" because assistive tech reads "MiB" as noise.
const DECIMAL_BYTE_UNITS = [
  'byte',
  'kilobyte',
  'megabyte',
  'gigabyte',
  'terabyte',
  'petabyte',
];
// CLDR has no petabit, so the decimal bit ladder stops one step short — a
// value that big simply keeps counting in terabits.
const DECIMAL_BIT_UNITS = ['bit', 'kilobit', 'megabit', 'gigabit', 'terabit'];
const BINARY_BYTE_SYMBOLS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
const BINARY_BIT_SYMBOLS = ['bit', 'Kibit', 'Mibit', 'Gibit', 'Tibit', 'Pibit'];
const BINARY_BYTE_WORDS = [
  'byte',
  'kibibyte',
  'mebibyte',
  'gibibyte',
  'tebibyte',
  'pebibyte',
];
const BINARY_BIT_WORDS = [
  'bit',
  'kibibit',
  'mebibit',
  'gibibit',
  'tebibit',
  'pebibit',
];

export interface ByteFormatOptions {
  unit?: 'byte' | 'bit';
  base?: 'binary' | 'decimal';
  locale?: string;
  display?: 'short' | 'narrow' | 'long';
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export interface ByteFormatResult {
  /** the visible string, e.g. '2.4 MiB' */
  text: string;
  /** sr-only mirror when the visible string is not readable aloud, else undefined */
  spoken?: string;
  /** index into the unit ladder that was chosen (0 = bytes) */
  step: number;
}

/**
 * Human-readable byte (or bit) size. Pure, memoised through the shared Intl
 * caches, never throws.
 */
export function formatBytes(
  value: number,
  options: ByteFormatOptions = {},
): ByteFormatResult {
  let base = options.base ?? 'binary';
  let bits = options.unit === 'bit';
  let display = options.display ?? 'short';
  let divisor = base === 'binary' ? 1024 : 1000;
  let magnitude = Math.abs(value);
  let step = 0;
  if (magnitude >= 1) {
    step = Math.floor(Math.log(magnitude) / Math.log(divisor));
  }
  let rungs =
    base === 'binary'
      ? (bits ? BINARY_BIT_SYMBOLS : BINARY_BYTE_SYMBOLS).length
      : (bits ? DECIMAL_BIT_UNITS : DECIMAL_BYTE_UNITS).length;
  step = Math.min(Math.max(step, 0), rungs - 1);
  let scaled = value / Math.pow(divisor, step);
  let maximumFractionDigits =
    options.maximumFractionDigits ?? (step === 0 ? 0 : 1);
  let minimumFractionDigits = options.minimumFractionDigits ?? 0;
  let digits: FormatOptionBag = {
    minimumFractionDigits: Math.min(minimumFractionDigits, maximumFractionDigits),
    maximumFractionDigits,
  };

  // Bytes themselves, and every decimal step, are real CLDR units — let Intl
  // place and localise them.
  if (base === 'decimal' || step === 0) {
    let unit = bits ? DECIMAL_BIT_UNITS[step] : DECIMAL_BYTE_UNITS[step];
    let text = formatNumber(value / Math.pow(divisor, step), options.locale, {
      ...digits,
      style: 'unit',
      unit,
      unitDisplay: display,
    });
    let spoken =
      display === 'narrow'
        ? formatNumber(scaled, options.locale, {
            ...digits,
            style: 'unit',
            unit,
            unitDisplay: 'long',
          })
        : undefined;
    return { text, spoken, step };
  }

  // Binary steps: Intl has no IEC units, so the number is localised and the
  // symbol appended. NBSP keeps '2.4 MiB' from breaking across a line.
  let symbols = bits ? BINARY_BIT_SYMBOLS : BINARY_BYTE_SYMBOLS;
  let words = bits ? BINARY_BIT_WORDS : BINARY_BYTE_WORDS;
  let number = formatNumber(scaled, options.locale, digits);
  let word = words[step];
  let plural = Math.abs(scaled) === 1 ? word : `${word}s`;
  return {
    // The \u00a0 is deliberate: a size must never wrap between its
    // number and its unit. Written as an escape rather than the literal
    // character, which trips no-irregular-whitespace.
    text: `${number}\u00a0${symbols[step]}`,
    spoken: `${number} ${plural}`,
    step,
  };
}

export interface FormatBytesSignature {
  Args: {
    /** the size to render, counted in bytes (or bits when @unit='bit') */
    value?: number | string;
    /** what the raw number counts: bytes (default) or bits */
    unit?: 'byte' | 'bit';
    /** 'binary' = IEC ÷1024 with KiB/MiB labels (default); 'decimal' = SI ÷1000 with kB/MB labels. Conflating these is the classic bytes bug, so it is a knob, never an assumption. */
    base?: 'binary' | 'decimal';
    /** BCP-47 locale tag; omit to use the runtime default. An unknown tag falls back rather than throwing. */
    locale?: string;
    /** unit wording: 'short' (2.4 MB), 'narrow' (2.4MB), 'long' (2.4 megabytes). Decimal base only — binary always uses the IEC symbol. */
    display?: 'short' | 'narrow' | 'long';
    /** floor on fraction digits (default 0) */
    minimumFractionDigits?: number;
    /** ceiling on fraction digits (default 0 for raw bytes, 1 once scaled) */
    maximumFractionDigits?: number;
    /** wear the Token dress (Law 3) — for machine contexts like an artifact table */
    token?: boolean;
    /** sr-only mirror policy: 'auto' mirrors only when the visible text is unreadable aloud (IEC symbols, narrow units), 'always' forces it, 'off' suppresses it */
    spoken?: 'auto' | 'always' | 'off';
    /** rendered when the value is missing or not a finite number (default '—') */
    placeholder?: string;
  };
  Element: HTMLSpanElement;
}

export class FormatBytes extends Component<FormatBytesSignature> {
  get num(): number | undefined {
    return toNumber(this.args.value);
  }
  get result(): ByteFormatResult | undefined {
    let n = this.num;
    if (n === undefined) {
      return undefined;
    }
    return formatBytes(n, {
      unit: this.args.unit,
      base: this.args.base,
      locale: this.args.locale,
      display: this.args.display,
      minimumFractionDigits: this.args.minimumFractionDigits,
      maximumFractionDigits: this.args.maximumFractionDigits,
    });
  }
  get text(): string {
    return this.result?.text ?? (this.args.placeholder ?? '—');
  }
  get spoken(): string | undefined {
    let mode = this.args.spoken ?? 'auto';
    let result = this.result;
    if (mode === 'off' || !result) {
      return undefined;
    }
    if (mode === 'always') {
      let long = formatBytes(this.num ?? 0, {
        unit: this.args.unit,
        base: this.args.base,
        locale: this.args.locale,
        display: 'long',
        minimumFractionDigits: this.args.minimumFractionDigits,
        maximumFractionDigits: this.args.maximumFractionDigits,
      });
      return long.spoken ?? long.text;
    }
    return result.spoken;
  }
  get isEmpty(): boolean {
    return this.result === undefined;
  }
  <template>
    <FormattedValue
      @text={{this.text}}
      @spoken={{this.spoken}}
      @token={{@token}}
      @empty={{this.isEmpty}}
      data-test-pretui-format-bytes
      ...attributes
    />
  </template>
}
