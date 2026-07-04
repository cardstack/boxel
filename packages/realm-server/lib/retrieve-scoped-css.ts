import type { DBAdapter } from '@cardstack/runtime-common';
import { expressionToSql, query } from '@cardstack/runtime-common';
import { parseDeps } from '@cardstack/runtime-common/realm';
import type { Expression } from '@cardstack/runtime-common/expression';
import { decodeScopedCSSRequest, isScopedCSSRequest } from 'glimmer-scoped-css';
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

  // Dual-read: the scoped-CSS URLs needed to serve a card's HTML ride on the
  // prerendered_html `deps` / `last_known_good_deps`, falling back to the
  // boxel_index columns when no prerendered_html row exists.
  let scopedCSSQuery: Expression = [
    `
      SELECT coalesce(ph.deps, i.deps) AS deps,
             coalesce(ph.last_known_good_deps, i.last_known_good_deps) AS last_known_good_deps,
             i.generation
      FROM boxel_index AS i
      LEFT JOIN prerendered_html AS ph
        ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type
      WHERE i.type = 'instance'
        AND i.is_deleted IS NOT TRUE
        AND (coalesce(ph.deps, i.deps) IS NOT NULL
             OR coalesce(ph.last_known_good_deps, i.last_known_good_deps) IS NOT NULL)
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

  let deps = parseDeps(depsRow?.deps);
  let scopedCSS = decodeScopedCSSFromDeps(deps);

  // Fall back to last_known_good_deps if no CSS found in deps
  if (!scopedCSS) {
    let lastKnownGoodDeps = parseDeps(depsRow?.last_known_good_deps);
    scopedCSS = decodeScopedCSSFromDeps(lastKnownGoodDeps);
  }

  return scopedCSS;
}

function decodeScopedCSSFromDeps(deps: string[]): string | null {
  let cssBlocks = new Set<string>();

  for (let dep of deps) {
    if (typeof dep !== 'string') {
      continue;
    }
    let pathname: string;
    try {
      pathname = new URL(dep).pathname;
    } catch (_error) {
      continue;
    }
    if (!isScopedCSSRequest(pathname)) {
      continue;
    }
    let decoded = decodeScopedCSSRequest(pathname);
    if (decoded?.css) {
      cssBlocks.add(decoded.css);
    }
  }

  if (cssBlocks.size === 0) {
    return null;
  }
  return [...cssBlocks].join('\n');
}
