---
validated: source-proven
---

# link-command-menu-item — Expose a Command as a card menu item via `[getCardMenuItems]`

**What this gives you:** A right-click / overflow-menu entry on a card that runs a host Command with the card's data as input. The native Boxel menu chrome handles icon, label, keyboard navigation, and disabled states.

**When to use:** The Command is an *action the user takes on this specific card* — "Generate Avatar", "Send to Printer", "Reindex Linked Children", "Export as PDF", "Refresh from Source". Anywhere you'd otherwise sprinkle bespoke buttons onto the isolated template, route through the menu instead — it keeps the card's visual surface clean and gives the user a consistent place to find actions.

**The insight:** `getCardMenuItems` is a symbol the host calls on each card to compose its menu. Override the symbol on your CardDef (call `super[getCardMenuItems](params)` to keep the host's defaults), return an array of `{ label, icon, action }` entries. `params.commandContext` is what your action passes to `new MyCommand(params.commandContext)`; `params.realmURL` and `params.saveCard` give you the rest.

## Recipe shape

```ts
import { getCardMenuItems } from '@cardstack/runtime-common';
import { type GetCardMenuItemParams } from 'https://cardstack.com/base/card-menu-items';
import { type MenuItemOptions } from '@cardstack/boxel-ui/helpers';
import MyIcon from '@cardstack/boxel-icons/sparkles';
import MyCommand from './my-command';

export class MyCardDef extends CardDef {
  [getCardMenuItems](params: GetCardMenuItemParams): MenuItemOptions[] {
    return [
      {
        label: 'My Action',
        icon: MyIcon,
        action: async () => {
          await new MyCommand(params.commandContext).execute({
            cardId: this.id,
          });
          await params.saveCard(this);
        },
      },
      // Host defaults LAST so user-actions show on top.
      ...super[getCardMenuItems](params),
    ];
  }
}
```

## Conventions

- **Always `...super[getCardMenuItems](params)`** — preserves the host's default entries (Open, Copy, Delete, etc.). Forgetting this strips the menu.
- **Order: custom items first, defaults last.** Users read top-down; card-specific actions belong above the generic ones.
- **Icon comes from `@cardstack/boxel-icons/<name>` or `@cardstack/boxel-ui/icons/<name>`.** Match the existing menu style — small, single-color, Lucide/Tabler-flavored.
- **Label is verb-first.** "Generate avatar" not "Avatar generation". Title-cased like other menu items.
- **`action` is async.** Always `await` the Command, then `await params.saveCard(this)` if the action mutates fields on the card itself.

## Conditional items

Return entries conditionally to hide or disable based on card state:

```ts
[getCardMenuItems](params: GetCardMenuItemParams): MenuItemOptions[] {
  const items: MenuItemOptions[] = [];
  if (this.id) {
    // Only saved cards can be exported.
    items.push({ label: 'Export', icon: ExportIcon, action: async () => { /*…*/ } });
  }
  if (!this.publishedAt) {
    items.push({ label: 'Publish', icon: PublishIcon, action: async () => { /*…*/ } });
  }
  return [...items, ...super[getCardMenuItems](params)];
}
```

Hide entirely when the action doesn't apply. Use `disabled: true` + a tooltip only when the action *could* apply but a precondition fails (so the user sees why it's unavailable).

## Composing with other modes

- Same `MyCommand` class powers the menu item AND a primary button in the isolated template — the menu is the discoverable affordance, the button is the contextual one.
- Pair with `command-typed-with-progress` to show progress while the menu action runs: the action sets `@tracked` state on the Command instance, the template reads it.
- For AI-touching actions, the menu item opens an AI room via `command-with-skill-card-ref` instead of executing directly.

## Gotchas

- **Forgetting `...super[getCardMenuItems](params)`** strips the host defaults silently — the user loses Open/Copy/Delete and won't know why.
- **Heavy work inside `action`** blocks the menu close animation. Kick off the work, close the menu, surface progress via a tracked field or toast.
- **`this` inside `action`** refers to the CardDef instance because the arrow function is captured in the closure. If you write a regular method, you lose the binding.
- **Saving without `params.saveCard`** skips the host's permission and indexing handling. Prefer `params.saveCard(this)` over constructing `new SaveCardCommand(...)` yourself.

## Source

- `realms-staging.stack.cards/ctse/clover-court/menu-examples.gts` — the canonical minimal example with two custom items that set `cardInfo` and save.
- `boxel/references/command-development.md` — the underlying Command class + host-command primitives.

## See also

- `boxel/references/command-invocation-modes.md` — the menu mode in the wider invocation taxonomy.
- `command-typed-with-progress` — pair this when the action takes more than a moment.
