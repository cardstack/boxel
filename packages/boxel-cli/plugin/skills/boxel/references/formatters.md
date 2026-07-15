# Display Formatters

Canonical module: `@cardstack/boxel-ui/helpers`.

Use these for display in templates or Component getters. Keep schema/computed data raw where possible; do not store localized display strings in `computeVia`. `dayjsFormat` is legacy; prefer `formatDateTime`.

```gts
import {
  formatAge,
  formatCountdown,
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatFileSize,
  formatList,
  formatNames,
  formatNumber,
  formatOrdinal,
  formatPeriod,
  formatRelativeTime,
} from '@cardstack/boxel-ui/helpers';
```

## Available Helpers

| Helper | Use |
| --- | --- |
| `formatDateTime` | Main date/time formatter. Supports `preset`/`size` (`tiny`, `short`, `medium`, `long`), `format`, `relative`, `locale`, `timeZone`, `kind` (`date`, `time`, `datetime`, `month`, `year`, `monthYear`, `week`, `quarter`, `monthDay`). |
| `formatNumber` | Decimal, percent, or currency number formatting. Supports `size`, `locale`, `minimumFractionDigits`, `maximumFractionDigits`, `style`, `currency`, `fallback`. |
| `formatCurrency` | Currency display with `currency`, `locale`, `size`, and `fallback`. Prefer this over `currencyFormat` for new work. |
| `currencyFormat` | Older simple currency helper: `(value, currency = 'USD')`, fixed `en-US`. Use only when matching existing code. |
| `formatRelativeTime` | Relative time such as `2 hours ago`; supports `size`, `locale`, `timeZone`, `now`, precision/rounding, absolute fallback. |
| `formatDuration` | Duration from a number using `unit` (`seconds`, `minutes`, `hours`, `days`, `milliseconds`) and `format` (`humanize`, `timer`, `short`, `long`). |
| `formatCountdown` | Countdown string to a future date; can show/hide days, hours, minutes, seconds. |
| `formatFileSize` | Byte counts as binary (`KiB`, `MiB`) or decimal (`KB`, `MB`) units. |
| `formatList` | Human-readable list formatting with conjunction/disjunction/unit styles. |
| `formatNames` | Name display: `full`, `first-last`, `last-first`, `initials`. |
| `formatOrdinal` | Ordinals such as `1st`, `2nd`; limited locale support. |
| `formatPeriod` | Period strings such as `FY2026`, `2026-Q2`, `2026-05`; supports compact/long variants and ranges. |
| `formatAge` | Age from a birth date; supports `auto`, `years`, `months`, `days`, and `precise`. |
| `dayjsFormat` | Deprecated date formatter. Prefer `formatDateTime`. |

## Examples

```hbs
{{formatDateTime @model.startsAt preset='medium' timeZone='America/New_York'}}
{{formatDateTime @model.updatedAt relative=true size='short'}}
{{formatNumber @model.conversionRate style='percent' size='short'}}
{{formatCurrency @model.revenue currency='USD' size='tiny'}}
{{formatDuration @model.elapsedSeconds format='timer'}}
{{formatFileSize @model.assetBytes binary=true precision=1}}
```

For static `markdown` templates, use `https://cardstack.com/base/markdown-helpers` instead; those helpers return pre-escaped markdown-safe strings.
