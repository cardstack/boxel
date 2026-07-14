## The `markdown-helpers` toolkit

Module: `https://cardstack.com/base/markdown-helpers`

```gts
import {
  formatDateForMarkdown,
  formatDateTimeForMarkdown,
  formatDateRangeForMarkdown,
  markdownLink,
  markdownImage,
  fencedCodeBlock,
  markdownLinkForCard,
  markdownLinksForCards,
  markdownEmbedForCard,
  markdownEmbedsForCards,
} from 'https://cardstack.com/base/markdown-helpers';
```

All helpers return pre-escaped strings — safe to interpolate directly.

| Helper                                       | Output                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `formatDateForMarkdown(date)`                | `Mar 5, 2026` (empty for null/invalid)                                             |
| `formatDateTimeForMarkdown(date)`            | `Mar 5, 2026, 3:42 PM`                                                             |
| `formatDateRangeForMarkdown(start, end)`     | `Mar 5, 2026 - Mar 12, 2026`                                                       |
| `markdownLink(text, href)`                   | `[escaped text](encoded-href)` — parens in URL become `%28`/`%29`                  |
| `markdownImage(alt, url)`                    | `![alt](url)`, or `[binary image]` when url is missing                             |
| `fencedCodeBlock(content, language?)`        | Auto-widens the fence past any backtick run in `content`                           |
| `markdownLinkForCard(card, text?)`           | `[title](card.id)` — empty for null card                                           |
| `markdownLinksForCards(cards, { style })`    | `style: 'list'` (default, `- [A](id)` per line) or `'inline'` (`[A](id), [B](id)`) |
| `markdownEmbedForCard(card, { kind, size })` | `:card[id]` (inline) or `::card[id]` / `::card[id \| size]` (block, default)       |
| `markdownEmbedsForCards(cards, options)`     | Multiple embeds joined by `separator` (default `\n\n` block, `' '` inline)         |

The last four emit BFM card directives — see the `boxel-flavored-markdown` skill.
