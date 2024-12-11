import { helper } from '@ember/component/helper';

type PositionalArgs = number;

interface Signature {
  Args: {
    Positional: PositionalArgs;
  };
  Return: string;
}

export function formatNumber(number?: number | null): string {
  if (number == undefined || number == null) {
    return '';
  }

  return number.toLocaleString();
}

export default helper<Signature>(formatNumber);
