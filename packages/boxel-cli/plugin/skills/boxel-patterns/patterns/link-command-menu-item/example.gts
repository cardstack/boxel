import {
  CardDef,
  CardInfoField,
  field,
  contains,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { getMenuItems } from '@cardstack/runtime-common';
import { type GetMenuItemParams } from '@cardstack/base/card-api';
import { type MenuItemOptions } from '@cardstack/boxel-ui/helpers';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import BuildingIcon from '@cardstack/boxel-icons/building';

// 🧩 PATTERN: expose card-scoped actions as menu items.
//
// The host calls `[getMenuItems]` on every CardDef when it composes
// the card's right-click / overflow menu. Override the symbol on your
// class, spread `super[getMenuItems](params)` to keep the host's
// defaults (Open, Copy, Delete, ...), and return your own entries.

export class Destination extends CardDef {
  static displayName = 'Destination';

  @field name = contains(StringField);

  [getMenuItems](params: GetMenuItemParams): MenuItemOptions[] {
    let hostItems = super[getMenuItems](params);

    return [
      {
        label: 'Set Paris info',
        icon: MapPinIcon,
        action: async () => {
          this.cardInfo = new CardInfoField({
            name: 'Paris — City of Light',
            summary: 'The capital of France.',
            cardThumbnailURL:
              'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=400',
          });
          params.cardCrudFunctions.saveCard?.(this.id);
        },
      },
      {
        label: 'Set NYC info',
        icon: BuildingIcon,
        action: async () => {
          this.cardInfo = new CardInfoField({
            name: 'New York — The Big Apple',
            summary: 'The most populous city in the United States.',
            cardThumbnailURL:
              'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=400',
          });
          params.cardCrudFunctions.saveCard?.(this.id);
        },
      },
      // Host defaults LAST so user-actions show on top.
      ...hostItems,
    ];
  }
}

// --- Notes ---
//
// `params` carries everything you need to write back:
//   - params.toolContext                  → pass to `new MyCommand(params.toolContext)`
//   - params.cardCrudFunctions.saveCard(id) → host-aware save (permissions, indexing)
//   - params.canEdit / params.menuContext → gate which items appear
//
// For a heavier action, swap the body of `action` for a Command
// invocation:
//
//   import MyExpensiveCommand from './my-expensive-command';
//   ...
//   action: async () => {
//     await new MyExpensiveCommand(params.toolContext).execute({
//       cardId: this.id,
//     });
//     params.cardCrudFunctions.saveCard?.(this.id);
//   },
//
// Pair with command-typed-with-progress when the action takes more
// than a moment so the menu can close and the card's template can
// reflect progress.
