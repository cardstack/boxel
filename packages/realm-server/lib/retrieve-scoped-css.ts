import type { DBAdapter } from '@cardstack/runtime-common';
import { query } from '@cardstack/runtime-common';
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

  let deps = coerceDeps(depsRow?.deps);
  if (!deps || deps.length === 0) {
    return null;
  }

  let scopedCSS = decodeScopedCSSFromDeps(deps);

  return scopedCSS;
}

function coerceDeps(deps: unknown): string[] | null {
  if (!deps) {
    return null;
  }
  if (Array.isArray(deps)) {
    return deps.filter((dep): dep is string => typeof dep === 'string');
  }
  if (Buffer.isBuffer(deps)) {
    try {
      let parsed = JSON.parse(deps.toString('utf8'));
      return Array.isArray(parsed)
        ? parsed.filter((dep): dep is string => typeof dep === 'string')
        : null;
    } catch (_error) {
      return null;
    }
  }
  if (typeof deps === 'string') {
    try {
      let parsed = JSON.parse(deps);
      return Array.isArray(parsed)
        ? parsed.filter((dep): dep is string => typeof dep === 'string')
        : null;
    } catch (_error) {
      return null;
    }
  }
  return null;
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
