---
validated: source-proven
---

# link-command-menu-item — Expose a Command as a card menu item via `[getMenuItems]`

**What this gives you:** A right-click / overflow-menu entry on a card that runs a host Command with the card's data as input. The native Boxel menu chrome handles icon, label, keyboard navigation, and disabled states.

**When to use:** The Command is an *action the user takes on this specific card* — "Generate Avatar", "Send to Printer", "Reindex Linked Children", "Export as PDF", "Refresh from Source". Anywhere you'd otherwise sprinkle bespoke buttons onto the isolated template, route through the menu instead — it keeps the card's visual surface clean and gives the user a consistent place to find actions.

**The insight:** `getMenuItems` is a symbol the host calls on each card to compose its menu. Override the symbol on your CardDef (call `super[getMenuItems](params)` to keep the host's defaults), return an array of `{ label, icon, action }` entries. `params.toolContext` is what your action passes to `new MyCommand(params.toolContext)`; `params.cardCrudFunctions.saveCard` persists a card the action mutated, and `params.canEdit` / `params.menuContext` gate when an item should appear.

## Recipe shape

```ts
import { getMenuItems } from '@cardstack/runtime-common';
import { type GetMenuItemParams } from '@cardstack/base/card-api';
import { type MenuItemOptions } from '@cardstack/boxel-ui/helpers';
import MyIcon from '@cardstack/boxel-icons/sparkles';
import MyCommand from './my-command';

export class MyCardDef extends CardDef {
  [getMenuItems](params: GetMenuItemParams): MenuItemOptions[] {
    return [
      {
        label: 'My Action',
        icon: MyIcon,
        action: async () => {
          await new MyCommand(params.toolContext).execute({
            cardId: this.id,
          });
          params.cardCrudFunctions.saveCard?.(this.id);
        },
      },
      // Host defaults LAST so user-actions show on top.
      ...super[getMenuItems](params),
    ];
  }
}
```

## Conventions

- **Always `...super[getMenuItems](params)`** — preserves the host's default entries (Open, Copy, Delete, etc.). Forgetting this strips the menu.
- **Order: custom items first, defaults last.** Users read top-down; card-specific actions belong above the generic ones.
- **Icon comes from `@cardstack/boxel-icons/<name>` or `@cardstack/boxel-ui/icons/<name>`.** Match the existing menu style — small, single-color, Lucide/Tabler-flavored.
- **Label is verb-first.** "Generate avatar" not "Avatar generation". Title-cased like other menu items.
- **`action` is async.** Always `await` the Command, then call `params.cardCrudFunctions.saveCard?.(this.id)` if the action mutates fields on the card itself. `saveCard` is synchronous and returns nothing (it hands the id to the store, which saves in the background), so there is nothing to `await`; the `?.` is because `cardCrudFunctions` is a `Partial` and some menu contexts supply no save path.

## Conditional items

Return entries conditionally to hide or disable based on card state:

```ts
[getMenuItems](params: GetMenuItemParams): MenuItemOptions[] {
  const items: MenuItemOptions[] = [];
  if (this.id) {
    // Only saved cards can be exported.
    items.push({ label: 'Export', icon: ExportIcon, action: async () => { /*…*/ } });
  }
  if (!this.publishedAt) {
    items.push({ label: 'Publish', icon: PublishIcon, action: async () => { /*…*/ } });
  }
  return [...items, ...super[getMenuItems](params)];
}
```

Hide entirely when the action doesn't apply. Use `disabled: true` + a tooltip only when the action *could* apply but a precondition fails (so the user sees why it's unavailable).

`params.menuContext` says where the menu is being composed: `'interact'`, `'code-mode-preview'`, `'code-mode-playground'`, or `'ai-assistant'`. The `'ai-assistant'` variant also carries `params.menuContextParams` (`canEditActiveRealm`, `activeRealmURL`); the other variants do not, so narrow on `menuContext` before reading it. The host's own items gate on `params.menuContext === 'interact'` — do the same for actions that only make sense on an interactive card.

## Composing with other modes

- Same `MyCommand` class powers the menu item AND a primary button in the isolated template — the menu is the discoverable affordance, the button is the contextual one.
- Pair with `command-typed-with-progress` to show progress while the menu action runs: the action sets `@tracked` state on the Command instance, the template reads it.
- For AI-touching actions, the menu item opens an AI room via `command-with-skill-card-ref` instead of executing directly.

## Gotchas

- **Forgetting `...super[getMenuItems](params)`** strips the host defaults silently — the user loses Open/Copy/Delete and won't know why.
- **Heavy work inside `action`** blocks the menu close animation. Kick off the work, close the menu, surface progress via a tracked field or toast.
- **`this` inside `action`** refers to the CardDef instance because the arrow function is captured in the closure. If you write a regular method, you lose the binding.
- **Saving without `params.cardCrudFunctions.saveCard`** skips the host's permission and indexing handling. Prefer `params.cardCrudFunctions.saveCard?.(this.id)` over constructing `new SaveCardCommand(...)` yourself.

## Source

- `realms-staging.stack.cards/ctse/clover-court/menu-examples.gts` — the canonical minimal example with two custom items that set `cardInfo` and save.
- `boxel/references/command-development.md` — the underlying Command class + host-command primitives.

## See also

- `boxel/references/command-invocation-modes.md` — the menu mode in the wider invocation taxonomy.
- `command-typed-with-progress` — pair this when the action takes more than a moment.
