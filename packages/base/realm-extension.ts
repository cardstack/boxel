import type { MenuItemOptions } from '@cardstack/boxel-ui/helpers';
import type { RealmIdentifier } from '@cardstack/runtime-common';

import type { CardDef } from './card-api';
import type { GetMenuItemParams } from './menu-items';

// A realm lists its extensions in its `realm.json`, as code refs in the
// RealmConfig card's `realmExtensionModules`. The host loads each one and asks
// it for what it adds to the realm's cards. See ADR 032.
//
// This describes the export a code ref names, so its members are static on a
// class. TypeScript's `implements` checks only the instance side, so a class
// declares that it is one with `satisfies`:
//
//   export class Workspace extends CardDef {
//     static provideMenuItems(card: CardDef, params: RealmExtensionMenuItemParams) { … }
//   }
//   Workspace satisfies RealmExtension;
export interface RealmExtension {
  // Items for the menu of `card`, a card in the realm that lists this
  // extension. Called each time the host builds that menu, so it must return
  // synchronously and do its work in each item's `action`.
  provideMenuItems?(
    card: CardDef,
    params: RealmExtensionMenuItemParams,
  ): MenuItemOptions[];
}

export type RealmExtensionMenuItemParams = GetMenuItemParams & {
  // The realm whose `realm.json` lists the extension, which is the realm that
  // holds `card`.
  realm: RealmIdentifier;
};
