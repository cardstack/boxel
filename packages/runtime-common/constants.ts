import { RealmPaths } from './paths.ts';
import type { ResolvedCodeRef } from './code-ref.ts';
import { rri, type RealmResourceIdentifier } from './realm-identifiers.ts';
import type { RealmPermissions } from './index.ts';

export const baseRealm = new RealmPaths(new URL('https://cardstack.com/base/'));

/**
 * Build a `RealmResourceIdentifier` for a module inside the base realm.
 * Equivalent to `` rri(`${baseRealm.url}${path}`) `` but shorter.
 */
export function baseRRI(path: string): RealmResourceIdentifier {
  return rri(`${baseRealm.url}${path}`);
}

export const devSkillLocalPath = 'Skill/boxel-development';
export const envSkillLocalPath = 'Skill/boxel-environment';

export const baseRef: ResolvedCodeRef = {
  module: `${baseRealm.url}card-api` as RealmResourceIdentifier,
  name: 'BaseDef',
};
export const specRef: ResolvedCodeRef = {
  module: `${baseRealm.url}spec` as RealmResourceIdentifier,
  name: 'Spec',
};
export const baseCardRef: ResolvedCodeRef = {
  module: `${baseRealm.url}card-api` as RealmResourceIdentifier,
  name: 'CardDef',
};
export const baseFieldRef: ResolvedCodeRef = {
  module: `${baseRealm.url}card-api` as RealmResourceIdentifier,
  name: 'FieldDef',
};
export const skillCardRef: ResolvedCodeRef = {
  module: `${baseRealm.url}skill` as RealmResourceIdentifier,
  name: 'Skill',
};
export const baseFileRef: ResolvedCodeRef = {
  module: `${baseRealm.url}card-api` as RealmResourceIdentifier,
  name: 'FileDef',
};

// standard CardDef fields that are computeds of their cardInfo equivalents
export const cardDefComputedFields: string[] = [
  'cardTitle',
  'cardDescription',
  'cardThumbnailURL',
  'cardTheme',
];

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
export const submissionBotUsername = 'submissionbot';

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

// Carries the set of card ids currently on the render spine (the rendered
// card and every card embedded above the consuming field component). The
// field component consumes this to detect a render-time cycle: when a card
// it is about to embed is already an ancestor, it degrades that card to a
// bounded atom stand-in instead of recursing into it. Mirrors the
// `visited`-set cycle guard in `serialize` and the `stack` guard in
// `queryableValue`, but for the render/embed traversal.
export const RenderAncestryContextName = 'render-ancestry-context';

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

// Default max file (module / binary) payload size, in bytes.
export const DEFAULT_FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024; // 5 MB

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
export const PUBLISHED_REALM_DOMAIN_OVERRIDES: Record<string, string> = {};

export function parsePublishedRealmDomainOverrides(
  rawOverrides: string | undefined,
): Record<string, string> {
  if (!rawOverrides) {
    return {};
  }

  try {
    let parsed = JSON.parse(rawOverrides);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    let overrides: Record<string, string> = {};
    for (let [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof value === 'string') {
        overrides[key] = value;
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

export function getPublishedRealmDomainOverrides(
  rawOverrides?: string | Record<string, string>,
): Record<string, string> {
  let envOverrides =
    typeof rawOverrides === 'string'
      ? parsePublishedRealmDomainOverrides(rawOverrides)
      : (rawOverrides ?? {});
  return {
    ...PUBLISHED_REALM_DOMAIN_OVERRIDES,
    ...envOverrides,
  };
}

export const PUBLISHED_DIRECTORY_NAME = '_published';
