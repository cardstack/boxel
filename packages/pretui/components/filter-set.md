## What it is

The narrow, read-only face of a condition set: each condition collapsed to one line of prose, with the joiner between them, plus optional edit/remove/add controls. Use it as the sidebar beside a list view, or as the summary of a rule you are not currently editing. For authoring, **ExpressionBuilder**. For a whole rule with its metadata, **RuleRow**.

## The contract

```
@conditions: ExpressionCondition[]   — read-only here; editing happens elsewhere
@logic? ('all'), @customLogic?
@resources?, @operators?, @title? ('Conditions')
@activeId?
@onEdit?(id), @onRemove?(id), @onAdd?
<:footer>
```

**The three callbacks are also the three affordances.** Supply `@onEdit` and each row gets an edit control; supply `@onRemove` and each gets a remove; supply `@onAdd` and the add button appears. Omit all three and it is pure display. One arg, one control — no separate `showEdit` booleans.

**`@resources` exists so summaries read with field *labels*, not paths.** A condition whose `targetPath` is `"Line Item"[SKU = "COPY-04"].Quantity` should summarise as "Line item quantity is greater than 10", and the resource catalogue is what makes that possible. Without it you get the path, which is correct but unreadable.

**`@customLogic` is echoed verbatim** when `@logic` is `custom` — the component does not re-render `1 AND (2 OR 3)` into prose, because paraphrasing a grammar is how a summary starts lying about the rule.

`@activeId` highlights the row currently open in an editor beside this list.

## Prior art

Ported from **SLDS's `filters/` variant** (`slds-filters`, `slds-filters__item`) — the sidebar you get beside a list view where each condition collapses to one line.

Three concrete improvements over the inspiration:

- **SLDS's filter item is a `<div>` with a click handler.** Here every entry is a real list item and **the edit control is the button** — so the summary text can be truncated without stealing the click target, and a keyboard user reaches a real, named control rather than a clickable div.
- **SLDS's joiner ("AND") is a decorative `<strong>` that assistive tech reads as a stray word between two items.** Here the joiner is `aria-hidden` chrome and **the relationship is carried by the list's accessible name instead** — so a screen-reader user is told "All of the following conditions, 3 items" rather than hearing "AND" float between rows.
- **The summary is derived from the model**, so it cannot drift from what the builder composed.

**Dropped:** SLDS's `slds-is-new` / `slds-is-locked` item states, and the nested `slds-filters__group` — this list is flat for the same reason **ExpressionBuilder** is: custom logic expresses grouping with parentheses over one flat row list, and flatness is what keeps stable-id remapping provable.

## Accessibility

No APG pattern; a labelled list with per-item controls.

What is right, and the joiner decision is the interesting one:

- **The joiner is `aria-hidden` and the relationship lives in the list's accessible name.** This is a genuinely good call. A visible "AND" between rows is chrome that carries meaning for sighted users; repeating it in the accessibility tree produces "condition, AND, condition, AND, condition", which is noise, while omitting the relationship entirely loses it. Putting it in the name gives the relationship once, up front, where it belongs.
- **Real list semantics.** The `<ol>` sets `role="list"` explicitly, because `list-style: none` silently strips list semantics in Safari/VoiceOver.
- **Edit is a named button, not a clickable div** (above), so truncating the summary does not truncate the target.

Gaps:

- **`@activeId` marks the row open in the editor beside this list, and that is a relationship across two components.** `aria-current="true"` on the active row is the minimum; ideally the editor and the row reference each other. Verify what is applied — if the active state is visual only, a screen-reader user moving between the list and the editor has no anchor.
- **The custom-logic string is echoed verbatim** into the summary, so a screen reader reads "1 AND (2 OR 3)" as characters and digits. That is unavoidable given the decision not to paraphrase, but it means the custom-logic case is materially less accessible than the all/any case, and it is worth pairing with a visually-hidden expansion.
- **Remove has no confirmation** (**WCAG 3.3.4**) and **focus after removal is unmanaged** — which is the exact trap **ExpressionBuilder** went to some trouble to fix on its own rows. The read-only list should inherit that treatment.
- **Truncated summaries keep the whole string.** The ellipsis is visual only, so a screen reader reads the full summary, and a sighted user gets it as the tooltip.
- Per-row controls in a narrow sidebar are small; check against WCAG **2.5.8**'s 24×24 minimum.

## Theming

`--inset` or `--card` for the list surface, `--border` for row rules, `--foreground` and `--muted-foreground` for summary text and the joiner, `--pretui-selected` or `--hover` for `@activeId`, plus **IconButton** tokens for the row controls and **Button** for Add.

A season must keep the active row distinguishable from hover — this list normally sits beside an editor, so one row is persistently active while the pointer moves over others, and if those two states collapse the connection between the list and the editor disappears.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
