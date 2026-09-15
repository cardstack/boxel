// Build a workload from the realm under test rather than from a file someone
// mailed you.
//
// `GET <realm>/_types` returns one entry per type present in the realm, with an
// instance count. Taking the highest-count types gives the queries whose cost
// actually dominates that realm, without anyone having to read its card source
// first — and because the result is derived from the target, two people
// pointing at the same realm get the same workload without exchanging anything.
//
// The endpoint needs the same per-realm JWT the searches use. A bare server
// token gets a 401 whose body reads "User permissions in the JWT payload do not
// match the server's permissions", which is the single most likely way this
// goes wrong.

import type { RawWorkload } from './workload.ts';

export interface CardTypeSummaryEntry {
  type?: string;
  id?: string;
  attributes?: {
    displayName?: string;
    total?: number;
    // Inline SVG, a few hundred bytes per entry. Declared because the endpoint
    // sends it; nothing here reads it.
    iconHTML?: string;
    kind?: string;
  };
}

export interface DeriveOptions {
  realmUrl: string;
  // How many types to query. The realm's long tail contributes little load and
  // a lot of noise to the per-shape table.
  top: number;
  // Page size for every derived query. 0 leaves them unbounded, which is the
  // shape a whole-table dashboard query has.
  pageSize: number;
}

export async function fetchCardTypeSummary({
  realmUrl,
  authorization,
}: {
  realmUrl: string;
  authorization: string;
}): Promise<CardTypeSummaryEntry[]> {
  let url = `${realmUrl}_types`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: authorization },
    });
  } catch (e) {
    throw new Error(
      `Could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  let text = await response.text();
  if (!response.ok) {
    // Never fall back to a built-in workload here. Two people who believe they
    // ran the same test, and did not, is worse than a failed run.
    throw new Error(deriveFailureMessage(url, response.status, text));
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return JSON`);
  }
  let data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) {
    throw new Error(`${url} returned no "data" array`);
  }
  return data as CardTypeSummaryEntry[];
}

function deriveFailureMessage(
  url: string,
  status: number,
  body: string,
): string {
  let detail = body.slice(0, 200);
  if (status === 401 || status === 403) {
    return (
      `${url} → ${status}. ${detail}\n` +
      `  Deriving a workload needs this realm's own JWT, not the realm-server ` +
      `session token.\n` +
      `  Check that _realm-auth returned an entry for ${url.replace(/_types$/, '')} ` +
      `— a user who\n` +
      `  cannot read the realm gets a token that does not cover it.`
    );
  }
  if (status === 404) {
    return (
      `${url} → 404. ${detail}\n` +
      `  Check the realm URL is right and that the realm exists on this ` +
      `realm server.`
    );
  }
  return `${url} → ${status}. ${detail}`;
}

// The highest-count instance types, as a workload.
export function workloadFromCardTypeSummary(
  entries: CardTypeSummaryEntry[],
  { realmUrl, top, pageSize }: DeriveOptions,
): RawWorkload {
  let ranked = entries
    // `file` entries are not searchable through `item.on`, which is the only
    // type anchor the entry grammar has.
    .filter((entry) => entry?.attributes?.kind === 'instance')
    .map((entry) => ({ entry, anchor: typeAnchor(entry.id) }))
    .filter(
      (
        row,
      ): row is {
        entry: CardTypeSummaryEntry;
        anchor: { module: string; name: string };
      } => row.anchor !== undefined,
    )
    // Total descending, then id ascending. The tiebreak is not decoration:
    // types routinely share a count, and without it two derivations of the
    // same realm would disagree about which ones made the cut.
    .sort(
      (a, b) =>
        (b.entry.attributes?.total ?? 0) - (a.entry.attributes?.total ?? 0) ||
        (a.entry.id ?? '').localeCompare(b.entry.id ?? ''),
    );

  if (ranked.length === 0) {
    throw new Error(
      'No instance types found in this realm, so there is nothing to query.',
    );
  }

  let selected = ranked.slice(0, Math.max(1, top)).map(({ entry, anchor }) => ({
    entry,
    realmLocal: anchor.module.startsWith(realmUrl),
    // Written back as `${realm}…`, the same placeholder a hand-written
    // workload uses. An emitted file is then portable across clones of the
    // realm instead of pinned to the one it was derived from, and `expand()`
    // puts the URL back when it is loaded.
    anchor: {
      module: anchor.module.startsWith(realmUrl)
        ? `\${realm}${anchor.module.slice(realmUrl.length)}`
        : anchor.module,
      name: anchor.name,
    },
  }));

  let labels = new Set<string>();
  let queries = selected.map(({ entry, anchor }) => {
    let query: Record<string, unknown> = {
      label: uniqueLabel(entry.attributes?.displayName || anchor.name, labels),
      filter: { 'item.on': { module: anchor.module, name: anchor.name } },
    };
    if (pageSize > 0) {
      query.page = { size: pageSize };
    }
    return query;
  });

  // The writers post an instance of the realm's own highest-count type, so the
  // write invalidates something the readers are actually querying — a write
  // nobody's query covers exercises the index but not the fan-out. A type
  // defined outside the realm cannot be the target: its module is not
  // addressable relative to this realm.
  let writeTarget = selected.find((row) => row.realmLocal) ?? selected[0];

  return {
    queries,
    // Attributes are left empty on purpose. The summary endpoint reports type
    // names and counts, not field schemas, so any attribute guessed here could
    // be rejected. A POST with no attributes still creates an instance, which
    // is all the invalidation needs. Fill them in if you commit this file.
    write: {
      path: writeTarget.anchor.name,
      adoptsFrom: writeTarget.anchor,
      attributes: {},
    },
  };
}

// `<module>/<Name>`, split at the LAST separator. Both spellings in circulation
// split correctly this way: the prefix form (`@cardstack/base/spec/Spec`) and
// the URL form (`https://…/experiments/author/Author`).
function typeAnchor(
  id: string | undefined,
): { module: string; name: string } | undefined {
  if (typeof id !== 'string') {
    return undefined;
  }
  let i = id.lastIndexOf('/');
  if (i <= 0 || i === id.length - 1) {
    return undefined;
  }
  return { module: id.slice(0, i), name: id.slice(i + 1) };
}

// Two types can share a display name, and the per-shape summary table is keyed
// by label, so a collision would silently merge two shapes into one row.
function uniqueLabel(base: string, used: Set<string>): string {
  let label = base;
  for (let n = 2; used.has(label); n++) {
    label = `${base} #${n}`;
  }
  used.add(label);
  return label;
}
