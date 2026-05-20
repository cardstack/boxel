import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
} from './card-api';
import BooleanField from './boolean';
import StringField from './string';
import FileSettingsIcon from '@cardstack/boxel-icons/file-settings';
import LinkIcon from '@cardstack/boxel-icons/link';

export class RoutingRuleField extends FieldDef {
  static displayName = 'Routing Rule';
  static icon = LinkIcon;

  @field path = contains(StringField, {
    description: 'Static path within the realm, e.g. "/" or "/pricing"',
  });

  @field instance = linksTo(CardDef, {
    description:
      'Card instance to render when the realm is navigated at this path',
  });
}

export class RealmConfig extends CardDef {
  static displayName = 'Realm Config';
  static icon = FileSettingsIcon;

  @field backgroundURL = contains(StringField);
  @field iconURL = contains(StringField);
  @field hostRoutingRules = containsMany(RoutingRuleField);
  // Opt-in to keeping the full prerendered isolated HTML for the
  // realm's default CardsGrid index card. Default behaviour for this
  // card writes a small boilerplate placeholder instead — the
  // CardsGrid isolated render fans out into a fitted render per card
  // in the realm and dominates indexing wall-clock on larger realms,
  // and nothing reads its isolated HTML in production for an
  // unpublished realm. Set this to `true` when the realm's index is
  // served as published-realm SSR (the publish handler writes it
  // automatically in that case) or when an operator otherwise needs
  // the full isolated render present in the index.
  @field includePrerenderedDefaultRealmIndex = contains(BooleanField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: RealmConfig) {
      let name = this.cardInfo?.name?.trim();
      return name ? `${name} Config` : `Untitled ${RealmConfig.displayName}`;
    },
  });
}
