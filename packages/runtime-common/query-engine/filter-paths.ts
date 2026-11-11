// Field paths in a filter, sort or facet: walking a dotted path through a
// type's fields (plural fields, `[]` brackets, searchable link hops), and the
// refusal of a path that crosses a link the search doc does not hold
// (`FilterRefersToNonsearchableFieldError`).
// Owns: path string helpers and `getField`, a field definition by path.
// Must not: build SQL (expression-resolver.ts turns a resolved path into
// SQL).
// Guarantees: docs/search.md ("Filters", "Refusals": unknown-field,
// not-searchable).

import { type CodeRef, baseRealmRRI, isResolvedCodeRef } from '../index.ts';
import {
  type Definition,
  type FieldDefinition,
  getFieldDef,
} from '../definitions.ts';
import type { DefinitionLookup } from '../definition-lookup.ts';
import { InvalidQueryError } from '../query.ts';
import { isSyntheticSearchDocKey } from '../search-doc-keys.ts';
import { routesForField } from '../searchable-routes.ts';
import stringify from 'safe-stable-stringify';

// A filter path resolves in the schema but crosses a `linksTo`/`linksToMany`
// hop whose target is not in the search doc, so the query would silently match
// nothing. Raised by the query compiler (see `walkFilterFieldPath`) and
// kept distinct from the "nonexistent field" error so a forgotten `searchable`
// annotation surfaces at the point of use as an actionable message rather than
// as mysteriously-empty results. `reason` distinguishes a link that simply was
// never made searchable (fixable by annotating it) from a query-backed
// relationship, which is never in the doc at all and cannot be filtered
// through.
export class FilterRefersToNonsearchableFieldError extends Error {
  type: CodeRef;
  // The full filter path as written (e.g. `bestFriend.friends.name`).
  path: string;
  // The dotted path to the offending relationship hop (e.g. `bestFriend.friends`).
  relationshipPath: string;
  reason: 'not-searchable' | 'query-backed';

  constructor(opts: {
    type: CodeRef;
    path: string;
    relationshipPath: string;
    reason: 'not-searchable' | 'query-backed';
  }) {
    super(buildNonsearchableFieldMessage(opts));
    this.name = 'FilterRefersToNonsearchableFieldError';
    this.type = opts.type;
    this.path = opts.path;
    this.relationshipPath = opts.relationshipPath;
    this.reason = opts.reason;
    // make sure instances of this Error subclass behave like instances of the subclass should
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isFilterRefersToNonsearchableFieldError(
  error: unknown,
): error is FilterRefersToNonsearchableFieldError {
  return error instanceof FilterRefersToNonsearchableFieldError;
}

export function buildNonsearchableFieldMessage(opts: {
  type: CodeRef;
  path: string;
  relationshipPath: string;
  reason: 'not-searchable' | 'query-backed';
}): string {
  let { type, path, relationshipPath, reason } = opts;
  if (reason === 'query-backed') {
    return (
      `Your filter on ${stringify(type)} refers to "${path}", but the ` +
      `"${relationshipPath}" relationship is query-backed and is never ` +
      `included in the search doc (query-backed relationships can't be kept ` +
      `current as matching cards change), so it cannot be filtered through.`
    );
  }
  // `searchable` routes are seeded from the queried card's own fields, so the
  // fix is always to extend the head field's annotation. For a single-hop path
  // the head field IS the relationship (annotate it `searchable: true`); for a
  // deeper hop the head field's annotation gains the remaining route.
  let [headField, ...rest] = relationshipPath.split('.');
  let hint =
    rest.length === 0 ? `searchable: true` : `searchable: '${rest.join('.')}'`;
  return (
    `Your filter on ${stringify(type)} refers to "${path}", but the ` +
    `"${relationshipPath}" relationship is not searchable, so its target is ` +
    `not in the search doc and the filter would silently match nothing. To ` +
    `query through it, make it searchable: add \`${hint}\` to the ` +
    `"${headField}" field (combine multiple routes in an array if it already ` +
    `has a searchable annotation).`
  );
}

// Field serializers whose values never spill out of the search doc: numbers,
// booleans, dates, and short fixed-form strings. A filter or
// sort on one reads `search_doc` directly; any other leaf reads through
// `spill_text`. The title keys above never spill either (`search-doc-spill.ts`).
export const NEVER_SPILLED_SERIALIZERS: ReadonlySet<string> = new Set([
  'number',
  'big-integer',
  'boolean',
  'date',
  'datetime',
  'email',
  'phone',
  'ethereum-address',
]);

export function traveledThruPlural(pathTraveled: string) {
  return pathTraveled.includes('[');
}

export function trimTrailingBrackets(pathTraveled: string) {
  return pathTraveled.replace(/\[\]$/g, '');
}

export function trimPathAtFirstPluralField(pathTraveled: string) {
  return pathTraveled.substring(0, pathTraveled.indexOf('['));
}

export function convertBracketsToWildCards(pathTraveled: string) {
  return pathTraveled.replace(/\[\]/g, '[%]');
}

export function removeBrackets(pathTraveled: string) {
  return pathTraveled.replace(/\[\]/g, '');
}

export function isFieldPlural(field: FieldDefinition): boolean {
  return field.type === 'containsMany' || field.type === 'linksToMany';
}

// Seed the `searchable` route set from the queried card's own fields — the
// loaderless mirror of `base/searchable.ts`'s `seedSearchableRoutes`, reading
// `FieldDefinition.searchable` from the cached definition instead of the live
// field descriptor.
export function seedSearchableRoutesFromDefinition(
  definition: Pick<Definition, 'fields' | 'fieldDefs'>,
): string[] {
  let routes: string[] = [];
  for (let [fieldName, defId] of Object.entries(definition.fields)) {
    routes.push(
      ...routesForField(fieldName, definition.fieldDefs[defId]?.searchable),
    );
  }
  return routes;
}

export async function getField(
  definition: Definition,
  pathTraveled: string,
  definitionLookup: DefinitionLookup,
): Promise<FieldDefinition> {
  let cleansedPath = removeBrackets(pathTraveled);
  let field = await getFieldDef(definition, cleansedPath, async (codeRef) => {
    if (!isResolvedCodeRef(codeRef)) {
      return undefined;
    }
    return await definitionLookup.lookupDefinition(codeRef);
  });
  if (!field) {
    if (isSyntheticSearchDocKey(currentField(pathTraveled))) {
      // this is a little awkward--we have the need to treat the synthetic
      // search-doc keys (see search-doc-keys.ts) as fields that we can query
      // against from the index (e.g. the cards grid sorts by the card's display
      // name via `_cardType`; a mixed cards+files search sorts/filters both row
      // types on `_title`, and dedups a card's dual-indexed `.json` file row
      // with `eq: { _isCardInstanceFile: false }`). the index-runner / prerender
      // meta route inject these into the searchDoc during index time. The string
      // field shape here is enough for the non-null string keys and the `IS
      // NULL` legacy spelling; `_isCardInstanceFile`'s boolean `eq: true/false`
      // is special-cased in `fieldEqFilter` so it never depends on the
      // adapter-specific `->>` rendering of a JSON boolean. Kept in sync with
      // the matcher shim (instance-filter-matcher.ts) and searchable-parity.ts.
      return {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: {
          module: `${baseRealmRRI}card-api`,
          name: 'StringField',
        },
      } as FieldDefinition;
    }
    let onBaseType =
      definition.codeRef &&
      'name' in definition.codeRef &&
      definition.codeRef.name === 'CardDef';
    let first = cleansedPath.split('.')[0];
    let fold = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
    let nearest = Object.keys(definition.fields)
      .map((name) => ({ name, d: editDistance(fold(name), fold(first)) }))
      .sort((a, b) => a.d - b.d)[0];
    throw new InvalidQueryError(
      `Your filter refers to a nonexistent field "${cleansedPath}" on type ${stringify(
        definition.codeRef,
      )}` +
        (onBaseType
          ? `. A type anchor applies only to the filter object it is on: put "on" (on the wire, "item.on") beside the field's operator, not in a sibling clause`
          : nearest && nearest.d <= Math.max(2, first.length / 3)
            ? `; did you mean "${nearest.name}"?`
            : ''),
      'unknown-field',
    );
  }
  return field;
}

export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export function currentField(pathTraveled: string) {
  let cleansedPath = removeBrackets(pathTraveled);
  return cleansedPath.split('.').pop()!;
}
