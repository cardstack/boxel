import { CardDef, field, contains, linksToMany } from './card-api';
import BooleanField from './boolean';
import NumberField from './number';
import StringField from './string';
import { getCardMenuItems } from '@cardstack/runtime-common';
import { type GetCardMenuItemParams } from './card-menu-items';
import { type MenuItemOptions } from '@cardstack/boxel-ui/helpers';
import SetUserSystemCardCommand from '@cardstack/boxel-host/commands/set-user-system-card';
import AppsIcon from '@cardstack/boxel-icons/apps';

export class ModelConfiguration extends CardDef {
  static displayName = 'Model Configuration';

  @field modelId = contains(StringField, {
    description: 'The openrouter identifier for the LLM model',
  });

  @field temperature = contains(NumberField, {
    description: 'Temperature setting for model output randomness',
  });

  @field toolsSupported = contains(BooleanField, {
    description: 'Whether this model configuration supports tool usage',
  });
}

export class SystemCard extends CardDef {
  static displayName = 'System Card';

  @field modelConfigurations = linksToMany(ModelConfiguration, {
    description: 'List of available model configurations for this system',
  });

  [getCardMenuItems](params: GetCardMenuItemParams): MenuItemOptions[] {
    let menuItems = super[getCardMenuItems](params);
    menuItems = [
      {
        label: 'Set as my system card',
        action: async () => {
          await new SetUserSystemCardCommand(params.commandContext).execute({
            cardId: this.id,
          });
        },
        icon: AppsIcon,
        tags: ['system-card'],
      },
      ...menuItems,
    ];

    return menuItems;
  }
}
