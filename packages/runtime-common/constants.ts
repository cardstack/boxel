import { RealmPaths } from './paths';
import type { ResolvedCodeRef } from './code-ref';
import type { RealmPermissions } from './index';

export const baseRealm = new RealmPaths(new URL('https://cardstack.com/base/'));

export const devSkillLocalPath = 'Skill/boxel-dev-1203';
export const envSkillLocalPath = 'Skill/boxel-env-1205';

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
export const fields = Symbol.for('cardstack-fields');
export const fieldSerializer = Symbol.for('cardstack-field-serializer');
export const fieldsUntracked = Symbol.for('cardstack-fields-untracked');
export const getCardMenuItems = Symbol.for('cardstack-get-card-menu-items');
export const isBaseInstance = Symbol.for('isBaseInstance');
export const localId = Symbol.for('cardstack-local-id');
export const meta = Symbol.for('cardstack-meta');
export const realmURL = Symbol.for('cardstack-realm-url');
export const relativeTo = Symbol.for('cardstack-relative-to');

export const aiBotUsername = 'aibot';

export const CardContextName = 'card-context';
export const CardCrudFunctionsContextName = 'card-crud-functions-context';
export const CommandContextName = 'command-context';
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

export const SEARCH_MARKER: string = '╔═══ SEARCH ════╗';
export const SEPARATOR_MARKER: string = '╠═══════════════╣';
export const REPLACE_MARKER: string = '╚═══ REPLACE ═══╝';

export const MINIMUM_AI_CREDITS_TO_CONTINUE = 10;

export const EXTRA_TOKENS_PRICING: Record<number, number> = {
  2500: 5,
  20000: 30,
  80000: 100, // in USD
};

export const maxLinkDepth = 5;

export const DEFAULT_PERMISSIONS = Object.freeze([
  'read',
  'write',
  'realm-owner',
]) as RealmPermissions['user'];

export const PUBLISHED_DIRECTORY_NAME = '_published';
