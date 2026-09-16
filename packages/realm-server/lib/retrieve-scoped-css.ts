import type { DBAdapter } from '@cardstack/runtime-common';
import { expressionToSql, query } from '@cardstack/runtime-common';
import { parseDeps } from '@cardstack/runtime-common/realm';
import type { Expression } from '@cardstack/runtime-common/expression';
import {
  isScopedCSSRequest,
  parseScopedCSSRequest,
} from '@cardstack/runtime-common/scoped-css';
import {
  indexURLCandidates,
  indexCandidateExpressions,
} from './index-url-utils.ts';

export async function retrieveScopedCSS({
  cardURL,
  dbAdapter,
  log,
}: {
  cardURL: URL;
  dbAdapter: DBAdapter;
  log?: {
    debug: (...args: unknown[]) => void;
    trace: (...args: unknown[]) => void;
  };
}): Promise<string | null> {
  let candidates = indexURLCandidates(cardURL);

  if (candidates.length === 0) {
    return null;
  }

  // The scoped-CSS URLs needed to serve a card's HTML ride on the
  // prerendered_html `deps` / `last_known_good_deps` — the deps captured by
  // the render that produced the HTML being served. The boxel_index join
  // scopes the lookup to a live instance row and supplies the generation.
  let scopedCSSQuery: Expression = [
    `
      SELECT ph.deps AS deps,
             ph.last_known_good_deps AS last_known_good_deps,
             i.generation
      FROM boxel_index AS i
      JOIN prerendered_html AS ph
        ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type
      WHERE i.type = 'instance'
        AND i.is_deleted IS NOT TRUE
        AND (ph.deps IS NOT NULL OR ph.last_known_good_deps IS NOT NULL)
        AND
    `,
    ...indexCandidateExpressions(candidates, 'i'),
    `
      ORDER BY i.generation DESC
      LIMIT 1
    `,
  ];

  if (log) {
    let sql = expressionToSql(dbAdapter.kind, scopedCSSQuery);
    let compactSql = sql.text.replace(/\s+/g, ' ').trim();
    let values = JSON.stringify(sql.values);
    log.trace(
      'Scoped CSS query for %s: %s; values=%s',
      cardURL.href,
      compactSql,
      values,
    );
  }

  let rows = await query(dbAdapter, scopedCSSQuery);

  let depsRow = rows[0] as
    | {
        deps?: string[] | string | null;
        last_known_good_deps?: string[] | string | null;
        generation?: string | number;
      }
    | undefined;

  let lookup = (hashes: string[]) => lookupScopedCSSByHash(dbAdapter, hashes);

  let deps = parseDeps(depsRow?.deps);
  let scopedCSS = await resolveScopedCSSFromDeps(deps, lookup);

  // Fall back to last_known_good_deps if no CSS found in deps
  if (!scopedCSS) {
    let lastKnownGoodDeps = parseDeps(depsRow?.last_known_good_deps);
    scopedCSS = await resolveScopedCSSFromDeps(lastKnownGoodDeps, lookup);
  }

  return scopedCSS;
}

// Resolve the stylesheets a deps list references, deduped and joined in dep
// order. Deps carry scoped CSS in two forms: inline (the whole stylesheet
// base64-embedded in the URL — decodes with no lookup) and hashed (the URL
// carries a content hash; the bytes live in the `scoped_css` table). Both
// forms appear in prefix-form RRIs (`@cardstack/base/...`) as well as
// absolute URLs; parsing anchors on the trailing filename segment, so neither
// needs a URL parse. A hash the table no longer holds is skipped.
export async function resolveScopedCSSFromDeps(
  deps: string[],
  lookupCSSByHash: (hashes: string[]) => Promise<Map<string, string>>,
): Promise<string | null> {
  let entries: ({ css: string } | { hash: string })[] = [];
  let hashes = new Set<string>();

  for (let dep of deps) {
    if (typeof dep !== 'string' || !isScopedCSSRequest(dep)) {
      continue;
    }
    let parsed: ReturnType<typeof parseScopedCSSRequest>;
    try {
      parsed = parseScopedCSSRequest(dep);
    } catch (_err) {
      continue;
    }
    if (parsed.form === 'inline') {
      entries.push({ css: parsed.css });
    } else {
      entries.push({ hash: parsed.cssHash });
      hashes.add(parsed.cssHash);
    }
  }

  let cssByHash =
    hashes.size > 0 ? await lookupCSSByHash([...hashes]) : new Map();

  let cssBlocks = new Set<string>();
  for (let entry of entries) {
    let css = 'css' in entry ? entry.css : cssByHash.get(entry.hash);
    if (css) {
      cssBlocks.add(css);
    }
  }

  if (cssBlocks.size === 0) {
    return null;
  }
  return [...cssBlocks].join('\n');
}

// Interned stylesheets are content-addressed, so the lookup is by hash alone:
// any realm's copy of the same bytes qualifies, which keeps deps on modules
// from other realms (base-realm components) servable.
export async function lookupScopedCSSByHash(
  dbAdapter: DBAdapter,
  hashes: string[],
): Promise<Map<string, string>> {
  if (hashes.length === 0) {
    return new Map();
  }
  let placeholders = hashes.map((_, i) => `$${i + 1}`).join(', ');
  let rows = (await dbAdapter.execute(
    `SELECT hash, css FROM scoped_css WHERE hash IN (${placeholders})`,
    { bind: hashes },
  )) as { hash: string; css: string }[];
  return new Map(rows.map(({ hash, css }) => [hash, css]));
}
