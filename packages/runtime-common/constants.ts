import { RealmPaths } from './paths';
import type { ResolvedCodeRef } from './code-ref';

export const baseRealm = new RealmPaths(new URL('https://cardstack.com/base/'));

export const baseRef: ResolvedCodeRef = {
  module: `${baseRealm.url}card-api`,
  name: 'BaseDef',
};
export const specRef: ResolvedCodeRef = {
  module: `${baseRealm.url}spec`,
  name: 'Spec',
};
export const baseCardRef: ResolvedCodeRef = {
  module: `${baseRealm.url}card-api`,
  name: 'CardDef',
};
export const baseFieldRef: ResolvedCodeRef = {
  module: `${baseRealm.url}card-api`,
  name: 'FieldDef',
};
export const skillCardRef: ResolvedCodeRef = {
  module: `${baseRealm.url}skill`,
  name: 'Skill',
};

export const isField = Symbol('cardstack-field');
export const primitive = Symbol('cardstack-primitive');
export const realmURL = Symbol.for('cardstack-realm-url');
export const localId = Symbol.for('cardstack-local-id');
export const meta = Symbol.for('cardstack-meta');

export const aiBotUsername = 'aibot';

export const CardContextName = 'card-context';
export const DefaultFormatsContextName = 'default-format-context';
export const GetCardContextName = 'get-card-context';
export const GetCardsContextName = 'get-cards-context';
export const GetCardCollectionContextName = 'get-card-collection-context';

export const PermissionsContextName = 'permissions-context';

export const CardURLContextName = 'card-url-context';

export const RealmURLContextName = 'realm-url-context';

export interface Permissions {
  readonly canRead: boolean;
  readonly canWrite: boolean;
}
