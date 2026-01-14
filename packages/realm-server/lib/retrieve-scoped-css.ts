import type { DBAdapter } from '@cardstack/runtime-common';
import { query } from '@cardstack/runtime-common';
import { parseDeps } from '@cardstack/runtime-common/realm';
import type { Expression } from '@cardstack/runtime-common/expression';
import { decodeScopedCSSRequest, isScopedCSSRequest } from 'glimmer-scoped-css';

export async function retrieveScopedCSS({
  cardURL,
  dbAdapter,
  indexURLCandidates,
  indexCandidateExpressions,
}: {
  cardURL: URL;
  dbAdapter: DBAdapter;
  indexURLCandidates: (cardURL: URL) => string[];
  indexCandidateExpressions: (candidates: string[]) => Expression;
}): Promise<string | null> {
  let candidates = indexURLCandidates(cardURL);

  if (candidates.length === 0) {
    return null;
  }

  let rows = await query(dbAdapter, [
    `SELECT deps, realm_version FROM boxel_index_working WHERE deps IS NOT NULL AND`,
    ...indexCandidateExpressions(candidates),
    `UNION ALL
     SELECT deps, realm_version FROM boxel_index WHERE deps IS NOT NULL AND`,
    ...indexCandidateExpressions(candidates),
    `ORDER BY realm_version DESC
     LIMIT 1`,
  ]);

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
