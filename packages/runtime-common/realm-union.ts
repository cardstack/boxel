// A search over several realms that share one index database, run as one
// statement (docs/search.md, "Federated search"). The engine scopes every
// read of a search by the realm it is given; a `RealmUnion` is that realm
// argument when the search spans several. It is a URL — its `href` is the
// first realm's, so code that only names a realm (a log line, a cache of
// one realm's facts) reads as it did — and carries the realms it stands
// for, so every condition that scopes a read to the realm scopes it to all
// of them (`realmIs`).
//
// Which rows of each realm a caller may read is not the union's business:
// that is the admission filter (`realmAdmissionFilter`), which the engine
// applies to every read of the search as its base condition, as it applies a
// single realm's grants.

import { param, separatedByCommas } from './expression.ts';
import type { Expression } from './expression.ts';
import type { Filter } from './query.ts';

export class RealmUnion extends URL {
  readonly realms: readonly string[];
  // The realms whose word statistics (term frequencies, row counts, the
  // typo word list) the union's text ranking reads. Every realm, unless the
  // caller reads some only through a policy: their statistics count cards
  // the caller may not read, so the union leaves them out and ranks by the
  // realms the caller reads outright.
  readonly statisticsRealms: readonly string[];
  constructor(realms: string[], opts?: { statisticsRealms?: string[] }) {
    if (realms.length === 0) {
      throw new Error('a realm union names at least one realm');
    }
    super(realms[0]);
    this.realms = [...new Set(realms)];
    this.statisticsRealms = opts?.statisticsRealms
      ? [...new Set(opts.statisticsRealms)]
      : this.realms;
  }
}

export function isRealmUnion(url: URL | undefined): url is RealmUnion {
  return url instanceof RealmUnion;
}

// The realms a search's realm argument stands for.
export function realmsOf(url: URL): string[] {
  return isRealmUnion(url) ? [...url.realms] : [url.href];
}

// `column` is one of the realms the search reads: `= $1` for one realm,
// `IN ($1, $2, …)` for a union. Written as `IN` for a union of one too, so a
// union's statement is recognizably the union's.
export function realmIs(column: string, url: URL): Expression {
  if (!isRealmUnion(url)) {
    return [`${column} =`, param(url.href)];
  }
  let realms: Expression[] = url.realms.map((realm) => [param(realm)]);
  let list = separatedByCommas(realms) as Expression;
  return [`${column} IN (`, ...list, ')'];
}

// `column` is one of the realms whose word statistics the search reads
// (`RealmUnion.statisticsRealms`); FALSE for a union that reads none.
export function statisticsRealmIs(column: string, url: URL): Expression {
  if (!isRealmUnion(url)) {
    return [`${column} =`, param(url.href)];
  }
  if (url.statisticsRealms.length === 0) {
    return ['FALSE'];
  }
  let realms: Expression[] = url.statisticsRealms.map((realm) => [
    param(realm),
  ]);
  let list = separatedByCommas(realms) as Expression;
  return [`${column} IN (`, ...list, ')'];
}

// The realm of the union a card URL belongs to: the longest realm URL it
// starts with, so a realm mounted inside another's path is told apart.
export function realmOfCard(url: URL, cardURL: string): string | undefined {
  let best: string | undefined;
  for (let realm of realmsOf(url)) {
    if (cardURL.startsWith(realm) && (!best || realm.length > best.length)) {
      best = realm;
    }
  }
  return best;
}

// Which rows of each realm of a union the caller may read: every row of a
// realm they read outright, and the rows a realm's policy grants admit in a
// realm reached only through its policy. An internal filter node the engine
// compiles to
//
//   i.realm_url IN (<read outright>)
//   OR (i.realm_url = <scoped realm> AND (<its grants>))
//   OR …
//
// It is applied as the search's `grantFilter`, the base condition every read
// of the search carries (rows, totals, facets, bindings, comparison sets,
// near counts, broad-match probes) and as its `labelFilter`. Only a node made
// here compiles: one that arrives any other way, a request's filter
// included, is no filter the engine knows and fails the search.
export interface RealmAdmission {
  realmAdmission: {
    readable: string[];
    scoped: { realm: string; grants: Filter[] }[];
  };
}

const admissions = new WeakSet<object>();

export function realmAdmissionFilter(
  readable: string[],
  scoped: { realm: string; grants: Filter[] }[],
): Filter {
  let node: RealmAdmission = {
    realmAdmission: {
      readable: [...readable],
      scoped: scoped.map(({ realm, grants }) => {
        if (grants.length === 0) {
          throw new Error(
            `a policy-scoped realm in a union needs at least one grant filter; with none, ${realm} would be read unscoped`,
          );
        }
        return { realm, grants: [...grants] };
      }),
    },
  };
  admissions.add(node);
  return node as unknown as Filter;
}

export function isRealmAdmissionFilter(
  filter: unknown,
): filter is RealmAdmission {
  return (
    typeof filter === 'object' &&
    filter !== null &&
    admissions.has(filter) &&
    'realmAdmission' in filter
  );
}
