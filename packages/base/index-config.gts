import { getCardMenuItems } from '@cardstack/runtime-common';
import { type GetCardMenuItemParams } from './card-menu-items';
import { type MenuItemOptions } from '@cardstack/boxel-ui/helpers';
import SetInteractHomeCommand from '@cardstack/boxel-host/commands/set-interact-home';
import HomeIcon from '@cardstack/boxel-icons/home';
import { SiteConfig } from './site-config';

// IndexConfig mirrors SiteConfig but is intended to be used as the configurable
// home for interact mode so it can evolve independently over time.
export class IndexConfig extends SiteConfig {
  static displayName = 'Index Configuration';

  [getCardMenuItems](params: GetCardMenuItemParams): MenuItemOptions[] {
    let menuItems = super[getCardMenuItems](params);
    let isPrimaryIndexConfig =
      typeof this.id === 'string' &&
      (this.id.endsWith('/index') || this.id.endsWith('/index.json'));
    if (isPrimaryIndexConfig) {
      return menuItems;
    }
    menuItems = [
      {
        label: 'Set as interact home',
        action: async () => {
          await new SetInteractHomeCommand(params.commandContext).execute({
            cardId: this.id,
          });
        },
        icon: HomeIcon,
        tags: ['index-config'],
      },
      ...menuItems,
    ];
    return menuItems.filter(
      (item) => item.label !== 'Set as site home', // Remove site home option from index config menu
    );
  }
}
