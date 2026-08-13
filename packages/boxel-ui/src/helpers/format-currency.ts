export default function formatCurrency(
  amount: number | null | undefined,
  options: {
    currency?: string;
    fallback?: string;
    locale?: string;
    size?: 'tiny' | 'short' | 'medium' | 'long';
  } = {},
): string {
  if (
    amount == null ||
    typeof amount !== 'number' ||
    isNaN(amount) ||
    !isFinite(amount)
  ) {
    return options.fallback || '';
  }

  const { currency = 'USD', size = 'medium', locale = 'en-US' } = options;

  // Handle special formatting for tiny size with compact notation
  if (size === 'tiny') {
    const absAmount = Math.abs(amount);
    if (absAmount >= 1000000) {
      const formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        notation: 'compact',
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      });
      return formatter.format(amount);
    }
    if (absAmount >= 1000) {
      const formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        notation: 'compact',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
      return formatter.format(amount);
    }
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return formatter.format(amount);
  }

  // Handle long format with spelled out currency
  if (size === 'long') {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const currencyNames: Record<string, string> = {
      USD: 'US dollars',
      EUR: 'euros',
      JPY: 'yen',
      GBP: 'pounds',
      CAD: 'Canadian dollars',
      AUD: 'Australian dollars',
    };
    const currencyName = currencyNames[currency] || `${currency} currency`;
    return `${formatter.format(amount)} ${currencyName}`;
  }

  // Handle short format (no decimals)
  if (size === 'short') {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return formatter.format(Math.round(amount));
  }

  // Default medium format (full precision)
  const minimumFractionDigits = currency === 'JPY' ? 0 : 2;
  const maximumFractionDigits = currency === 'JPY' ? 0 : 2;

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  });

  return formatter.format(amount);
}
