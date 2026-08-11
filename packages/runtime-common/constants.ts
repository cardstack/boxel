import { RealmPaths } from './paths.ts';
import type { ResolvedCodeRef } from './code-ref.ts';
import {
  ri,
  rri,
  type RealmIdentifier,
  type RealmResourceIdentifier,
} from './realm-identifiers.ts';
import type { RealmPermissions } from './index.ts';

export const baseRealm = new RealmPaths(new URL('https://cardstack.com/base/'));

/**
 * The base realm's canonical RRI prefix. Use this when building code
 * refs that should match what `Loader.identify` / `identifyCard` emit
 * for base-realm classes (which canonicalise via `vn.unresolveURL`
 * to the registered `@cardstack/base/` prefix).
 */
export const baseRealmRRI: RealmIdentifier = ri('@cardstack/base/');

/**
 * Build a `RealmResourceIdentifier` for a module inside the base realm.
 * Returns the prefix-form RRI (e.g. `@cardstack/base/card-api`) so the
 * value matches what `Loader.identify` / `identifyCard` emit for
 * base-realm classes after the runtime's `unresolveURL` chase.
 */
export function baseRRI(path: string): RealmResourceIdentifier {
  return rri(`${baseRealmRRI}${path}`);
}

// The skills realm's index — the pull-model entry point. Its body names every
// skill and command the assistant can reach and is short enough to push into
// every room, so a room needs no other skill up front: the model reads what a
// task actually calls for. This is the default skill for new AI rooms, and the
// skill the system card's `defaultSkillFiles` names.
export const skillsIndexLocalPath = 'index.md';

// The legacy `Skill` card carrying the Boxel coding guidance, enabled by the
// build-listing and readme-spec flows, which set up their own skill lists
// rather than going through the room defaults.
export const devSkillLocalPath = 'Skill/boxel-development';

export const baseRef: ResolvedCodeRef = {
  module: `${baseRealmRRI}card-api` as RealmResourceIdentifier,
  name: 'BaseDef',
};
export const specRef: ResolvedCodeRef = {
  module: `${baseRealmRRI}spec` as RealmResourceIdentifier,
  name: 'Spec',
};
export const baseCardRef: ResolvedCodeRef = {
  module: `${baseRealmRRI}card-api` as RealmResourceIdentifier,
  name: 'CardDef',
};
export const baseFieldRef: ResolvedCodeRef = {
  module: `${baseRealmRRI}card-api` as RealmResourceIdentifier,
  name: 'FieldDef',
};
export const skillCardRef: ResolvedCodeRef = {
  module: `${baseRealmRRI}skill` as RealmResourceIdentifier,
  name: 'Skill',
};
export const markdownDefRef: ResolvedCodeRef = {
  module: `${baseRealmRRI}markdown-file-def` as RealmResourceIdentifier,
  name: 'MarkdownDef',
};
export const baseFileRef: ResolvedCodeRef = {
  module: `${baseRealmRRI}card-api` as RealmResourceIdentifier,
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

// Media assets run an order of magnitude larger than the source files, images,
// and documents that make up the rest of a realm, so audio and video carry
// their own ceilings instead of the general file limit.
export const DEFAULT_AUDIO_SIZE_LIMIT_BYTES = 20 * 1024 * 1024; // 20 MB
export const DEFAULT_VIDEO_SIZE_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB

// Above this content length, markdown rendering skips the synchronous parse
// and renders a bounded notice with a short plain-text preview instead. This
// is a render-thread guardrail, not a byte-precise bound: it compares string
// character count (UTF-16 code units), a cheap proxy that is always <= the
// UTF-8 byte length. It is anchored to the default card size limit — a field
// this long exceeds the size a whole card is allowed to be — so any content
// tripping it is over-limit and would otherwise run a multi-MB synchronous
// parse + sanitize on the render thread.
export const MAX_MARKDOWN_RENDER_LENGTH = DEFAULT_CARD_SIZE_LIMIT_BYTES;

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
