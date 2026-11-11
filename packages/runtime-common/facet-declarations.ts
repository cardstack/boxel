// Facets are a declared capability (docs/search.md, Facets): a query may count
// a field with `facets: [{ by }]` only when the field opts in with
// `search: { facet: true }`, or when it is one of the built-in facets every
// card has (its type, its realm, when it was created and modified). This
// module is the one reading of those declarations, over a type's
// `Definition`: the query engine checks a facet's `by` against it, the render
// stamps it into the search doc for the index writer's facet table, and a
// declaration-only module change backfills that table from it.
//
// The rules, walking a field path from the queried type:
// - A primitive field (or a list of them) is a facet when it declares
//   `facet: true`.
// - A link (`linksTo`, `linksToMany`) declared `facet: true` is a facet by
//   the linked card's id, labeled with its title. The linked card's own
//   fields (`author.name`) are facets when its type declares them; they reach
//   the search doc through the link's `searchable`.
// - A compound field (a FieldDef) declared `facet: true` opts in exactly the
//   subfields its FieldDef declares `facet: true` (`shipTo.city`), and, when
//   the FieldDef names `static facetValue = '<subfield>'`, the compound itself
//   (`price`), read from that subfield. A compound with neither opts in
//   nothing.
// - A list of compounds or of links counts a card once per distinct value
//   any element holds.

import type { CodeRef } from './code-ref.ts';
import type { Definition, FieldDefinition } from './definitions.ts';
import { getImmediateFieldDef } from './definitions.ts';
import { isResolvedCodeRef } from './code-ref.ts';
import type {
  FacetFieldSpecs,
  IndexFieldDeclarations,
} from './search-intent.ts';

// A field a query may facet by: where its values are read and how they
// count.
export interface DeclaredFacet {
  // The facet's `by`, as a query names it.
  path: string;
  // The search-doc path its values are read from: `path`, or for a
  // compound with a `facetValue`, that subfield under it.
  read: string;
  // `read` crosses a list (`containsMany` or `linksToMany`) before its last
  // segment, so each element's value counts.
  list: boolean;
  // Its values are linked cards, counted by id.
  link: boolean;
  // The type a link points at.
  linkTarget?: CodeRef;
  // The field the values come from (the leaf of `read`).
  field: FieldDefinition;
}

// Where each index field (base's `static indexFields`, declared on BaseDef
// and CardDef with the same `search: { facet: true }` a field takes) keeps
// its value: a column of the index row, since none of them is a field of the
// card or file. This is the engine's one entry for them, and only for where
// the value lives; whether a type may facet by one is its declaration.
// `_type` is the row's own type (its code ref's key), labeled with its
// display name, as the realm's type summary (`_types`) groups and labels
// rows; `_cardType` is the display name alone, the value `eq: { _cardType }`
// filters by. The dates are epochs, read as their UTC instants.
export const INDEX_FIELD_COLUMNS: Record<
  string,
  { column: string; label?: string; date?: boolean }
> = {
  _type: { column: 'i.types ->> 0', label: 'i.display_names ->> 0' },
  _cardType: { column: 'i.display_names ->> 0' },
  _realm: { column: 'i.realm_url' },
  createdAt: { column: 'i.resource_created_at', date: true },
  lastModified: { column: 'i.last_modified', date: true },
};

// What base declares in `static indexFields` (card-api: BaseDef, and CardDef
// with `_cardType`), for an index whose definition lookup cannot resolve
// base's own definitions (a test's fixed lookup, a definition cached before
// `indexFields` was recorded). Base's declarations are the authority: a
// resolvable base definition is always read first. Keep the two in step.
const facetable = { search: { facet: true } };
export const BASE_INDEX_FIELDS: Record<
  'BaseDef' | 'CardDef' | 'FileDef',
  IndexFieldDeclarations
> = {
  BaseDef: {
    _type: facetable,
    _realm: facetable,
    createdAt: facetable,
    lastModified: facetable,
  },
  CardDef: {
    _type: facetable,
    _realm: facetable,
    createdAt: facetable,
    lastModified: facetable,
    _cardType: facetable,
  },
  FileDef: {
    _type: facetable,
    _realm: facetable,
    createdAt: facetable,
    lastModified: facetable,
  },
};

export function isIndexField(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(INDEX_FIELD_COLUMNS, path);
}

// Whether `definition`'s type declares the index field `name` a facet.
export function declaresIndexFacet(
  definition: Pick<Definition, 'indexFields'>,
  name: string,
): boolean {
  let declared = definition.indexFields?.[name];
  return Boolean(declared?.search && declared.search.facet === true);
}

type LookupDefinition = (codeRef: CodeRef) => Promise<Definition | undefined>;

const MAX_DEPTH = 6;
const NUMBER_SERIALIZERS = new Set(['number', 'big-integer']);
const DATE_SERIALIZERS = new Set(['date', 'datetime']);

function declaresFacet(field: FieldDefinition | undefined): boolean {
  let search = field?.search;
  return Boolean(search && search.facet === true);
}

function isLink(field: FieldDefinition): boolean {
  return field.type === 'linksTo' || field.type === 'linksToMany';
}

function isList(field: FieldDefinition): boolean {
  return field.type === 'containsMany' || field.type === 'linksToMany';
}

async function lookup(
  field: FieldDefinition,
  lookupDefinition: LookupDefinition,
): Promise<Definition | undefined> {
  if (!isResolvedCodeRef(field.fieldOrCard)) {
    return undefined;
  }
  try {
    return await lookupDefinition(field.fieldOrCard);
  } catch {
    return undefined;
  }
}

const declaredCache = new WeakMap<
  Definition,
  Promise<Map<string, DeclaredFacet>>
>();

// Every facet a type declares, by path. Cached per definition object: the
// definition lookup hands back one object per cached definition, and a
// changed module makes a new one.
export function declaredFacetFields(
  definition: Definition,
  lookupDefinition: LookupDefinition,
): Promise<Map<string, DeclaredFacet>> {
  let cached = declaredCache.get(definition);
  if (!cached) {
    cached = collectDeclaredFacets(definition, lookupDefinition);
    declaredCache.set(definition, cached);
    // A failed walk is not kept: the next query walks again.
    cached.catch(() => declaredCache.delete(definition));
  }
  return cached;
}

async function collectDeclaredFacets(
  definition: Definition,
  lookupDefinition: LookupDefinition,
): Promise<Map<string, DeclaredFacet>> {
  let out = new Map<string, DeclaredFacet>();
  let walk = async (
    def: Pick<Definition, 'fields' | 'fieldDefs'>,
    prefix: string,
    crossed: boolean,
    depth: number,
    // Whether this walk is already through a link: a linked card's own
    // facets count, but not the cards it links to in turn.
    throughLink: boolean,
    // Inside a compound, only subfields that declare `facet: true` count;
    // at the card's top level and in a linked card the same holds.
  ) => {
    if (depth > MAX_DEPTH) {
      return;
    }
    for (let name of Object.keys(def.fields)) {
      let field = getImmediateFieldDef(def, name);
      if (!field) {
        continue;
      }
      let path = `${prefix}${name}`;
      let declared = declaresFacet(field);
      if (isLink(field)) {
        if (declared) {
          out.set(path, {
            path,
            read: path,
            list: crossed,
            link: true,
            linkTarget: field.fieldOrCard,
            field,
          });
        }
        if (!throughLink) {
          let target = await lookup(field, lookupDefinition);
          // A linked file's fields are never facets of the card: the card
          // that links it declares what it counts by, in a field of its own.
          if (target && target.type !== 'file-def') {
            await walk(
              target,
              `${path}.`,
              crossed || isList(field),
              depth + 1,
              true,
            );
          }
        }
        continue;
      }
      if (!declared) {
        continue;
      }
      if (field.isPrimitive) {
        out.set(path, { path, read: path, list: crossed, link: false, field });
        continue;
      }
      let sub = await lookup(field, lookupDefinition);
      if (!sub) {
        continue;
      }
      let throughList = crossed || isList(field);
      let facetValue = sub.facetValue;
      if (facetValue) {
        let valueField = getImmediateFieldDef(sub, facetValue);
        if (valueField && valueField.isPrimitive) {
          out.set(path, {
            path,
            read: `${path}.${facetValue}`,
            list: throughList,
            link: false,
            field: valueField,
          });
        }
      }
      await walk(sub, `${path}.`, throughList, depth + 1, throughLink);
    }
  };
  await walk(definition, '', false, 0, false);
  return out;
}

// The facet table specs the render stamps for a type (`_searchText.facets`).
export async function facetFieldSpecsOf(
  definition: Definition,
  lookupDefinition: LookupDefinition,
): Promise<FacetFieldSpecs> {
  let specs: FacetFieldSpecs = {};
  for (let facet of (
    await declaredFacetFields(definition, lookupDefinition)
  ).values()) {
    specs[facet.path] = {
      ...(facet.read !== facet.path ? { read: facet.read } : {}),
      ...(facet.list ? { list: true as const } : {}),
      ...(facet.link ? { link: true as const } : {}),
      ...(!facet.link && DATE_SERIALIZERS.has(facet.field.serializerName ?? '')
        ? { date: true as const }
        : {}),
    };
  }
  return specs;
}

// Why `path` is no facet of the type, with the declaration that would make
// it one: the message of a `needs-declaration` refusal. Undefined when the
// path names no field of the type (an `unknown-field` the caller reports).
export async function missingFacetDeclaration(
  definition: Definition,
  path: string,
  lookupDefinition: LookupDefinition,
  member = 'facet by',
): Promise<string | undefined> {
  let typeName = (ref: CodeRef | undefined) =>
    ref && 'name' in ref ? ref.name : 'its type';
  let segments = path.split('.');
  let def: Pick<Definition, 'fields' | 'fieldDefs' | 'facetValue'> &
    Partial<Pick<Definition, 'codeRef'>> = definition;
  let owner = typeName(definition.codeRef);
  let throughLink = false;
  let fix = (field: FieldDefinition, name: string, on: string, extra = '') =>
    `${member} "${path}": the field "${name}" of ${on} is not declared as a facet. Facets count only declared fields: add \`search: { facet: true }\` to its declaration (\`@field ${name} = ${field.type}(…, { search: { facet: true } })\`)${extra}`;
  for (let i = 0; i < segments.length; i++) {
    let name = segments[i];
    let field = getImmediateFieldDef(def, name);
    if (!field) {
      return undefined;
    }
    let last = i === segments.length - 1;
    if (isLink(field)) {
      if (last) {
        return declaresFacet(field)
          ? undefined
          : fix(
              field,
              name,
              owner,
              ', which counts the linked cards by id, labeled with their titles',
            );
      }
      if (throughLink) {
        return `${member} "${path}": a facet reaches through one link only. Facet by "${segments.slice(0, i + 1).join('.')}" (declared \`search: { facet: true }\` on ${owner}), or give the card a computed field that reads the value through both links, declared a facet (\`@field ${segments[segments.length - 1]} = contains(…, { computeVia: function () { return this.${segments.join('?.')}; }, search: { facet: true } })\`), and facet by it`;
      }
      let target = await lookup(field, lookupDefinition);
      if (!target) {
        return undefined;
      }
      if (target.type === 'file-def') {
        let rest = segments.slice(i + 1).join('.');
        let leaf = segments[segments.length - 1];
        return `${member} "${path}": "${name}" links a file, and a file's fields are not facets of the card that links it. The card declares what it counts by in a field of its own: a computed field that reads the file, declared a facet (\`@field ${leaf} = contains(StringField, { computeVia: function () { return this.${name}?.${rest.split('.').join('?.')}; }, search: { facet: true } })\`), then facet by "${leaf}"`;
      }
      throughLink = true;
      def = target;
      owner = typeName(field.fieldOrCard);
      continue;
    }
    if (field.isPrimitive) {
      if (!last) {
        return undefined;
      }
      return declaresFacet(field) ? undefined : fix(field, name, owner);
    }
    // A compound field.
    let sub = await lookup(field, lookupDefinition);
    let subName = typeName(field.fieldOrCard);
    if (!declaresFacet(field)) {
      return fix(
        field,
        name,
        owner,
        `; on a compound field it opts in the subfields ${subName} declares \`search: { facet: true }\`${sub?.facetValue ? ` and the compound itself, by its \`facetValue\` "${sub.facetValue}"` : ''}`,
      );
    }
    if (!sub) {
      return undefined;
    }
    if (last) {
      if (sub.facetValue) {
        return undefined;
      }
      let declaredSubfields = Object.keys(sub.fields).filter((n) =>
        declaresFacet(getImmediateFieldDef(sub!, n)),
      );
      return `${member} "${path}": "${name}" is a compound field (${subName}), which counts by one of its subfields. ${
        declaredSubfields.length
          ? `Facet by ${declaredSubfields.map((n) => `"${path}.${n}"`).join(' or ')}, or name the subfield the compound itself counts by with \`static facetValue = '<subfield>'\` on ${subName}`
          : `${subName} declares no facet subfields: add \`search: { facet: true }\` to the subfields to count (then facet by "${path}.<subfield>"), or name one with \`static facetValue = '<subfield>'\` on ${subName}`
      }`;
    }
    def = sub;
    owner = subName;
  }
  return undefined;
}

// The shape a declared facet takes when the query names none: values for
// text, links and booleans, range buckets for numbers, a histogram for
// dates.
export function declaredFacetShape(
  facet: Pick<DeclaredFacet, 'link' | 'field'>,
): 'values' | 'range' | 'date' {
  if (facet.link) {
    return 'values';
  }
  let serializer = facet.field.serializerName ?? '';
  return NUMBER_SERIALIZERS.has(serializer)
    ? 'range'
    : DATE_SERIALIZERS.has(serializer)
      ? 'date'
      : 'values';
}
