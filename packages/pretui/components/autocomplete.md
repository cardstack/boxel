## What it is

Suggest-as-you-type over a list, where the value may be free text.

That last clause is the whole difference from **Combobox**: an autocomplete's value **is** what the reader typed, and the suggestions are help. A combobox's value is constrained to its listbox. If a typed value that matches nothing is still a legal answer, you want this one.

## The contract

```
@value?, @defaultValue?   — controlled / uncontrolled text
@items? / @options?       — the suggestion collection; options is the React-kit alias
@open?, @defaultOpen?, @onOpenChange? — the suggestion layer
@onSearch?                — the debounced query, for a caller that fetches;
                            pair with @filter='none'
@onCommit?                — fires when a value is COMMITTED — Enter, a click, or blur —
                            with the suggestion when one was chosen, undefined for free text
@debounce?                — SECONDS of quiet before @onSearch. Default 0, which fires on
                            every keystroke and schedules no timer at all
@filter?                  — matching strategy
@enterCommits?            — what Enter means when the highlight and the typed text disagree:
                            'deliberate' (default) | 'highlight' | 'text'
@autoHighlight?           — pre-highlight the first row when suggestions appear
@openOnFocus?             — open the layer on focus. Default true
@minChars?                — suppress the layer until this many characters are typed
@clearable?, @invalid?, @disabled?, @required?, @readonly?, @placeholder?
@busy? / @loading? / @isPending? — aria-busy, a progress line, and FOCUS RETAINED
@label?, @controlId?, @describedBy?
@emptyText?               — replaces the built-in "No matches" line
@tone?, @appearance?, @size?

<:item>  — replaces the row body; yields the item and { query, active }
<:empty> — replaces the built-in empty line
```

**`@onCommit` is the callback that distinguishes typing from meaning it.** It fires on Enter, a click or a blur, and it tells you *which* happened: a suggestion object when one was chosen, `undefined` when the reader meant their own text.

**`@enterCommits` defaults to `'deliberate'`, and that is the interesting decision.** When the highlight and the typed text disagree, Enter takes the typed text unless the reader deliberately moved to the highlight. An automatic highlight does **not** win Enter — so `@autoHighlight` is a visual aid rather than a trap that silently replaces what someone typed.

**`@debounce` is in seconds, and 0 schedules no timer at all.** The default fires on every keystroke.

**`@label` renders a real `sr-only` `<label for>` unless a wrapper claims the field with `@controlId`**, so the field is named whether or not it sits inside a **Field**.

## Prior art

**Mantine**, **MUI**, **Ant**, **Base UI** and **React Aria** all ship an Autocomplete.

Where Pretui is better: **`@enterCommits` as an explicit contract.** Every upstream has an implicit answer to "what does Enter do when I've typed something and a row is highlighted", and most of them silently discard the typed text. Making it a named arg with a conservative default turns a surprise into a decision. The commit callback distinguishing chosen-from-list versus free text is the second: most kits emit a value and leave the caller to guess.

Where it is thinner: no multi-select or token mode — that is **TokenInput** — no grouped or sectioned suggestions, no async loading state beyond `@busy`, and no virtualisation, so a very long suggestion list renders in full.

## Accessibility

- **Rows are rendered inside an `aria-hidden` face, and the option's accessible name is computed rather than scraped.** That is what makes `<:item>` safe: any markup is legal in the block because none of it reaches the accessibility tree.
- **`@busy` retains focus.** A field that disables itself while fetching suggestions throws the reader to the document mid-word.
- **The field is always named** — through `@label` as an `sr-only` label, or through a wrapper's `@controlId`.
- **`@minChars` suppresses the layer silently.** A reader who types one character and gets nothing is not told why; if the threshold is high, say so in `@placeholder` or in help text.
- **The deliberate Enter mode is an accessibility property, not only a usability one.** A screen-reader user arrowing through suggestions has moved deliberately; someone typing has not, and their text should survive.
- **`@emptyText` and `<:empty>` mean "no matches" is stated** rather than being an empty box.

## Theming

Tone, appearance and size resolve through the kit's shared recipe system, so the field matches every other control in a form at the same size.

The suggestion layer rides the kit's overlay tokens rather than defining its own surface, which is what keeps an autocomplete's dropdown at the same elevation and radius as a **Select**'s or a **Combobox**'s in the same season — three components that would look like three different products if each owned its own popover styling.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
