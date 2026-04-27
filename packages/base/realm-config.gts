import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
} from './card-api';
import StringField from './string';
import MapPinnedIcon from '@cardstack/boxel-icons/map-pinned';
import LinkIcon from '@cardstack/boxel-icons/link';

export class RoutingRuleField extends FieldDef {
  static displayName = 'Routing Rule';
  static icon = LinkIcon;

  @field path = contains(StringField, {
    description: 'Static path within the realm, e.g. "/" or "/pricing"',
  });

  @field instance = linksTo(CardDef, {
    description:
      'Card instance to render when the realm is navigated at the given path',
  });
}

export class RealmConfig extends CardDef {
  static displayName = 'Realm Config';
  static icon = MapPinnedIcon;

  @field backgroundURL = contains(StringField);
  @field iconURL = contains(StringField);
  @field hostRoutingRules = containsMany(RoutingRuleField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: RealmConfig) {
      let name = this.cardInfo?.name?.trim();
      return name ? `${name} Config` : `Untitled ${RealmConfig.displayName}`;
    },
  });
}
