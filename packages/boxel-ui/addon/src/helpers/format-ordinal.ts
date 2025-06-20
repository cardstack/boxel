export default function formatOrdinal(
  number: number | null | undefined,
  options: {
    fallback?: string;
    locale?: string;
  } = {},
): string {
  // Handle null, undefined, non-numbers, NaN, Infinity, and decimal numbers
  if (
    number == null ||
    typeof number !== 'number' ||
    isNaN(number) ||
    !isFinite(number) ||
    number % 1 !== 0
  ) {
    return options.fallback || '';
  }

  const locale = options.locale || 'en-US';
  const n = Math.floor(number);

  // Use Intl.PluralRules for proper localization
  try {
    const pr = new Intl.PluralRules(locale, { type: 'ordinal' });
    const rule = pr.select(Math.abs(n));

    // Get locale-specific formatting
    return formatOrdinalByLocale(n, locale, rule);
  } catch (error) {
    // Fallback to English if locale is not supported
    return formatEnglishOrdinal(n);
  }
}

function formatOrdinalByLocale(
  n: number,
  locale: string,
  rule: Intl.LDMLPluralRule,
): string {
  // Handle specific locales
  switch (locale) {
    case 'es-ES':
      return formatSpanishOrdinal(n, rule);
    case 'fr-FR':
      return formatFrenchOrdinal(n, rule);
    case 'de-DE':
      return formatGermanOrdinal(n);
    case 'ar-SA':
      return formatArabicOrdinal(n);
    case 'he-IL':
      return formatHebrewOrdinal(n);
    default:
      return formatEnglishOrdinal(n);
  }
}

function formatEnglishOrdinal(n: number): string {
  const suffix = getEnglishSuffix(n);
  return `${n}${suffix}`;
}

function getEnglishSuffix(n: number): string {
  const lastTwoDigits = Math.abs(n) % 100;
  const lastDigit = Math.abs(n) % 10;

  // Special cases for 11th, 12th, 13th
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return 'th';
  }

  switch (lastDigit) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

function formatSpanishOrdinal(n: number, _rule: Intl.LDMLPluralRule): string {
  // Spanish ordinals use º for masculine and ª for feminine
  // Using º as default (masculine)
  return `${n}º`;
}

function formatFrenchOrdinal(n: number, _rule: Intl.LDMLPluralRule): string {
  // French ordinals use 'er' for 1st, 'e' for others
  if (Math.abs(n) === 1) {
    return `${n}er`;
  }
  return `${n}e`;
}

function formatGermanOrdinal(n: number): string {
  // German ordinals use a period after the number
  return `${n}.`;
}

function formatArabicOrdinal(n: number): string {
  // Convert to Arabic-Indic numerals and add period
  const arabicNumber = n.toString().replace(/\d/g, (digit) => {
    const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    const digitIndex = parseInt(digit);
    return arabicDigits[digitIndex] || digit;
  });
  return `${arabicNumber}.`;
}

function formatHebrewOrdinal(n: number): string {
  // Hebrew ordinals use a period after the number (using regular numerals)
  return `${n}.`;
}
