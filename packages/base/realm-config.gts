import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
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

  // Reference to the card instance to render when the realm is
  // navigated at `path`. Accepts any form the runtime's RRI resolver
  // accepts — absolute URLs, registered prefixes (e.g.
  // `@cardstack/catalog/foo`), `$REALM/foo`, or relative references
  // (`./foo`) — all resolved against the realm root by the routing-
  // map reader. Stored as a string (rather than `linksTo`) so the
  // rule serializes flat alongside `path` inside `attributes` — no
  // JSON:API relationships split.
  @field instance = contains(StringField, {
    description: 'Card instance to render when the realm is navigated at this path',
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
