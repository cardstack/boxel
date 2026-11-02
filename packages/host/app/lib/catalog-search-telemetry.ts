import {
  CATALOG_REALM_PREFIX,
  coerceErrorMessage,
  ensureTrailingSlash,
  collectPositiveMatchTerms,
  getTypeRefsFromFilter,
  isResolvedCodeRef,
  RealmPaths,
  ri,
  rri,
  type Query,
} from '@cardstack/runtime-common';

import { canonicalRealmIdentifier } from './realm-utils';

import type ClientTelemetryService from '../services/client-telemetry';
import type NetworkService from '../services/network';
import type RealmServerService from '../services/realm-server';

// The longest text a catalog-search event carries in one field, the same
// bound a client-error event puts on its message.
const MAX_TELEMETRY_TEXT_CHARS = 300;

// One entry search the assistant made, as a catalog-search event needs it.
export interface CatalogSearch {
  tool: 'run-realm-code' | 'search-entries';
  query: Query;
  // The realms the search was sent to, as the store resolved them. Empty when
  // it was sent to none.
  realms: string[];
  // What it answered: the match count of each realm that answered, keyed by
  // realm URL, and the URLs of the rows it returned. Absent when it threw.
  found?: {
    total: number;
    realmTotals: Record<string, number> | undefined;
    rowURLs: string[];
  };
  // The error it threw, or the one the caller raised over its answer.
  error?: unknown;
  // The workspace a run-realm-code script ran in.
  realm: string | null;
}

// Records the search as a catalog-search event when it was sent to a catalog
// realm: `@cardstack/catalog/`, a catalog the realm server lists, or one the
// user added. It counts only what the catalog realms answered.
export function recordCatalogSearch(
  services: {
    clientTelemetry: ClientTelemetryService;
    network: NetworkService;
    realmServer: RealmServerService;
  },
  { tool, query, realms, found, error, realm }: CatalogSearch,
): void {
  try {
    let { virtualNetwork } = services.network;
    let catalogs = [
      ri(CATALOG_REALM_PREFIX),
      ...services.realmServer.displayedCatalogRealmIdentifiers,
    ].map(
      (catalog) =>
        new RealmPaths(canonicalRealmIdentifier(virtualNetwork, catalog)),
    );
    let isCatalog = (url: string) => {
      let id = rri(virtualNetwork.unresolveURL(url));
      return catalogs.some((catalog) => catalog.inRealm(id));
    };
    let searched = realms.filter((searchedRealm) =>
      isCatalog(ensureTrailingSlash(searchedRealm)),
    );
    if (searched.length === 0) {
      return;
    }

    let total: number | null = null;
    let returned: number | null = null;
    let failure =
      error === undefined ? '' : coerceErrorMessage(error, 'unknown error');
    if (found?.realmTotals) {
      // A realm that failed to answer has no count, so a searched catalog
      // realm none of the counts belongs to did not answer.
      let answered = Object.entries(found.realmTotals)
        .filter(([answeredRealm]) => isCatalog(answeredRealm))
        .map(([answeredRealm, count]) => ({
          paths: new RealmPaths(
            canonicalRealmIdentifier(virtualNetwork, answeredRealm),
          ),
          count,
        }));
      let unanswered = searched.some((searchedRealm) => {
        let id = rri(canonicalRealmIdentifier(virtualNetwork, searchedRealm));
        return !answered.some(({ paths }) => paths.inRealm(id));
      });
      if (unanswered) {
        failure ||= 'a catalog realm did not answer';
      } else {
        total = answered.reduce((sum, { count }) => sum + count, 0);
        returned = found.rowURLs.filter(isCatalog).length;
      }
    } else if (found) {
      // No count per realm: the total is the catalog's only when every realm
      // searched is a catalog.
      total = searched.length === realms.length ? found.total : null;
      returned = found.rowURLs.filter(isCatalog).length;
    }

    services.clientTelemetry.recordEvent({
      event_type: 'catalog-search',
      tool,
      query_text: boundText(collectPositiveMatchTerms(query.filter).join(' ')),
      query_type: filterTypeOf(query),
      total,
      returned,
      error: boundText(failure),
      realm,
    });
  } catch (e) {
    // Telemetry must never break the search it reports on.
    console.error('recording a catalog search failed', e);
  }
}

// The first card type the query's filter names with `on` or `type` and does
// not exclude, as `module#name`. Empty when it names none.
function filterTypeOf(query: Query): string {
  let ref = query.filter
    ? getTypeRefsFromFilter(query.filter)?.find(
        (typeRef) => !typeRef.negated && isResolvedCodeRef(typeRef.ref),
      )?.ref
    : undefined;
  return ref && isResolvedCodeRef(ref) ? `${ref.module}#${ref.name}` : '';
}

// Text cut to MAX_TELEMETRY_TEXT_CHARS code points, marked with an ellipsis
// when cut. Cut by code point, so a character outside the Basic Multilingual
// Plane, such as an emoji, is never split into half a surrogate pair.
function boundText(text: string): string {
  let codePoints = Array.from(text);
  return codePoints.length > MAX_TELEMETRY_TEXT_CHARS
    ? `${codePoints.slice(0, MAX_TELEMETRY_TEXT_CHARS - 1).join('')}…`
    : text;
}
