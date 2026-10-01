## What it is

**TagsInput** is **TokenInput** under the name Mantine and Chakra use. It renders TokenInput and only maps the Mantine argument spellings onto it, so there is one tag row in the kit, not two that drift apart. Import it when a port already says TagsInput; the **TokenInput** writeup carries the depth.

Type a string, commit it to a chip, keep typing. The value is `string[]`: labels, skills, keywords, or recipients typed as text. **MultiSelect** picks from a known set, and **Lookup** references records.

## The contract

```
@value?, @defaultValue?, @onChange? (alias @onValueChange)
@label?, @placeholder?, @max?
@duplicates?   — maps to TokenInput's allowDuplicates
@separators?   — characters that commit besides Enter (default [','])
@disabled?
Element: HTMLDivElement
```

Everything else is TokenInput's:

- **Committing.** Enter, a separator, a newline or tab, a paste, or leaving the field commits the text. A pasted list commits each piece.
- **Refusing.** Text is trimmed, and empty pieces never become tags. A duplicate is refused, case-insensitively, unless `@duplicates`. At `@max` the field goes readonly and says "List is full". Each refusal is announced ("East is already in the list", "List is full at 5 items").
- **Removing.** Backspace in an empty field removes the last tag. Every chip has a remove button named for its tag, and focus returns to the field after a removal.
- **Composing.** The Enter that confirms an IME composition commits nothing.

## Prior art

**Mantine `TagsInput`** takes `value`, `onChange`, `data` (suggestions), `maxTags`, `allowDuplicates`, `splitChars`, `acceptValueOnBlur` and `clearable`. **Chakra `TagsInput`** (v3) has the same commit and remove model with `max` and `delimiter`. **Ant `Select mode="tags"`** combines free tags with a dropdown of options.

Mantine's `maxTags` is `@max`, `allowDuplicates` is `@duplicates` and `splitChars` is `@separators`. What TokenInput adds: every add, refusal and removal is announced, the remove buttons are named for their tag, and the field goes readonly rather than disabled at the cap, so focus never falls to the page. What it lacks: a suggestion dropdown (use **Combobox** or **MultiSelect** when there is a known list) and a clear-all button.

## Accessibility

Identical to TokenInput. The field is labelled by `@label`. The chips are a list, each with a named remove button. One `role="status"` line announces every add, refusal and removal. At the cap the field is `readonly` with `aria-disabled`, so it keeps focus and Backspace still removes. The tests assert the chip's name, the case-insensitive refusal and its announcement, and the IME guard.

## Theming

Identical to TokenInput: the chips are the kit's **Chip** treatment and the field is the kit's input, so a tag row looks like the chips used elsewhere. It reads `--input`, `--ring`, `--radius`, `--control-h`, `--foreground` and `--text-ui-md`.

## React ecosystem

| Mantine / Chakra / Ant                    | Pretui                         |
| ----------------------------------------- | ------------------------------ |
| Mantine `<TagsInput value onChange>`      | `<TagsInput @value @onChange>` |
| Mantine `maxTags` / Chakra `max`          | `@max`                         |
| Mantine `allowDuplicates`                 | `@duplicates`                  |
| Mantine `splitChars` / Chakra `delimiter` | `@separators`                  |
| Mantine `data` (suggestions)              | **Combobox** / **MultiSelect** |
| Ant `<Select mode="tags">`                | `<TagsInput>` for free text    |
