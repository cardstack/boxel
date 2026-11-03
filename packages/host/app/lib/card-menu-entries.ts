import type { MenuItemOptions } from '@cardstack/boxel-ui/helpers';

import type { MenuEntry } from '@cardstack/pretui/internal/menu';

// A card's own menu items (its `getMenuItems`) as Pret UI menu entries. Pret
// UI names its icons by registry key, so a card item's icon component is not
// carried over; a header item has no command, so it is left out.
export function cardMenuEntries(items: MenuItemOptions[]): MenuEntry[] {
  return items
    .filter((item) => !item.header)
    .map((item) => ({
      label: item.label,
      destructive: item.dangerous,
      disabled: item.disabled || item.inactive,
      onSelect: item.action,
    }));
}
