import { helper } from '@ember/component/helper';
import dayjs from 'dayjs';

const DEFAULT_LOCALE = 'en';
const DEFAULT_OUTPUT_FORMAT = 'D MMMM, YYYY';

export interface Signature {
  Args: {
    Named: { locale?: string };
    Positional: Array<unknown>;
  };
  Return: string;
}

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
  option?: dayjs.OptionType
): string {
  if (option) {
    return dayjs(date, option).locale(locale).format(formatString);
  } else {
    return dayjs(date).locale(locale).format(formatString);
  }
}

/**
 * Template helper for formatting dates in templates.
 * Use this helper when you need to format dates directly in your .hbs or .gts templates.
 *
 * @example
 * {{dayjsFormat @model.createdAt "MMM D, YYYY"}}
 */
export const dayjsFormat = helper<Signature>(function computed(
  positional: unknown[],
  hash: { locale?: string }
) {
  return formatDateTime(
    positional[0] as dayjs.ConfigType,
    positional[1] as string,
    hash.locale,
    positional[3] as dayjs.OptionType | undefined
  );
});

export default dayjsFormat;
