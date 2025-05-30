import dayjs from 'dayjs';

const DEFAULT_LOCALE = 'en';
const DEFAULT_OUTPUT_FORMAT = 'D MMMM, YYYY';

/**
 * Utility function for formatting dates in JavaScript/TypeScript code.
 * Use this function when you need to format dates in your component logic,
 * computed properties, or any JavaScript/TypeScript code.
 *
 * @example
 * const formatted = formatDateTime(date, "MMM D, YYYY");
 */
export function formatDateTime(
  date: dayjs.ConfigType,
  formatString: string = DEFAULT_OUTPUT_FORMAT,
  locale: string = DEFAULT_LOCALE,
  option?: dayjs.OptionType,
): string {
  if (option) {
    return dayjs(date, option).locale(locale).format(formatString);
  } else {
    return dayjs(date).locale(locale).format(formatString);
  }
}
