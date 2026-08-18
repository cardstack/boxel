// One money formatter for the whole fulfilment family.
//
// It exists because the app renders aggregates that are plain numbers — a
// warehouse's stock value, a rate's cost and margin — which no field instance
// can format, while the cards render `AmountWithCurrency` atoms. Left to
// themselves the two disagree: the board showed `£34.39` next to a returns tile
// showing `£ 26` and `£ 44.2`, three formats on one screen. Everything that
// prints money goes through here, atoms included.
export function money(amount: number | undefined, code = 'GBP') {
  if (amount == null) {
    return '—';
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code || 'GBP',
    }).format(amount);
  } catch {
    return String(amount);
  }
}

export default money;

// One date formatter, for the same reason. The transit tab prints a delivery
// moment next to `DatetimeField` atoms elsewhere on the card, and a raw
// `toString()` there put "Tue Aug 05 2026 11:20:00 GMT+0000" beside "5 Aug
// 2026, 11:20" — two formats for one fact. Day and minute both matter: "did it
// land inside the promised window" is a question about the time, not the date.
export function stamp(value: Date | undefined | null) {
  if (!value) {
    return '—';
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(value);
  } catch {
    return String(value);
  }
}
