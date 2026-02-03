import type { DBAdapter } from '@cardstack/runtime-common';
import { expressionToSql, query } from '@cardstack/runtime-common';
import { parseDeps } from '@cardstack/runtime-common/realm';
import type { Expression } from '@cardstack/runtime-common/expression';
import { decodeScopedCSSRequest, isScopedCSSRequest } from 'glimmer-scoped-css';

export async function retrieveScopedCSS({
  cardURL,
  dbAdapter,
  indexURLCandidates,
  indexCandidateExpressions,
  log,
}: {
  cardURL: URL;
  dbAdapter: DBAdapter;
  indexURLCandidates: (cardURL: URL) => string[];
  indexCandidateExpressions: (candidates: string[]) => Expression;
  log?: {
    debug: (...args: unknown[]) => void;
    trace: (...args: unknown[]) => void;
  };
}): Promise<string | null> {
  let candidates = indexURLCandidates(cardURL);

  if (candidates.length === 0) {
    return null;
  }

  let scopedCSSQuery: Expression = [
    `
      SELECT deps, last_known_good_deps, realm_version
      FROM boxel_index
      WHERE type = 'instance'
        AND is_deleted IS NOT TRUE
        AND (deps IS NOT NULL OR last_known_good_deps IS NOT NULL)
        AND
    `,
    ...indexCandidateExpressions(candidates),
    `
      ORDER BY realm_version DESC
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
        realm_version?: string | number;
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
