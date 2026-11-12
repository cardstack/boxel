import { cachedNumberFormat } from '../utils/intl-formatters.ts';

export default function formatFileSize(
  bytes: number | null | undefined,
  options: {
    binary?: boolean;
    fallback?: string;
    locale?: string;
    precision?: number;
  } = {},
): string {
  const { binary = true, precision = 2, locale, fallback } = options;

  // Handle invalid inputs
  if (bytes == null || typeof bytes !== 'number' || isNaN(bytes) || bytes < 0) {
    return fallback || '';
  }

  // Handle precision edge cases
  if (
    typeof precision !== 'number' ||
    isNaN(precision) ||
    precision < 0 ||
    precision > 20 ||
    !Number.isInteger(precision)
  ) {
    return fallback || '';
  }

  const base = binary ? 1024 : 1000;
  const units = binary
    ? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB']
    : ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];

  if (bytes === 0) {
    return '0 B';
  }

  const i = bytes < base ? 0 : Math.floor(Math.log(bytes) / Math.log(base));
  const size = bytes / Math.pow(base, i);

  // Format the number based on locale if provided
  const formattedNumber = locale
    ? cachedNumberFormat(locale, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }).format(size)
    : size.toFixed(precision);

  return `${formattedNumber} ${units[i]}`;
}
