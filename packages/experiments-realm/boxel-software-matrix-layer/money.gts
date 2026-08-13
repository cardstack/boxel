export interface MoneyLike {
  amount?: number;
  currency?: { code?: string };
}

export interface LineItemLike {
  quantity?: number;
  unitPrice?: MoneyLike;
}

export function lineTotal(item: LineItemLike | undefined): number {
  if (!item) return 0;
  return (item.quantity ?? 0) * (item.unitPrice?.amount ?? 0);
}

export function sumLineItems(items: LineItemLike[] | undefined): {
  total: number;
  code: string | undefined;
} {
  let total = 0;
  let code: string | undefined;
  for (let item of items ?? []) {
    total += lineTotal(item);
    code = code ?? item.unitPrice?.currency?.code ?? undefined;
  }
  return { total, code };
}

export interface PaymentLike {
  amount?: MoneyLike;
}

export function outstandingBalance(
  items: LineItemLike[] | undefined,
  payments: (PaymentLike | undefined)[] | undefined,
): number {
  let { total } = sumLineItems(items);
  let paid = (payments ?? []).reduce(
    (acc, p) => acc + (p?.amount?.amount ?? 0),
    0,
  );
  return Math.max(total - paid, 0);
}

export function orderTotals(
  items: LineItemLike[] | undefined,
  taxRate?: number,
): { subtotal: number; tax: number; total: number; code: string | undefined } {
  let { total: subtotal, code } = sumLineItems(items);
  let tax = taxRate ? subtotal * (taxRate / 100) : 0;
  return { subtotal, tax, total: subtotal + tax, code };
}

export function formatMoney(amount: number | undefined, code?: string): string {
  if (amount === undefined || !Number.isFinite(amount)) return '';
  if (code) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
      }).format(amount);
    } catch {
      /* fall through to plain formatting */
    }
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(amount);
}
