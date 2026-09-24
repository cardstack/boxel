## What it is

A text field for filtering or querying, with a clear button that appears once it holds text. Use it above a **DataGrid**, a **FilterList**, or any list a user narrows by typing. If the field selects a _value_ from a list rather than filtering one, use **Combobox** or **Lookup**. If it filters by category rather than by text, **FilterChips**.

## The contract

```
@value?, @placeholder?, @disabled?, @controlId?
@clearable? (default true)
@onInput?(value: string)
```

**The clear button appears only when there is text and the field is enabled** (`showClear` is `clearable && current !== '' && !disabled`), so an empty search field has no dead affordance.

**The internal value tracks even when controlled.** `@tracked internal = @value ?? ''`, and `handleInput` writes `internal` _and_ calls `@onInput` unconditionally — unlike the rest of the kit, which only writes internal state when the component is uncontrolled. That means a controlled SearchInput briefly holds two copies of the value. In practice it works because the field re-renders from `@value`, but it is a deviation from the kit-wide hybrid idiom and worth knowing if you see a stale clear button.

`clear` sets the internal value to `''` **and** calls `@onInput('')`, so a controlled parent is told about the clear rather than having to notice it.

There is no debounce. `@onInput` fires per keystroke, and throttling is the caller's job — which is right for a component that cannot know whether the filter is a synchronous array filter or a network round trip.

## Prior art

**React Aria `useSearchField`** is the reference: `type` defaults to `'search'`, **Escape clears the field and fires `onClear`**, and the clear button gets a localized `aria-label` of "Clear search" and is explicitly not a submit button. **Web Awesome** has no search field — `wa-input type="search"` with `with-clear`. **shadcn** has none.

Where Pretui matches the field: the conditional clear button, and `@onInput` receiving the string.

Where it is behind React Aria, and the first one is the notable gap:

- **No Escape-to-clear.** This is the search field's one keyboard convention, it costs a `keydown` handler, and every serious implementation has it. Its absence means a keyboard user must Tab to the clear button or select-all-delete.
- **No `onClear` distinct from `onInput('')`.** A caller cannot tell "the user cleared" from "the user deleted the last character", which matters if clearing should also reset filters or close a results panel.
- **No search icon.** Every reference implementation has a leading magnifier; here the field is visually indistinguishable from a plain **Input** until you type. That is the clearest visual gap.
- **No result-count announcement hook** (see below).

## Accessibility

No APG pattern. The convention is `<input type="search">` inside a `role="search"` landmark (or a `<form role="search">`), with a labelled clear button and a live region for result counts.

Gaps, in order:

- **Result counts are not announced, and nothing here provides a hook.** This is the most important accessibility fact about any search field: a sighted user sees the list shrink, a screen-reader user gets silence. The fix is a `role="status"` region containing "24 results" — and **it must exist in the DOM before the count changes**, which is the usual live-region requirement. That region belongs to the caller, and this component neither provides nor prompts for one.
- **No Escape-to-clear** (above) is an accessibility gap as much as a usability one — it is the expected keyboard affordance.
- **The clear button's accessible name and tab position need checking.** It must be labelled ("Clear search"), must be `type="button"` so it never submits an enclosing form, and — arguably — should be reachable, unlike a password reveal toggle, since clearing is a real action.
- **Clearing announces nothing.** After pressing clear, focus should generally return to the field, and the empty state should be discoverable. Verify where focus lands.
- **No `role="search"` landmark.** The component does not wrap itself in one and there is no arg for it, so a page's search is not findable by landmark navigation unless the caller adds it.
- **No accessible name of its own.** Outside **Field**/**FormField** and without an explicit `aria-label`, the field is unnamed — and search fields are the most likely control in any kit to be shipped with only a placeholder, which is not a label.
- **`@disabled` uses the native attribute**, removing the field from the tab order — and also hides the clear button, which is correct.

## Theming

Consumed: `--field`, `--input`, `--primary` (focus ring via `--ring`), `--ink-3` (placeholder), `--control-h`, `--radius`, `--text-ui-md`, `--text-ui-sm`, `--text-ui-xs`, `--track-ui`, plus **IconButton**'s tokens for the clear affordance.

Forwarded into boxel-ui through the `--boxel-*` channel, matching **Input**'s metrics exactly.

`data-filled` is reflected on the wrapper when the clear button is showing, so a season can dress the filled state — a stronger hairline, a changed placeholder treatment — which is the only hook available for signalling "this search is active" without adding markup. Worth using, since the clear button alone is a small signal at 28px.
