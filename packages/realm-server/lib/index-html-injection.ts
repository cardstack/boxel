import type {
  DBAdapter,
  TessarMaterialization,
} from '@cardstack/runtime-common';
import { CardError, query } from '@cardstack/runtime-common';
import { tessarReadState } from '@cardstack/runtime-common/tessar-materialization';
import {
  indexURLCandidates,
  indexCandidateExpressions,
} from './index-url-utils.ts';

type TessarHTMLRow = {
  url: string;
  realm_url: string;
  generation: string | number;
  html_generation: string | number;
  html_error: unknown;
  tessar: TessarMaterialization | string | null;
};

async function tessarHTMLIsCurrent(db: DBAdapter, row?: TessarHTMLRow) {
  if (!row?.tessar) return true;
  if (row.html_error || Number(row.html_generation) !== Number(row.generation))
    return false;
  let stamp =
    typeof row.tessar === 'string' ? JSON.parse(row.tessar) : row.tessar;
  try {
    return (
      (await tessarReadState(db, row.realm_url, row.url, stamp)) === 'ready'
    );
  } catch (error) {
    // Leave the shell to show the explicit JSON failure after boot, rather
    // than injecting a previous successful dashboard into a failed page.
    if (error instanceof CardError && error.status === 503) return false;
    throw error;
  }
}

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

  // The head HTML lives on prerendered_html; the boxel_index join scopes the
  // lookup to a live instance row and supplies the generation for logging.
  let rows = await query(dbAdapter, [
    `
      SELECT ph.head_html AS head_html, i.generation, i.url, i.realm_url,
        ph.generation AS html_generation, ph.error_doc AS html_error,
        i.pristine_doc->'meta'->'tessar' AS tessar
      FROM boxel_index AS i
      JOIN prerendered_html AS ph
        ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type
      WHERE i.type = 'instance'
       AND ph.head_html IS NOT NULL
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

  if (
    !(await tessarHTMLIsCurrent(
      dbAdapter,
      rows[0] as TessarHTMLRow | undefined,
    ))
  )
    return null;

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

  // The isolated HTML lives on prerendered_html; the boxel_index join scopes
  // the lookup to a live instance row and supplies the generation for logging.
  let rows = await query(dbAdapter, [
    `
      SELECT ph.isolated_html AS isolated_html, i.generation, i.url, i.realm_url,
        ph.generation AS html_generation, ph.error_doc AS html_error,
        i.pristine_doc->'meta'->'tessar' AS tessar
      FROM boxel_index AS i
      JOIN prerendered_html AS ph
        ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type
      WHERE ph.isolated_html IS NOT NULL
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

  if (
    !(await tessarHTMLIsCurrent(
      dbAdapter,
      rows[0] as TessarHTMLRow | undefined,
    ))
  )
    return null;

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
