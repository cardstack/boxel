## Where BFM is used

BFM is the same dialect everywhere Boxel parses or emits markdown:

- `.md` files stored in a realm (rendered by the base realm's MarkdownTemplate)
- `MarkdownField` values (inline markdown stored in a card's JSON)
- AI assistant messages in Boxel
- The `markdown` format output of any card (served via `Accept: text/markdown` or produced by "Copy as Markdown")
- The "Rendered" view of the code-mode markdown preview panel

The same text copies cleanly between these surfaces.
