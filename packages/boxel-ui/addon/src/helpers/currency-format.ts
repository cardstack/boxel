import { helper } from '@ember/component/helper';

const DEFAULT_CURRENCY = 'USD';

export interface Signature {
  Args: {
    Positional: [value: number, currency?: string];
    Named: never;
  };
  Return: string;
}

export function currencyFormat(value: number, currency: string = 'USD') {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  });
  return formatter.format(value);
}

export default helper<Signature>(function (
  positional: Signature['Args']['Positional'],
  _hash: { locale?: string },
) {
  return currencyFormat(positional[0], positional[1] || DEFAULT_CURRENCY);
});
