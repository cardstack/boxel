import type { DBAdapter } from '@cardstack/runtime-common';
import { query } from '@cardstack/runtime-common';
import {
  indexURLCandidates,
  indexCandidateExpressions,
} from './index-url-utils.ts';

// Prerendered markup read for a page, with the card it was read from: the
// candidates a page URL expands to can name more than one card (`foo.json` and
// `foo/index.json`), and whatever governs the markup is that card's.
export interface RetrievedMarkup {
  html: string | null;
  // The card whose row the markup came from, as a card URL; null when no row
  // held any.
  cardURL: URL | null;
}

function matchedCardURL(rowURL: string | null | undefined): URL | null {
  return rowURL ? new URL(rowURL.replace(/\.json$/, '')) : null;
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
}): Promise<RetrievedMarkup> {
  let candidates = indexURLCandidates(cardURL);

  log?.debug(
    `Head URL candidates for ${cardURL.href}: ${candidates.join(', ')}`,
  );

  if (candidates.length === 0) {
    log?.debug(`No head candidates for ${cardURL.href}`);
    return { html: null, cardURL: null };
  }

  // The head HTML lives on prerendered_html; the boxel_index join scopes the
  // lookup to a live instance row and supplies the generation for logging.
  let rows = await query(dbAdapter, [
    `
      SELECT ph.head_html AS head_html, i.url AS url, i.generation
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

  let headRow = rows[0] as
    | { head_html?: string | null; url?: string; generation?: string | number }
    | undefined;

  if (headRow?.head_html != null) {
    log?.debug(
      `Using head HTML from generation ${headRow.generation} for ${cardURL.href}`,
    );
  } else {
    log?.debug(`No head HTML returned from database for ${cardURL.href}`);
  }
  return {
    html: headRow?.head_html ?? null,
    cardURL: matchedCardURL(headRow?.url),
  };
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
}): Promise<RetrievedMarkup> {
  let candidates = indexURLCandidates(cardURL);

  log?.debug(
    `Isolated URL candidates for ${cardURL.href}: ${candidates.join(', ')}`,
  );

  if (candidates.length === 0) {
    log?.debug(`No isolated candidates for ${cardURL.href}`);
    return { html: null, cardURL: null };
  }

  // The isolated HTML lives on prerendered_html; the boxel_index join scopes
  // the lookup to a live instance row and supplies the generation for logging.
  let rows = await query(dbAdapter, [
    `
      SELECT ph.isolated_html AS isolated_html, i.url AS url, i.generation
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

  let isolatedRow = rows[0] as
    | {
        isolated_html?: string | null;
        url?: string;
        generation?: string | number;
      }
    | undefined;

  if (isolatedRow?.isolated_html != null) {
    log?.debug(
      `Using isolated HTML from generation ${isolatedRow.generation} for ${cardURL.href}`,
    );
  } else {
    log?.debug(`No isolated HTML returned from database for ${cardURL.href}`);
  }

  return {
    html: isolatedRow?.isolated_html ?? null,
    cardURL: matchedCardURL(isolatedRow?.url),
  };
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
