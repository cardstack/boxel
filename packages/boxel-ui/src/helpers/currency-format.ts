import { helper } from '@ember/component/helper';

import { cachedNumberFormat } from '../utils/intl-formatters.ts';

const DEFAULT_CURRENCY = 'USD';

export interface Signature {
  Args: {
    Positional: [value: number, currency?: string];
  };
  Return: string;
}

export function currencyFormat(
  value: number,
  currency: string = DEFAULT_CURRENCY,
) {
  const formatter = cachedNumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  });
  return formatter.format(value);
}

export default helper<Signature>(function ([value, currency]) {
  return currencyFormat(value, currency || DEFAULT_CURRENCY);
});
