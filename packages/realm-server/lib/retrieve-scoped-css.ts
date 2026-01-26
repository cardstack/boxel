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
  log?: { debug: (...args: unknown[]) => void; trace: (...args: unknown[]) => void };
}): Promise<string | null> {
  let candidates = indexURLCandidates(cardURL);

  if (candidates.length === 0) {
    return null;
  }

  let scopedCSSQuery: Expression = [
    `SELECT deps, realm_version FROM boxel_index_working WHERE deps IS NOT NULL AND`,
    ...indexCandidateExpressions(candidates),
    `UNION ALL
     SELECT deps, realm_version FROM boxel_index WHERE deps IS NOT NULL AND`,
    ...indexCandidateExpressions(candidates),
    `ORDER BY realm_version DESC
     LIMIT 1`,
  ];

  if (log) {
    let sql = expressionToSql(dbAdapter.kind, scopedCSSQuery);
    log.trace('Scoped CSS query for %s: %s', cardURL.href, sql.text);
    if (sql.values.length > 0) {
      log.trace('Scoped CSS query values for %s', cardURL.href, sql.values);
    }
  }

  let rows = await query(dbAdapter, scopedCSSQuery);

  let depsRow = rows[0] as
    | { deps?: string[] | string | null; realm_version?: string | number }
    | undefined;

  let deps = parseDeps(depsRow?.deps);
  if (deps.length === 0) {
    return null;
  }

  let scopedCSS = decodeScopedCSSFromDeps(deps);

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
