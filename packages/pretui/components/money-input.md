## What it is

A currency amount placed on the locale's own side: `$1,200.00` or `1.200,00 €`, decided by `Intl.formatToParts` rather than by a hardcoded assumption about where symbols go.

It is **AmountInput** with the units fixed to currencies, and the three unit args replaced by currency ones.

## The contract

```
every AmountInput arg except units, unit and defaultUnit
@currency?        — ISO 4217 code, controlled
@defaultCurrency? — uncontrolled seed; USD when the list is the default one
@currencies?      — the offered codes; defaults to the full CURRENCIES list
```

**The three unit args are omitted rather than ignored**, so passing one is a compile error rather than a silent no-op.

**Symbol placement comes from the locale, not from the currency.** The same currency sits before the number in one locale and after it in another, and `formatToParts` is the only honest way to know which — a lookup table of "symbol goes left" is wrong for half the world.

**`@currencies` is worth narrowing.** A product that trades in three currencies should pass three; the default is the full list, which is a long select.

**Everything else is AmountInput's**: commit-time clamping, `undefined` rather than 0 for an empty box, the ghost hint that is not a placeholder, and the spelled-out confirmation row.

## Prior art

The kit's own `fields-configuration` amount-with-currency field.

Where Pretui is better: locale-driven placement. Most currency inputs hardcode the symbol to the left because the developer's locale puts it there, which is a defect that only surfaces after launch in another market.

Where it is thinner: no exchange rates or conversion, no minor-unit entry mode (cents-only typing, which some finance UIs want), and no per-currency min/max. Precision comes from the currency's own definition, so a currency with unusual minor units is at the mercy of `Intl`'s data.

## Accessibility

- **Everything AmountInput does**, since this is that component with a narrower unit list.
- **The confirmation row matters more here than anywhere else in the kit.** Currency separators invert between locales — `1.200,00` and `1,200.00` are the same number written two ways — and a reader needs to see which one was understood.
- **The currency picker is separately named**, so it is never an unlabelled select beside a number.
- **The symbol is presentation.** The value a caller receives is a number and a code, not a formatted string, so nothing downstream has to parse a symbol back off.

## Theming

Inherited entirely from **AmountInput** — `--pretui-amount-align`, `--pretui-amount-mark-width`, `--pretui-amount-select-width`, `--pretui-destructive-ink`, `--pretui-shadow-control`.

There are deliberately no money-specific tokens. A currency field and a weight field on the same form should be the same control wearing a different unit, and giving money its own surface would break that.
