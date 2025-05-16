import { helper } from '@ember/component/helper';

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
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  });
  return formatter.format(value);
}

export default helper<Signature>(function ([value, currency]) {
  return currencyFormat(value, currency || DEFAULT_CURRENCY);
});
