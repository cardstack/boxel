## What it is

**Pick one path through a hierarchy as one value**: Continent / Country / City, Category / Subcategory, Department / Team. The value is the path of keys, such as `['africa', 'ethiopia', 'guji']`, and the field shows it as "Africa / Ethiopia / Guji".

Reach for a neighbour when the job is different:

- **Tree** browses a hierarchy without holding a value.
- **TreeSelect** collects a set of checked nodes.
- **Select** is one flat list.

## The contract

```
@options ({ value, label, children?, disabled? }[])
@value?, @defaultValue?, @onChange? (path, labels)
@changeOnSelect?, @label?, @placeholder?, @separator? (default ' / '), @disabled?
Element: HTMLDivElement
```

**One column per level.** The trigger opens a popup with the top level in the first column. Choosing a branch opens its children in the next column, and so on down. Choosing a leaf commits the whole path, closes the popup and returns focus to the trigger.

**`@changeOnSelect`** also commits a path that ends on a branch, such as "Africa / Ethiopia", and keeps the popup open for going deeper.

**Opening lands on the value.** The committed path is expanded, with focus on its deepest option, so changing the city means one move rather than three.

`@onChange` receives both the path of values and the matching labels. Disabled options are shown, marked and skipped.

## Prior art

**Ant `Cascader`** takes `options`, `value`, `onChange`, `changeOnSelect`, `expandTrigger` (`click | hover`), `showSearch`, `multiple` and `displayRender`. **Mantine** and **Element Plus** follow the same model.

Where Pretui is better: **the keyboard follows the columns** and is fully specified (see Accessibility). Ant's keyboard support is partial and its columns have no listbox semantics. **Focus returns to the trigger** on commit and Escape.

Where it is thinner: **no search** across the hierarchy, **no multiple mode** (use **TreeSelect**), **no hover expansion**, which is deliberate: it opens columns under a passing pointer. There is **no custom display render** beyond `@separator`, and **no lazy loading** of children.

## Accessibility

No single APG pattern. It is a trigger button plus a row of listboxes.

- **The trigger** is a `<button>` with `aria-haspopup="listbox"`, `aria-expanded`, and `aria-controls` while open. It is named "{label}: {path}", so the committed value is heard. The tests assert all of these.
- **Each column is `role="listbox"`**, and each option is a `role="option"` with `aria-selected` on the active one, `aria-disabled` on disabled ones. The first column is named by `@label`, and each deeper column by its parent option ("Asia"), so the columns are told apart. The tests assert the names.
- **Keyboard.** ArrowUp and ArrowDown move within a column, wrapping and skipping disabled options. ArrowRight, Enter or Space on a branch goes into it, and commits nothing unless `@changeOnSelect`. ArrowLeft goes back out. Enter or Space on a leaf commits. Escape closes. Tab closes and moves on. The tests press each of these keys.
- **Focus.** Options use a roving `tabindex`. Focus lands on the committed path when the popup opens, or on the part of it that still exists if the options changed, and returns to the trigger on commit or Escape. The tests assert all three.

## Theming

`--input-background`, `--input`, `--ring`, `--radius-control`, `--pretui-control-h`, `--foreground`, `--muted-foreground`, `--primary` (the active option), `--popover`, `--popover-foreground`, `--pretui-shadow-raised`, `--radius-surface`, `--border` (the rule between columns), `--hover`, `--pretui-z-dropdown`, `--font-sans`, `--text-ui-md`, `--space-2` and `--space-3`.

Each column is at least 10rem wide and at most 16rem tall. The popup scrolls sideways when the path is deeper than the space available.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                             | Give them                              |
| --------------------------------------- | -------------------------------------- |
| Ant `<Cascader options value onChange>` | `<Cascader @options @value @onChange>` |
| Ant `changeOnSelect`                    | `@changeOnSelect`                      |
| Ant `displayRender`                     | `@separator`                           |
| Ant `showSearch`                        | not supported                          |
| Ant `multiple`                          | **TreeSelect**                         |
