## What it is

**A textarea that offers suggestions after a trigger character and inserts the chosen one**: "@Ana Ruiz, can you check lot 7?". Use it in comments, composers, captions and anywhere else people refer to each other or to records by name.

The text stays a plain string, with no contenteditable, so copy, paste, undo and spellcheck behave like any textarea. `@onMention` reports each insertion for whoever stores the references.

Reach for a neighbour when the input is different:

- **Combobox** picks one value from a list.
- **TagsInput** builds a list of strings.
- **Textarea** is plain text with no suggestions.

## The contract

```
@items ({ id, label }[]), @value?, @defaultValue?, @onChange?
@onQuery?, @onMention?
@trigger? (default '@'), @limit? (default 8)
@label?, @placeholder?, @rows? (default 3), @disabled?
<:item as |item active|>   — one suggestion's face
Element: HTMLDivElement
```

**When the list opens.** A trigger character at the start of the text, or after whitespace, followed by a query with no spaces, opens the list. So a trigger typed at the start of a word opens it, and one straight after other text, as in an email address, does not. The query is read at the caret, so a mention can be inserted in the middle of existing text.

**Filtering.** By default `@items` is filtered to labels containing the query, ignoring case. With `@onQuery`, the component reports each query and shows `@items` as given, so a remote search can replace them.

**Inserting.** Enter or Tab inserts the active suggestion, and so does pressing one with the pointer. The query is replaced with the trigger and the label, plus a space unless the text already continues with one, and the text after the caret is kept. The insertion goes through the browser's editing stack, so Ctrl+Z takes it back. The caret lands after the mention, and focus stays in the textarea.

**Dismissing.** Escape closes the list for the current query. Typing a new trigger opens it again.

## Prior art

**Ant `Mentions`** is the only major kit primitive: `options`, `prefix` (several triggers), `split`, `onSearch`, `onSelect`, `placement` and `filterOption`. **react-mentions** and **Tiptap's mention extension** are what agents otherwise reach for. They use an overlay or contenteditable and store markup in the value.

Where Pretui is better: **the value is plain text**, so it stores and diffs like any string. **The suggestions are a real listbox** driven with `aria-activedescendant`, so the textarea keeps focus. Ant uses a separate dropdown that screen readers can't follow from the textarea.

Where it is thinner: **one trigger character**, where Ant accepts several prefixes. **The list sits under the textarea, not at the caret.** **Mentions are not styled as tokens inside the text**, and there is no structured value: storing references is the caller's job, from `@onMention`.

## Accessibility

APG **Combobox** (the listbox half), on a native textarea.

- **The textarea is named by `@label`** and carries `aria-autocomplete="list"`. While suggestions show, it points at the listbox with `aria-controls`, and at the active option with `aria-activedescendant`. The tests assert both.
- **The list is `role="listbox"`** and each suggestion is a `role="option"`, with `aria-selected` on the active one.
- **Keyboard.** ArrowDown and ArrowUp move (wrapping), Enter and Tab insert, and Escape closes. Tab only inserts while the list is open; otherwise it moves focus as usual. The tests assert the movement, the insertion and the dismissal.
- **Focus never leaves the textarea.** A pointer press on an option is handled on `pointerdown`, which is cancelled so the textarea keeps focus. The tests assert the press is cancelled. The Enter that confirms an IME composition belongs to the IME and inserts nothing, which the tests also assert.
- **Nothing is announced when the list opens.** Screen reader users learn about it from the listbox relationship. Describe the trigger in the placeholder or nearby text ("Type @ to mention someone").

## Theming

`--input-background` (default `--card`), `--input` (default `--border`), `--ring`, `--radius-control`, `--foreground`, `--font-sans`, `--text-ui-md`, `--leading-body`, `--space-3`, and for the list `--popover`, `--popover-foreground`, `--pretui-shadow-raised`, `--radius-surface`, `--hover` and `--pretui-z-dropdown`.

The list's 14rem maximum height is fixed.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                               | Give them                                |
| ----------------------------------------- | ---------------------------------------- |
| Ant `<Mentions options onSelect>`         | `<Mentions @items @onMention>`           |
| Ant `onSearch`                            | `@onQuery`                               |
| Ant `prefix={['@', '#']}`                 | one `@trigger`; render two for two       |
| react-mentions `<MentionsInput><Mention>` | `<Mentions>`; the value stays plain text |
