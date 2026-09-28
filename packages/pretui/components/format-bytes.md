## What it is

A byte count rendered the way a file manager renders it: `2.4 MiB` or `2.4 MB`, with the base chosen rather than assumed.

## The contract

```
@value?    — the size, counted in bytes (or bits when @unit='bit')
@unit?     — what the raw number counts: 'byte' (default) | 'bit'
@base?     — 'binary' (default) = IEC ÷1024 with KiB/MiB labels;
             'decimal' = SI ÷1000 with kB/MB labels
@locale?   — BCP-47 tag; an unknown tag falls back rather than throwing
@display?  — unit wording: 'short' (2.4 MB) | 'narrow' (2.4MB) | 'long' (2.4 megabytes).
             Decimal base only — binary always uses the IEC symbol
@minimumFractionDigits? — default 0
@maximumFractionDigits? — default 0 for raw bytes, 1 once scaled
@token?    — wear the Token dress, for machine contexts like an artifact table
@spoken?   — sr-only mirror: 'auto' (default) | 'always' | 'off'
@placeholder? — when the value is missing or not finite. Default '—'
```

**Binary versus decimal is a knob, never an assumption, because conflating them is the classic bytes bug.** ÷1024 with `MB` labels is wrong; ÷1000 with `MiB` labels is wrong; and which one a product wants depends on whether it is agreeing with an operating system or with a disk manufacturer.

**Fraction digits default differently once scaled.** Raw bytes get none — `937 B`, not `937.0 B` — and scaled values get one, which is the precision a size is actually known to.

**`@display` is decimal-only.** There is no long or narrow wording for IEC symbols, so binary always renders the symbol.

## Prior art

The byte formatter every product writes once and then writes again.

Where Pretui is better: the base is explicit and the labels follow it, so the two can never disagree. That single pairing is the bug this component exists to make impossible.

Where it is thinner: no bit/byte auto-detection, no transfer-rate formatting (`MB/s`), and no threshold control over when scaling kicks in.

## Accessibility

- **`@spoken='auto'` mirrors when the visible text is unreadable aloud** — IEC symbols and narrow units. "2.4MiB" is not a phrase; the mirror is.
- **IEC symbols are the worst case for a screen reader** in this component, which is why the default base is also the one most likely to need a mirror.
- **`@placeholder` announces as a dash**, so an unknown size is perceivable as unknown rather than as zero.
- **A size with no unit is meaningless**, so nothing here ever renders the number alone.

## Theming

`@token` swaps to the kit's **Token** treatment — the right choice in an artifact table, where sizes sit in a column of machine values and tabular figures keep them aligned.

No other surface: a size in prose is prose.
