import {
  CardDef,
  CardInfoField,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { getCardMenuItems } from '@cardstack/runtime-common';
import type { GetCardMenuItemParams } from 'https://cardstack.com/base/card-menu-items';
import type { MenuItemOptions } from '@cardstack/boxel-ui/helpers';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import BuildingIcon from '@cardstack/boxel-icons/building';

// 🧩 PATTERN: expose card-scoped actions as menu items.
//
// The host calls `[getCardMenuItems]` on every CardDef when it composes
// the card's right-click / overflow menu. Override the symbol on your
// class, spread `super[getCardMenuItems](params)` to keep the host's
// defaults (Open, Copy, Delete, ...), and return your own entries.

export class Destination extends CardDef {
  static displayName = 'Destination';

  @field name = contains(StringField);

  [getCardMenuItems](params: GetCardMenuItemParams): MenuItemOptions[] {
    let hostItems = super[getCardMenuItems](params);

    return [
      {
        label: 'Set Paris info',
        icon: MapPinIcon,
        action: async () => {
          this.cardInfo = new CardInfoField({
            title: 'Paris — City of Light',
            description: 'The capital of France.',
            thumbnailURL:
              'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=400',
          });
          await params.saveCard(this);
        },
      },
      {
        label: 'Set NYC info',
        icon: BuildingIcon,
        action: async () => {
          this.cardInfo = new CardInfoField({
            title: 'New York — The Big Apple',
            description: 'The most populous city in the United States.',
            thumbnailURL:
              'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=400',
          });
          await params.saveCard(this);
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
//   - params.commandContext  → pass to `new MyCommand(params.commandContext)`
//   - params.saveCard(card)  → host-aware save (permissions, indexing)
//   - params.realmURL        → realm scope for queries/writes
//
// For a heavier action, swap the body of `action` for a Command
// invocation:
//
//   import MyExpensiveCommand from './my-expensive-command';
//   ...
//   action: async () => {
//     await new MyExpensiveCommand(params.commandContext).execute({
//       cardId: this.id,
//     });
//     await params.saveCard(this);
//   },
//
// Pair with command-typed-with-progress when the action takes more
// than a moment so the menu can close and the card's template can
// reflect progress.
