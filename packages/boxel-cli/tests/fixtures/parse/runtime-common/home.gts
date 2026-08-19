import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { realmURL, type Query } from '@cardstack/runtime-common';

// The standard home-card pattern reaches for `@cardstack/runtime-common`
// (the `realmURL` Symbol, the `Query` type) to build realm-scoped
// queries. parse needs a path alias for the bare specifier or every such
// card fails to resolve the module.
export class Home extends CardDef {
  static displayName = 'Home';
  @field label = contains(StringField);

  get realmHref(): string | undefined {
    return this[realmURL]?.href;
  }

  get everythingQuery(): Query {
    return { filter: { not: { eq: { id: null } } } };
  }
}
