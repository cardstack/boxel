## What it is

The ⌘K palette: a search field over the same command tree **Menu** renders, opened by a global shortcut.

One definition, two surfaces — the commands in a menubar and the commands in a palette are the same tree, not two lists that drift apart.

## The contract

```
@items (required) — the same tree Menu renders
@open?, @onClose (required) — the palette's visibility
@onOpen?       — opens the palette; supply it to enable @hotkey
@hotkey?       — global shortcut that opens the palette. Default 'Mod+K'; needs @onOpen
@placeholder?, @label?, @emptyMessage?
@onSelect?     — fires after any command runs
@platform?     — force the shortcut platform
```

**`@hotkey` does nothing without `@onOpen`.** The palette cannot open itself into a caller's state, so the global shortcut is only wired when there is something to call — the same conditional-affordance rule the kit applies everywhere.

**Shortcuts render through Kbd**, so a command's accelerator shows the platform-correct face without the command tree knowing which platform it is on.

**`@emptyMessage` means no matches says something** rather than showing an empty list.

## Prior art

The command palette in editors and the `cmdk` family.

Where Pretui is better: sharing the menu tree. Most palettes take their own flat command list, which means a product maintains two definitions of what its commands are and they disagree within a release.

Where it is thinner: no fuzzy-match scoring controls, no command groups or scoping beyond the tree's own structure, no recent commands, and no nested palette modes ("type > to run a command").

## Accessibility

- **The field is a real search input** and the list a real listbox, so the arrow/Enter model is the platform's.
- **The palette is named**, which matters because it is a dialog appearing over whatever the reader was doing.
- **A global hotkey is a strong commitment**: `Mod+K` is taken from the page, and a reader who uses that chord for something else loses it. It is opt-in through `@onOpen` rather than always on.
- **Shortcut faces come from Kbd**, which means each one carries the platform-neutral spelling as its announced form rather than a run of glyphs.
- **`@emptyMessage` is announced**, so a search with no results is a stated outcome.

## Theming

The palette takes the kit's overlay, input and menu tokens; the shortcut faces take **Kbd**'s.

Sharing the menu tokens is what makes a command look the same in the palette as it does in the menubar — which is the visible half of the shared-tree design.
