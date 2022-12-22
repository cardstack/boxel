import { PaymentMethod } from "./payment-method";

export function balanceInCurrency(
  balance: number | null | undefined,
  payment: PaymentMethod | null | undefined
) {
  if (balance == null || payment?.exchangeRate == null) {
    return 0;
  }
  let total = balance * payment.exchangeRate;
  if (payment.name === "USD") {
    return formatUSD(total);
  } else {
    return `${Number.isInteger(total) ? total : total.toFixed(2)} ${
      payment.name
    }`;
  }
}

export function formatUSD(amount: number | null | undefined) {
  if (amount == null) {
    amount = 0;
  }
  return `$ ${amount.toFixed(2)} USD`;
}
