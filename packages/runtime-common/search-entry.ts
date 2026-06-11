import { assertQuery, InvalidQueryError, type Query } from './query.ts';
import { SearchRequestError } from './search-utils.ts';
import type {
  CardResourceType,
  FileMetaResourceType,
} from './resource-types.ts';
import {
  CssResourceType,
  HtmlResourceType,
  SearchEntryResourceType,
  htmlResourceId,
  type CardResource,
  type FileMetaResource,
  type HtmlResource,
  type Relationship,
  type Saved,
  type SearchEntryResource,
} from './resource-types.ts';
import type { ResolvedCodeRef } from './code-ref.ts';
import {
  isValidPrerenderedHtmlFormat,
  PRERENDERED_HTML_FORMATS,
  type PrerenderedHtmlFormat,
} from './prerendered-html-format.ts';
import type { CodeRef } from './code-ref.ts';
import { isCodeRef } from './card-document-shape.ts';
import { generalSortFields } from './index-query-engine.ts';
import { ensureTrailingSlash } from './paths.ts';
import { logger } from './log.ts';

// ---------------------------------------------------------------------------
// The v2 search-entry query.
//
// A v2 request is one query rooted on `search-entry`, addressed through two
// branches: `item.` (the card/file serialization) and `html.` (the
// rendering). The filter grammar is the standard operator-keyed grammar
// (`eq` / `contains` / `in` / `range` / `any` / `every` / `not` / `matches`)
// — only the addressing changes:
//
//   - the type anchor is `item.on` (a node carrying only the anchor is the
//     pure card-type filter),
//   - field paths inside the operators are reached through `item.`
//     (`eq: { "item.status": "ready" }`),
//   - `html.renderType` / `html.format` are rendering config spelled as `eq`
//     predicates at the top level of `filter`. The index stores a set of
//     renderings per entry (formats × ancestor render types), so these
//     genuinely narrow — but they narrow which rendering satisfies the `html`
//     branch, not entry membership: a result with no matching rendering still
//     returns, falling back to `item`. Equality is the only meaningful
//     predicate over a rendering dimension, so an `html.*` path under any
//     other operator (or outside the top-level `eq`) is ignored with a logged
//     warning,
//   - sort keys are `item.` paths, with `item.on` as a sort entry's own
//     anchor (a card-field sort without one inherits the filter's anchor).
//
// `fields[search-entry]` is the sparse fieldset selecting which branches the
// response carries: `html`, `item` (the full serialization), or
// `item.<field>` entries (a field-limited serialization that ships
// `meta.sparseFields` and never enters the Store). No fieldset means the
// default resolution policy: prefer `html`, fall back to `item` where a
// result has no HTML.
//
// The parser translates the wire query into the legacy `Query` the SQL core
// consumes (`item.` prefixes stripped) plus the lifted render spec and the
// parsed fieldset.
// ---------------------------------------------------------------------------

const ITEM_PREFIX = 'item.';
const ITEM_ANCHOR = 'item.on';
const HTML_RENDER_TYPE = 'html.renderType';
const HTML_FORMAT = 'html.format';

export const DEFAULT_SEARCH_ENTRY_FORMAT: PrerenderedHtmlFormat = 'fitted';

const SEARCH_ENTRY_QUERY_MEMBERS = [
  'filter',
  'sort',
  'page',
  'realms',
  'fields',
  'cardUrls',
];

// The operator members whose value is an object keyed by field paths.
const FIELD_KEYED_OPERATORS = ['eq', 'contains', 'in', 'range'];

export interface SearchEntryRenderSpec {
  // The format of the `html` branch; `html.format`, defaulting to fitted.
  format: PrerenderedHtmlFormat;
  // `html.renderType`: render every result as this ancestor type. Omitted →
  // each result renders in its own actual (native) type.
  renderType?: CodeRef;
}

// Which form of the `item` serialization the fieldset selects.
export type SearchEntryItemSelection =
  | { kind: 'none' }
  | { kind: 'full' }
  | { kind: 'sparse'; fields: string[] };

export interface SearchEntryFieldset {
  html: boolean;
  item: SearchEntryItemSelection;
  // True only in the default (no `fields` member) mode: the `item` branch
  // appears per result, only where the result has no HTML. An explicit
  // fieldset always pins the branches instead.
  itemAsFallback: boolean;
}

// The parsed form of a v2 request: the legacy `Query` for the SQL core (the
// `item.` addressing stripped), the lifted `html.` render config, and the
// parsed sparse fieldset. The compat layer constructs this directly from a
// legacy request — it does not round-trip through the wire grammar.
export interface SearchEntryQuery {
  itemQuery: Query;
  render: SearchEntryRenderSpec;
  fieldset: SearchEntryFieldset;
  realms?: string[];
  cardUrls?: string[];
}

function invalidQuery(message: string): SearchRequestError {
  return new SearchRequestError('invalid-query', `Invalid query: ${message}`);
}

// Lazy: a module-load `logger()` call races the circular import that installs
// the logger factory. First emission happens well after boot.
let searchEntryLog: ReturnType<typeof logger> | undefined;
function warn(message: string): void {
  (searchEntryLog ??= logger('search-entry-query')).warn(message);
}

// The `html.*` rendering config captured out of the filter's top-level `eq`.
// Values are validated by `parseRenderSpec` after the walk.
interface RenderConfigCapture {
  renderType?: unknown;
  format?: unknown;
}

function stripItemPrefix(fieldPath: string, pointer: string): string {
  if (
    !fieldPath.startsWith(ITEM_PREFIX) ||
    fieldPath.length <= ITEM_PREFIX.length
  ) {
    throw invalidQuery(
      `${pointer}: field paths must be addressed through item. (got "${fieldPath}")`,
    );
  }
  return fieldPath.slice(ITEM_PREFIX.length);
}

// The `html.` rendering config — top-level members of the query.
function parseRenderSpec(
  renderType: unknown,
  format: unknown,
): SearchEntryRenderSpec {
  let render: SearchEntryRenderSpec = { format: DEFAULT_SEARCH_ENTRY_FORMAT };
  if (format !== undefined) {
    if (typeof format !== 'string' || !isValidPrerenderedHtmlFormat(format)) {
      throw new SearchRequestError(
        'invalid-render',
        `${HTML_FORMAT} must be one of ${PRERENDERED_HTML_FORMATS.join(', ')}`,
      );
    }
    render.format = format;
  }
  if (renderType !== undefined) {
    if (!isCodeRef(renderType)) {
      throw new SearchRequestError(
        'invalid-render',
        `${HTML_RENDER_TYPE} must be a CodeRef`,
      );
    }
    render.renderType = renderType;
  }
  return render;
}

// Translate one filter node from `item.` addressing to the legacy grammar:
// `item.on` → `on`, field paths inside the operators stripped of their
// `item.` prefix, connectives recursed. The structure (which operators nest
// where) is untouched — `assertQuery` validates the translated result.
//
// `capture` is present only on the root node: `html.*` paths in the root
// node's `eq` are lifted into it. Anywhere else — another operator, or any
// nested node — an `html.*` path is ignored with a logged warning (equality
// at the top level is the only meaningful spelling for rendering config).
function translateFilterNode(
  node: unknown,
  pointer: string,
  capture?: RenderConfigCapture,
): Record<string, unknown> {
  if (typeof node !== 'object' || node == null || Array.isArray(node)) {
    throw invalidQuery(`${pointer}: filter must be an object`);
  }
  let out: Record<string, unknown> = {};
  for (let [key, value] of Object.entries(node)) {
    if (key === ITEM_ANCHOR) {
      out.on = value;
    } else if (key === 'any' || key === 'every') {
      if (!Array.isArray(value)) {
        throw invalidQuery(`${pointer}/${key}: ${key} must be an array`);
      }
      out[key] = value.map((entry, i) =>
        translateFilterNode(entry, `${pointer}/${key}[${i}]`),
      );
    } else if (key === 'not') {
      out.not = translateFilterNode(value, `${pointer}/not`);
    } else if (FIELD_KEYED_OPERATORS.includes(key)) {
      let translated = translateFieldKeys(
        value,
        `${pointer}/${key}`,
        key === 'eq' ? capture : undefined,
      );
      // An operator that carried only html.* entries (lifted or ignored)
      // vanishes with them; a user-authored empty operator is preserved for
      // assertQuery to reject.
      if (
        Object.keys(translated).length === 0 &&
        Object.keys(value as object).length > 0
      ) {
        continue;
      }
      out[key] = translated;
    } else if (key === 'matches') {
      // Full-text match over the whole document — no field path to address.
      out.matches = value;
    } else if (key === HTML_RENDER_TYPE || key === HTML_FORMAT) {
      throw invalidQuery(
        `${pointer}/${key}: ${key} is an eq predicate — spell it eq: { "${key}": … }`,
      );
    } else {
      throw invalidQuery(
        `${pointer}: unknown filter member "${key}" — the type anchor is item.on and field paths are addressed through item. inside the filter operators (${FIELD_KEYED_OPERATORS.join(
          '/',
        )})`,
      );
    }
  }
  // A node carrying only the type anchor is the v2 spelling of a pure
  // card-type filter.
  let keys = Object.keys(out);
  if (keys.length === 1 && keys[0] === 'on') {
    return { type: out.on };
  }
  return out;
}

function translateFieldKeys(
  value: unknown,
  pointer: string,
  capture: RenderConfigCapture | undefined,
): Record<string, unknown> {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw invalidQuery(
      `${pointer}: must be an object keyed by item. field paths`,
    );
  }
  let out: Record<string, unknown> = {};
  for (let [fieldPath, fieldValue] of Object.entries(value)) {
    if (fieldPath === HTML_RENDER_TYPE || fieldPath === HTML_FORMAT) {
      if (capture) {
        if (fieldPath === HTML_RENDER_TYPE) {
          capture.renderType = fieldValue;
        } else {
          capture.format = fieldValue;
        }
      } else {
        warn(
          `${pointer}/${fieldPath}: ${fieldPath} is rendering config and supports only the eq operator at the top level of filter — ignoring`,
        );
      }
      continue;
    }
    out[stripItemPrefix(fieldPath, `${pointer}/${fieldPath}`)] = fieldValue;
  }
  return out;
}

function translateSort(value: unknown, rootAnchor: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidQuery(`sort: sort must be an array`);
  }
  return value.map((entry, i) => {
    let pointer = `sort[${i}]`;
    if (typeof entry !== 'object' || entry == null) {
      throw invalidQuery(`${pointer}: missing sort object`);
    }
    let out: Record<string, unknown> = {};
    for (let [key, v] of Object.entries(entry)) {
      if (key === 'by') {
        if (typeof v !== 'string') {
          throw invalidQuery(`${pointer}/by: by must be a string`);
        }
        out.by = stripItemPrefix(v, `${pointer}/by`);
      } else if (key === ITEM_ANCHOR) {
        out.on = v;
      } else if (key === 'direction') {
        out.direction = v;
      } else if (key === 'on') {
        throw invalidQuery(
          `${pointer}: the sort type anchor is addressed as item.on`,
        );
      } else {
        throw invalidQuery(`${pointer}: unknown sort member "${key}"`);
      }
    }
    // A card-field sort entry without its own anchor inherits the filter's —
    // the sort resolves against the same type the query is anchored on.
    // General (non-card-field) sort keys need no anchor.
    if (
      out.on === undefined &&
      typeof out.by === 'string' &&
      !(out.by in generalSortFields) &&
      rootAnchor !== undefined
    ) {
      out.on = rootAnchor;
    }
    return out;
  });
}

function parseFieldset(fields: unknown): SearchEntryFieldset {
  if (fields === undefined) {
    // No fieldset → the default resolution policy: prefer html, fall back to
    // the item serialization where a result has no HTML.
    return { html: true, item: { kind: 'none' }, itemAsFallback: true };
  }
  if (typeof fields !== 'object' || fields == null || Array.isArray(fields)) {
    throw invalidQuery(`fields must be an object`);
  }
  let keys = Object.keys(fields);
  if (keys.length !== 1 || keys[0] !== 'search-entry') {
    throw invalidQuery(`fields supports only the "search-entry" type`);
  }
  let entries = (fields as Record<string, unknown>)['search-entry'];
  if (
    !Array.isArray(entries) ||
    entries.length === 0 ||
    !entries.every((entry) => typeof entry === 'string')
  ) {
    throw invalidQuery(
      `fields[search-entry] must be a non-empty array of strings`,
    );
  }
  let html = false;
  let itemFull = false;
  let sparseFields: string[] = [];
  for (let entry of entries) {
    if (entry === 'html') {
      html = true;
    } else if (entry === 'item') {
      itemFull = true;
    } else if (
      entry.startsWith(ITEM_PREFIX) &&
      entry.length > ITEM_PREFIX.length
    ) {
      sparseFields.push(entry.slice(ITEM_PREFIX.length));
    } else {
      throw invalidQuery(
        `each fields[search-entry] entry must be "html", "item", or "item.<field>" (got "${entry}")`,
      );
    }
  }
  if (itemFull && sparseFields.length > 0) {
    throw invalidQuery(
      `fields[search-entry] cannot combine "item" (the full serialization) with item.<field> entries`,
    );
  }
  let item: SearchEntryItemSelection = itemFull
    ? { kind: 'full' }
    : sparseFields.length > 0
      ? { kind: 'sparse', fields: [...new Set(sparseFields)] }
      : { kind: 'none' };
  return { html, item, itemAsFallback: false };
}

export function parseSearchEntryQueryFromPayload(
  payload: unknown,
): SearchEntryQuery {
  if (
    payload == null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw invalidQuery(`request body must be a JSON object`);
  }
  let record = payload as Record<string, unknown>;
  for (let key of Object.keys(record)) {
    if (!SEARCH_ENTRY_QUERY_MEMBERS.includes(key)) {
      throw invalidQuery(`unknown member "${key}" in search-entry query`);
    }
  }

  let realms: string[] | undefined;
  if (record.realms !== undefined) {
    if (
      !Array.isArray(record.realms) ||
      !record.realms.every((realm) => typeof realm === 'string')
    ) {
      throw new SearchRequestError(
        'missing-realms',
        'realms must be an array of strings',
      );
    }
    realms = record.realms
      .map((realm) => realm.trim())
      .filter(Boolean)
      .map((realm) => ensureTrailingSlash(realm));
  }

  let cardUrls: string[] | undefined;
  if (record.cardUrls !== undefined) {
    if (typeof record.cardUrls === 'string') {
      cardUrls = [record.cardUrls];
    } else if (
      Array.isArray(record.cardUrls) &&
      record.cardUrls.every((url) => typeof url === 'string')
    ) {
      cardUrls = record.cardUrls;
    } else {
      throw invalidQuery(`cardUrls must be a string or array of strings`);
    }
  }

  let renderCapture: RenderConfigCapture = {};
  let filter: Record<string, unknown> | undefined;
  if (record.filter !== undefined) {
    filter = translateFilterNode(record.filter, 'filter', renderCapture);
    // A filter that carried only rendering config dissolves with the lift —
    // the residual query matches everything.
    if (Object.keys(filter).length === 0) {
      filter = undefined;
    }
  }
  let render = parseRenderSpec(renderCapture.renderType, renderCapture.format);

  let rootAnchor = filter?.on ?? filter?.type;
  let sort =
    record.sort !== undefined
      ? translateSort(record.sort, rootAnchor)
      : undefined;

  let itemQuery: Record<string, unknown> = {};
  if (filter) {
    itemQuery.filter = filter;
  }
  if (sort) {
    itemQuery.sort = sort;
  }
  if (record.page !== undefined) {
    itemQuery.page = record.page;
  }
  try {
    assertQuery(itemQuery);
  } catch (e) {
    if (e instanceof InvalidQueryError) {
      throw invalidQuery(e.message);
    }
    throw e;
  }

  let fieldset = parseFieldset(record.fields);

  return {
    itemQuery: itemQuery as Query,
    render,
    fieldset,
    realms,
    cardUrls,
  };
}

// ---------------------------------------------------------------------------
// Builders for the v2 resources. The projection engine runs these per row
// when assembling a `search-entry` document; keeping them pure (no SQL, no
// realm state) lets the shapes be unit-tested directly. The `css` resource
// builder is shared with the pre-existing search paths (`buildCssResource`).
// ---------------------------------------------------------------------------

// One `search-entry` — the top-level `data` resource for a result. Which
// branches it carries is the resolution policy / sparse fieldset's call; this
// just assembles the linkage. The `item` shares the entry's URL as its id;
// the `html` branch points at a specific rendering by its composite id.
export function buildSearchEntryResource(args: {
  url: string;
  htmlId?: string;
  itemType?: typeof CardResourceType | typeof FileMetaResourceType;
}): SearchEntryResource {
  let { url, htmlId, itemType } = args;
  let resource: SearchEntryResource = {
    type: SearchEntryResourceType,
    id: url,
    relationships: {},
  };
  if (htmlId !== undefined) {
    resource.relationships.html = {
      data: { type: HtmlResourceType, id: htmlId },
    };
  }
  if (itemType !== undefined) {
    resource.relationships.item = { data: { type: itemType, id: url } };
  }
  return resource;
}

// One `html` rendering. Its id is the (card URL, format, renderType)
// composite — pass the same args the id derives from; `format`/`renderType`
// are also carried as attributes (the readable form; the id is an opaque
// cache key). `html` is absent only on an error rendering with no
// last-known-good markup. `styles` references the rendering's `css`
// resources by their content-hash ids.
export function buildHtmlResource(args: {
  url: string;
  format: PrerenderedHtmlFormat;
  renderType?: ResolvedCodeRef;
  html?: string;
  cardType: string;
  iconHtml?: string;
  isError?: boolean;
  cssIds: string[];
}): HtmlResource {
  let { url, format, renderType, html, cardType, iconHtml, isError, cssIds } =
    args;
  return {
    type: HtmlResourceType,
    id: htmlResourceId({ url, format, renderType }),
    attributes: {
      ...(html !== undefined ? { html } : {}),
      cardType,
      ...(iconHtml ? { iconHtml } : {}),
      ...(isError ? { isError: true } : {}),
      format,
      ...(renderType ? { renderType } : {}),
    },
    relationships: {
      styles: {
        data: cssIds.map((id) => ({ type: CssResourceType, id })),
      },
    },
  };
}

// A field-limited (`meta.sparseFields`) projection of a full serialization:
// only the requested fields' attributes (and the relationships rooted at a
// requested field) ride along, and the marker records exactly what was
// requested — so a consumer can tell "sparse" from "full but empty" and the
// Store can refuse it. id / type / links / meta are preserved per JSON:API;
// `meta.fields` is dropped since it describes per-field metadata for fields
// that may not be present.
export function buildSparseItemResource<
  T extends CardResource<Saved> | FileMetaResource,
>(resource: T, sparseFields: string[]): T {
  let attributes: Record<string, any> = {};
  for (let field of sparseFields) {
    let path = field.split('.');
    let value = pickAttributePath(resource.attributes, path);
    if (value !== undefined) {
      setAttributePath(attributes, path, value);
    }
  }
  // A requested field may be a relationship (linksTo / linksToMany — plural
  // entries serialize as `field.N` keys), keyed by its root segment.
  let requestedRoots = new Set(sparseFields.map((f) => f.split('.')[0]));
  let relationships: Record<string, Relationship | Relationship[]> = {};
  for (let [key, relationship] of Object.entries(
    resource.relationships ?? {},
  )) {
    if (requestedRoots.has(key.split('.')[0])) {
      relationships[key] = relationship;
    }
  }
  let { fields: _perFieldMeta, ...meta } = resource.meta;
  let sparse = {
    ...resource,
    attributes,
    meta: { ...meta, sparseFields: [...sparseFields] },
  };
  if (Object.keys(relationships).length > 0) {
    sparse.relationships = relationships;
  } else {
    delete sparse.relationships;
  }
  return sparse;
}

function pickAttributePath(
  source: Record<string, any> | undefined,
  path: string[],
): any {
  let value: any = source;
  for (let segment of path) {
    if (value == null || typeof value !== 'object') {
      return undefined;
    }
    value = value[segment];
  }
  return value;
}

function setAttributePath(
  target: Record<string, any>,
  path: string[],
  value: any,
): void {
  let cursor = target;
  for (let segment of path.slice(0, -1)) {
    cursor = cursor[segment] ??= {};
  }
  cursor[path[path.length - 1]] = value;
}
