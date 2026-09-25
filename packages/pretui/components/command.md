## What it is

**CommandPalette** under the name shadcn and cmdk use. The export is the same class — `import { Command } from './command';` resolves to CommandPalette — so the tile exists for a port of a shadcn `Command` block or an agent whose first guess is that word. The contract and the depth are on **CommandPalette**; this page maps cmdk's parts onto it. **Menu** renders the same tree in place; **ContextMenu** and **Menubar** are the other surfaces over it.

## The contract

```
@items           — required; the MenuNode tree Menu renders
@open?, @onClose — required onClose; controlled visibility over a native <dialog>
@onOpen?         — opens the palette; supply it to enable @hotkey
@hotkey?         — global shortcut (default 'Mod+K'); does nothing without @onOpen
@placeholder?, @label?, @emptyMessage?
@onSelect?       — after any command runs
@platform?       — force the shortcut platform
```

**There are no parts to assemble.** cmdk is a set of components a consumer nests; here the nesting is data — sections become group headers, submenus become enterable scopes that are also searchable, and the input, list and empty state are rendered for you.

## Prior art

**shadcn `Command`** wraps **cmdk**: `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem` (with `onSelect`, `keywords`, `disabled`), `CommandEmpty`, `CommandShortcut`, `CommandSeparator`, and `shouldFilter` / `filter` / `loop` on the root. **Mantine Spotlight** is a store-driven modal with `actions`, `nothingFound` and `shortcut`.

Where this is better: one command tree shared with Menu, so the menubar and the palette cannot disagree about what the commands are; nested submenus flatten into search with their path shown, and descend into breadcrumb scopes (kbar's model), where cmdk has flat groups; the fuzzy matcher prefers word-boundary initials; the dialog is a native `<dialog>`, so top layer, focus trap and Escape are the platform's.

Where it is thinner: no `filter` function or `shouldFilter` escape hatch, no `loop`, no per-item render slot — an item is a MenuNode, not JSX — and no recent-commands or mode prefix.

## Accessibility

CommandPalette's: a combobox, not a menu. The input keeps focus and `aria-activedescendant` points at the active row, which is the pattern assistive tech handles for a filtered list; the palette is a named dialog; shortcut faces render through **Kbd** so they are announced as text rather than glyphs; `@emptyMessage` makes a fruitless search a stated outcome. The global hotkey takes `Mod+K` from the page and is opt-in through `@onOpen`.

## Theming

CommandPalette's: the kit's overlay, input and menu tokens, so a command looks the same in the palette as in the menubar, plus `--pretui-palette-hit` for the match highlight. Nothing is themed under a Command name.

## React ecosystem

| shadcn / cmdk                              | Pretui                                              |
| ------------------------------------------ | --------------------------------------------------- |
| `<Command>` + `<CommandDialog>`            | `<Command @open @onClose>` — the dialog is built in |
| `<CommandInput placeholder>`               | `@placeholder`                                      |
| `<CommandList>` / `<CommandGroup heading>` | sections in `@items`                                |
| `<CommandItem onSelect keywords>`          | a MenuNode `action` with `keywords`                 |
| `<CommandEmpty>`                           | `@emptyMessage`                                     |
| `<CommandShortcut>`                        | the node's `kbd`, rendered by Kbd                   |
| `shouldFilter` / `filter` / `loop`         | not offered                                         |
