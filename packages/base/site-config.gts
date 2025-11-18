import { CardDef, Component, field, linksTo } from './card-api';
import { getCardMenuItems } from '@cardstack/runtime-common';
import { type GetCardMenuItemParams } from './card-menu-items';
import { type MenuItemOptions } from '@cardstack/boxel-ui/helpers';
import SetSiteConfigCommand from '@cardstack/boxel-host/commands/set-site-config';
import HomeIcon from '@cardstack/boxel-icons/home';

// Site level configuration card. Additional routing fields can be added over time.
export class SiteConfig extends CardDef {
  static displayName = 'Site Configuration';

  @field home = linksTo(CardDef);

  [getCardMenuItems](params: GetCardMenuItemParams): MenuItemOptions[] {
    let menuItems = super[getCardMenuItems](params);
    let isPrimarySiteConfig =
      typeof this.id === 'string' &&
      (this.id.endsWith('/site') || this.id.endsWith('/site.json'));
    if (isPrimarySiteConfig) {
      return menuItems;
    }
    menuItems = [
      {
        label: 'Set as site home',
        action: async () => {
          await new SetSiteConfigCommand(params.commandContext).execute({
            cardId: this.id,
          });
        },
        icon: HomeIcon,
        tags: ['site-config'],
      },
      ...menuItems,
    ];
    return menuItems;
  }

  static isolated = class Isolated extends Component<typeof SiteConfig> {
    <template>
      <div class='site-config-home-card' data-test-site-config-home>
        <@fields.home />
      </div>
      <style scoped>
        .site-config-home-card {
          width: 100%;
          height: 100%;
        }
      </style>
    </template>
  };
}
