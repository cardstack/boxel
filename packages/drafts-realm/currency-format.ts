import { TokenField, CurrencyField } from './asset';

export function balanceInCurrency(
  balance: number | null | undefined,
  payment: TokenField | CurrencyField | null | undefined, // TODO: work exchange rate into this
) {
  if (balance == null) {
    return 0;
  }
  let total = balance * 1;
  if (payment.name === 'USD') {
    return formatUSD(total);
  } else {
    return `${Number.isInteger(total) ? total : total.toFixed(2)} ${
      payment.symbol
    }`;
  }
}

export function formatUSD(amount: number | null | undefined) {
  if (amount == null) {
    amount = 0;
  }
  return `$ ${amount.toFixed(2)} USD`;
}
