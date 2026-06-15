import type { Query, SparseFieldsets } from './query.ts';
import { DEFAULT_HTML_QUERY, type SearchEntryQuery } from './search-entry.ts';
import {
  resourceIdentity,
  type CardResource,
  type FileMetaResource,
  type HtmlQuery,
  type HtmlResource,
  type PrerenderedCardResource,
  type Saved,
  type SearchEntryResource,
} from './resource-types.ts';
import type {
  LinkableCollectionDocument,
  PrerenderedCardCollectionDocument,
  SearchEntryCollectionDocument,
} from './document-types.ts';
import type { PrerenderedHtmlFormat } from './prerendered-html-format.ts';
import type { CodeRef } from './code-ref.ts';

// ---------------------------------------------------------------------------
// The compat layer: the existing search endpoints expressed as thin adapters
// over the search-entry engine. Each legacy request translates into a
// `SearchEntryQuery` (constructed directly — no round-trip through the v2
// wire grammar), and the engine's `SearchEntryCollectionDocument` coalesces
// back into the legacy wire shape at the edge. The legacy contracts are
// frozen; fidelity is pinned by the endpoint golden tests.
// ---------------------------------------------------------------------------

// The legacy sparse-fieldset projection (`query.fields` + `asData`): per
// JSON:API, id / type / links / meta are always preserved and relationships
// ride along untouched — only attributes filter to the requested fields.
export function applySparseFieldset<
  T extends CardResource<Saved> | FileMetaResource,
>(resource: T, fields: string[]): T {
  if (fields.length === 0) {
    return { ...resource, attributes: {} };
  }
  let filtered: Record<string, any> = {};
  for (let field of fields) {
    if (resource.attributes?.[field] !== undefined) {
      filtered[field] = resource.attributes[field];
    }
  }
  return { ...resource, attributes: filtered };
}

// The live search: full `item` serializations only. The legacy sparse
// fieldset (`query.fields` + `asData`) is applied at the coalescing edge with
// the legacy projection — never the v2 sparse-item mechanism, whose marker
// and relationship filtering are not part of the legacy contract.
export function liveSearchEntryQuery(
  query: Query,
  opts?: { cardUrls?: string[] },
): SearchEntryQuery {
  return {
    itemQuery: query,
    htmlQuery: DEFAULT_HTML_QUERY,
    fieldset: {
      html: false,
      item: { kind: 'full' },
      itemAsFallback: false,
    },
    ...(opts?.cardUrls?.length ? { cardUrls: opts.cardUrls } : {}),
  };
}

// The prerendered search: both branches pinned. The `item` rides along so the
// coalescer can recover a row's actual type where no rendering matched. An
// explicit renderType translates to "the requested ancestor's rendering, or
// any of the format's renderings" — the coalescer then picks the requested
// ancestor and falls back to the native one, reproducing the legacy
// COALESCE(ancestor key, native key) column semantics.
export function prerenderedSearchEntryQuery(
  query: Query,
  opts: {
    htmlFormat: PrerenderedHtmlFormat;
    renderType?: CodeRef;
    cardUrls?: string[];
  },
): SearchEntryQuery {
  let { htmlFormat: format, renderType, cardUrls } = opts;
  let htmlQuery: HtmlQuery = renderType
    ? {
        any: [
          { every: [{ eq: { format } }, { eq: { renderType } }] },
          { eq: { format } },
        ],
      }
    : { eq: { format } };
  return {
    itemQuery: query,
    htmlQuery,
    fieldset: {
      html: true,
      item: { kind: 'full' },
      itemAsFallback: false,
    },
    ...(cardUrls?.length ? { cardUrls } : {}),
  };
}

function itemFor(
  entry: SearchEntryResource,
  byIdentity: Map<string, CardResource<Saved> | FileMetaResource>,
): CardResource<Saved> | FileMetaResource | undefined {
  let ref = entry.relationships.item?.data;
  if (!ref) {
    return undefined;
  }
  return byIdentity.get(resourceIdentity(ref.type, ref.id));
}

// Coalesce a search-entry document into the legacy live-search shape: the
// `item` serializations become `data` (in entry order), and the remaining
// `card`/`file-meta` resources — the transitive link expansion — become
// `included`. A legacy sparse fieldset projects `data` with the legacy
// semantics (attributes filtered; relationships and meta untouched).
export function searchEntryDocToLinkableDoc(
  doc: SearchEntryCollectionDocument,
  opts?: { fields?: SparseFieldsets },
): LinkableCollectionDocument {
  let byIdentity = new Map<string, CardResource<Saved> | FileMetaResource>();
  for (let resource of doc.included ?? []) {
    if (
      (resource.type === 'card' || resource.type === 'file-meta') &&
      resource.id
    ) {
      byIdentity.set(resourceIdentity(resource.type, resource.id), resource);
    }
  }

  let data: (CardResource<Saved> | FileMetaResource)[] = [];
  let dataIdentities = new Set<string>();
  for (let entry of doc.data) {
    let item = itemFor(entry, byIdentity);
    if (!item) {
      continue;
    }
    let fields = opts?.fields?.[item.type === 'card' ? 'card' : 'file-meta'];
    data.push(fields !== undefined ? applySparseFieldset(item, fields) : item);
    dataIdentities.add(resourceIdentity(item.type, item.id));
  }

  let included = (doc.included ?? []).filter(
    (resource): resource is CardResource<Saved> | FileMetaResource =>
      (resource.type === 'card' || resource.type === 'file-meta') &&
      !dataIdentities.has(resourceIdentity(resource.type, resource.id)),
  );

  let result: LinkableCollectionDocument = {
    data,
    meta: { page: doc.meta.page },
  };
  if (included.length > 0) {
    result.included = included;
  }
  return result;
}

// A serialized item's `adoptsFrom` may be relative to the instance; the
// rendering attributes carry absolute refs, so resolve before comparing.
function absoluteRef(
  ref: CodeRef | undefined,
  baseId: string,
): CodeRef | undefined {
  if (!ref || !('module' in ref)) {
    return ref;
  }
  if (/^\.\.?\//.test(ref.module)) {
    try {
      return { ...ref, module: new URL(ref.module, baseId).href as never };
    } catch {
      return ref;
    }
  }
  return ref;
}

function sameRef(a: CodeRef | undefined, b: CodeRef | undefined): boolean {
  return (
    !!a &&
    !!b &&
    'module' in a &&
    'module' in b &&
    a.module === b.module &&
    a.name === b.name
  );
}

// Coalesce a search-entry document into the legacy prerendered shape. Every
// matched entry appears in `data`; the picked rendering supplies the html /
// cardType / iconHtml / isError attributes and the rendered-as type
// (`meta.adoptsFrom`); a row with no matching rendering emits `html: ''`
// with its actual type recovered from the `item`. The renderings' first-class
// `css` resources flatten into `meta.scopedCssUrls`.
export function searchEntryDocToPrerenderedDoc(
  doc: SearchEntryCollectionDocument,
  opts: {
    renderType?: CodeRef;
    // The dispatch-level file signal: a file-meta query sets `meta.isFileMeta`
    // even when it matches zero rows, so the caller (which knows the
    // dispatch) passes it; the item-derived fallback covers callers that
    // don't.
    isFileMeta?: boolean;
  },
): PrerenderedCardCollectionDocument {
  let htmlById = new Map<string, HtmlResource>();
  let scopedCssUrls: string[] = [];
  let byIdentity = new Map<string, CardResource<Saved> | FileMetaResource>();
  for (let resource of doc.included ?? []) {
    if (resource.type === 'html') {
      htmlById.set(resource.id, resource);
    } else if (resource.type === 'css') {
      scopedCssUrls.push(resource.attributes.href);
    } else if (
      (resource.type === 'card' || resource.type === 'file-meta') &&
      resource.id
    ) {
      byIdentity.set(resourceIdentity(resource.type, resource.id), resource);
    }
  }

  // A prerendered document is uniformly instances or files (the engine
  // dispatches the whole query one way or the other) — the caller's
  // dispatch-level signal wins; the items' type covers the rest.
  let isFileMeta =
    opts.isFileMeta ??
    doc.data.some(
      (entry) => entry.relationships.item?.data.type === 'file-meta',
    );
  let data: PrerenderedCardResource[] = [];
  for (let entry of doc.data) {
    let item = itemFor(entry, byIdentity);
    let members = (entry.relationships.html?.data ?? [])
      .map((ref) => htmlById.get(ref.id))
      .filter((member): member is HtmlResource => member !== undefined);
    // The requested ancestor's rendering when present; else the native one
    // (the row's own type, recovered from the item); else nothing — exactly
    // the legacy COALESCE(requested key, native key) selection, which never
    // substituted an unrelated ancestor. Without a renderType request the
    // native rule means the sole member is the native rendering.
    let nativeRef = absoluteRef(item?.meta.adoptsFrom, entry.id);
    let picked = opts.renderType
      ? (members.find((member) =>
          sameRef(member.attributes.renderType, opts.renderType),
        ) ??
        members.find((member) =>
          sameRef(member.attributes.renderType, nativeRef),
        ))
      : members[0];

    let resource: PrerenderedCardResource = {
      type: 'prerendered-card',
      // The legacy prerendered id is the index row's file URL: a file's own
      // URL as-is, an instance's card URL plus the `.json` extension the
      // search-entry identity strips.
      id: isFileMeta ? entry.id : `${entry.id}.json`,
      attributes: {
        html: picked?.attributes.html ?? '',
        ...(picked?.attributes.cardType
          ? { cardType: picked.attributes.cardType }
          : {}),
        ...(picked?.attributes.iconHtml
          ? { iconHtml: picked.attributes.iconHtml }
          : {}),
        ...(picked?.attributes.isError ? { isError: true } : {}),
      },
      relationships: {
        'prerendered-card-css': { data: [] },
      },
      meta: {},
    };
    let adoptsFrom = picked?.attributes.renderType ?? item?.meta.adoptsFrom;
    if (adoptsFrom) {
      resource.meta.adoptsFrom = adoptsFrom;
    }
    data.push(resource);
  }

  let result: PrerenderedCardCollectionDocument = {
    data,
    meta: { page: doc.meta.page },
  };
  if (scopedCssUrls.length > 0) {
    result.meta.scopedCssUrls = scopedCssUrls;
  }
  if (isFileMeta) {
    result.meta.isFileMeta = true;
  }
  return result;
}
