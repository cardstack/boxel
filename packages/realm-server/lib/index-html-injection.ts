import type { DBAdapter } from '@cardstack/runtime-common';
import { query } from '@cardstack/runtime-common';
import {
  indexURLCandidates,
  indexCandidateExpressions,
} from './index-url-utils.ts';

export async function retrieveHeadHTML({
  cardURL,
  dbAdapter,
  log,
}: {
  cardURL: URL;
  dbAdapter: DBAdapter;
  log?: {
    debug: (...args: unknown[]) => void;
  };
}): Promise<string | null> {
  let candidates = indexURLCandidates(cardURL);

  log?.debug(
    `Head URL candidates for ${cardURL.href}: ${candidates.join(', ')}`,
  );

  if (candidates.length === 0) {
    log?.debug(`No head candidates for ${cardURL.href}`);
    return null;
  }

  // Dual-read: serve the head HTML from prerendered_html, falling back to the
  // boxel_index column only when no prerendered_html row exists (a present row
  // is authoritative, matching the query engine's `ph.url IS NULL` guard).
  let rows = await query(dbAdapter, [
    `
      SELECT CASE WHEN ph.url IS NULL THEN i.head_html ELSE ph.head_html END AS head_html, i.generation
      FROM boxel_index AS i
      LEFT JOIN prerendered_html AS ph
        ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type
      WHERE i.type = 'instance'
       AND (CASE WHEN ph.url IS NULL THEN i.head_html ELSE ph.head_html END) IS NOT NULL
       AND i.is_deleted IS NOT TRUE
       AND
    `,
    ...indexCandidateExpressions(candidates, 'i'),
    `
      ORDER BY i.generation DESC
      LIMIT 1
    `,
  ]);

  log?.debug('Head query result for %s', cardURL.href, rows);

  let headRow = rows[0] as
    | { head_html?: string | null; generation?: string | number }
    | undefined;

  if (headRow?.head_html != null) {
    log?.debug(
      `Using head HTML from generation ${headRow.generation} for ${cardURL.href}`,
    );
  } else {
    log?.debug(`No head HTML returned from database for ${cardURL.href}`);
  }
  return headRow?.head_html ?? null;
}

export async function retrieveIsolatedHTML({
  cardURL,
  dbAdapter,
  log,
}: {
  cardURL: URL;
  dbAdapter: DBAdapter;
  log?: {
    debug: (...args: unknown[]) => void;
  };
}): Promise<string | null> {
  let candidates = indexURLCandidates(cardURL);

  log?.debug(
    `Isolated URL candidates for ${cardURL.href}: ${candidates.join(', ')}`,
  );

  if (candidates.length === 0) {
    log?.debug(`No isolated candidates for ${cardURL.href}`);
    return null;
  }

  // Dual-read: serve the isolated HTML from prerendered_html, falling back to
  // the boxel_index column only when no prerendered_html row exists (a present
  // row is authoritative, matching the query engine's `ph.url IS NULL` guard).
  let rows = await query(dbAdapter, [
    `
      SELECT CASE WHEN ph.url IS NULL THEN i.isolated_html ELSE ph.isolated_html END AS isolated_html, i.generation
      FROM boxel_index AS i
      LEFT JOIN prerendered_html AS ph
        ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type
      WHERE (CASE WHEN ph.url IS NULL THEN i.isolated_html ELSE ph.isolated_html END) IS NOT NULL
        AND i.type = 'instance'
        AND i.is_deleted IS NOT TRUE
        AND
      `,
    ...indexCandidateExpressions(candidates, 'i'),
    `
      ORDER BY i.generation DESC
      LIMIT 1
    `,
  ]);

  log?.debug('Isolated query result for %s', cardURL.href, rows);

  let isolatedRow = rows[0] as
    | { isolated_html?: string | null; generation?: string | number }
    | undefined;

  if (isolatedRow?.isolated_html != null) {
    log?.debug(
      `Using isolated HTML from generation ${isolatedRow.generation} for ${cardURL.href}`,
    );
  } else {
    log?.debug(`No isolated HTML returned from database for ${cardURL.href}`);
  }

  return isolatedRow?.isolated_html ?? null;
}

export function injectHeadHTML(indexHTML: string, headHTML: string): string {
  return indexHTML.replace(
    /(<meta[^>]+data-boxel-head-start[^>]*>)([\s\S]*?)(<meta[^>]+data-boxel-head-end[^>]*>)/,
    (_match, start, _content, end) => `${start}\n${headHTML}\n${end}`,
  );
}

export function injectIsolatedHTML(
  indexHTML: string,
  isolatedHTML: string,
): string {
  return indexHTML.replace(
    /(<script[^>]+id="boxel-isolated-start"[^>]*>\s*<\/script>)([\s\S]*?)(<script[^>]+id="boxel-isolated-end"[^>]*>\s*<\/script>)/,
    (_match, start, _content, end) => `${start}\n${isolatedHTML}\n${end}`,
  );
}

export function ensureSingleTitle(headHTML: string): string {
  if (/<title[\s>]/.test(headHTML)) {
    return headHTML;
  }
  return `<title>Boxel</title>\n${headHTML}`;
}
