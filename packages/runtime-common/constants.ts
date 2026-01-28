import { RealmPaths } from './paths';
import type { ResolvedCodeRef } from './code-ref';
import type { RealmPermissions } from './index';

export const baseRealm = new RealmPaths(new URL('https://cardstack.com/base/'));

export const devSkillLocalPath = 'Skill/boxel-development';
export const envSkillLocalPath = 'Skill/boxel-environment';

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
export const isSpec = Symbol('is-spec');
export const primitive = Symbol('cardstack-primitive');
export const fields = Symbol.for('cardstack-fields');
export const fieldSerializer = Symbol.for('cardstack-field-serializer');
export const fieldsUntracked = Symbol.for('cardstack-fields-untracked');
export const getMenuItems = Symbol.for('cardstack-get-menu-items');
export const isBaseInstance = Symbol.for('isBaseInstance');
export const localId = Symbol.for('cardstack-local-id');
export const meta = Symbol.for('cardstack-meta');
export const realmURL = Symbol.for('cardstack-realm-url');
export const relativeTo = Symbol.for('cardstack-relative-to');

export const aiBotUsername = 'aibot';
export const botRunnerUsername = 'bot-runner';

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

// Default max card payload size, in bytes.
export const DEFAULT_CARD_SIZE_LIMIT_BYTES = 512 * 1024; //512 KB

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

// Workaround to override published realm URLs to support custom domains. Remove in CS-9061.
export const PUBLISHED_REALM_DOMAIN_OVERRIDES: Record<string, string> = {
  // staging
  'custombuck.staging.boxel.build': 'custombuck.stack.cards',
  'docs.staging.boxel.build': 'docs.stack.cards',
  'home.staging.boxel.build': 'home.stack.cards',
  'whitepaper.staging.boxel.build': 'whitepaper.stack.cards',

  // production
  'custombuck.boxel.site': 'custombuck.boxel.ai',
  'docs.boxel.site': 'docs.boxel.ai',
  'home.boxel.site': 'home.boxel.ai',
  'tealpaper.boxel.site': 'tealpaper.cardstack.com',
  'whitepaper.boxel.site': 'whitepaper.boxel.ai',
};

export const PUBLISHED_DIRECTORY_NAME = '_published';
