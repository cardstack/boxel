export default function formatNumber(
  value: number | null | undefined,
  options: {
    currency?: string;
    fallback?: string;
    locale?: string;
    maximumFractionDigits?: number;
    minimumFractionDigits?: number;
    size?: 'tiny' | 'short' | 'medium' | 'long';
    style?: 'decimal' | 'percent' | 'currency';
  } = {},
): string {
  // Handle null, undefined, and invalid values
  if (value == null || typeof value !== 'number' || isNaN(value)) {
    return options.fallback || '';
  }

  const {
    style = 'decimal',
    size,
    locale = 'en-US',
    minimumFractionDigits,
    maximumFractionDigits,
    currency = 'USD',
  } = options;

  // Determine the effective size, defaulting to 'medium' if not provided
  const effectiveSize = size ?? 'medium';
  const sizeExplicitlyProvided = size !== undefined;
  const styleExplicitlyProvided = 'style' in options;

  // Handle percentage formatting
  if (style === 'percent') {
    const formatOptions: Intl.NumberFormatOptions = {
      style: 'percent',
    };

    switch (size) {
      case 'tiny':
        formatOptions.maximumFractionDigits = 0;
        break;
      case 'short':
        formatOptions.maximumFractionDigits = 1;
        break;
      default:
        formatOptions.maximumFractionDigits = 2;
    }

    if (minimumFractionDigits !== undefined) {
      formatOptions.minimumFractionDigits = minimumFractionDigits;
    }
    if (maximumFractionDigits !== undefined) {
      formatOptions.maximumFractionDigits = maximumFractionDigits;
    }

    return new Intl.NumberFormat(locale, formatOptions).format(value);
  }

  // Handle currency formatting
  if (style === 'currency') {
    const formatOptions: Intl.NumberFormatOptions = {
      style: 'currency',
      currency,
    };

    if (minimumFractionDigits !== undefined) {
      formatOptions.minimumFractionDigits = minimumFractionDigits;
    }
    if (maximumFractionDigits !== undefined) {
      formatOptions.maximumFractionDigits = maximumFractionDigits;
    }

    return new Intl.NumberFormat(locale, formatOptions).format(value);
  }

  // Handle decimal formatting with size variants
  if (effectiveSize === 'tiny') {
    if (Math.abs(value) >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    }
    if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toString();
  }

  // Special case for zero - display as "0" without decimals unless explicitly specified
  if (
    value === 0 &&
    minimumFractionDigits === undefined &&
    maximumFractionDigits === undefined &&
    !sizeExplicitlyProvided
  ) {
    return '0';
  }

  // For other sizes, use Intl.NumberFormat
  const formatOptions: Intl.NumberFormatOptions = {
    style: 'decimal',
  };

  // Set fraction digits based on size if not explicitly provided
  if (
    minimumFractionDigits === undefined &&
    maximumFractionDigits === undefined
  ) {
    switch (effectiveSize) {
      case 'short':
        formatOptions.maximumFractionDigits = 0;
        break;
      case 'medium':
        // If size was not explicitly provided and style is 'decimal', preserve natural precision
        if (
          !sizeExplicitlyProvided &&
          styleExplicitlyProvided &&
          style === 'decimal'
        ) {
          // Don't set any fraction digit limits to preserve natural precision
        } else {
          formatOptions.minimumFractionDigits = 2;
          formatOptions.maximumFractionDigits = 2;
        }
        break;
      case 'long':
        formatOptions.minimumFractionDigits = 4;
        formatOptions.maximumFractionDigits = 4;
        break;
    }
  }

  // Override with explicit precision settings
  if (minimumFractionDigits !== undefined) {
    formatOptions.minimumFractionDigits = minimumFractionDigits;
  }
  if (maximumFractionDigits !== undefined) {
    formatOptions.maximumFractionDigits = maximumFractionDigits;
  }

  return new Intl.NumberFormat(locale, formatOptions).format(value);
}
