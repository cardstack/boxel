import type { DBAdapter } from '@cardstack/runtime-common';
import { query } from '@cardstack/runtime-common';
import { indexURLCandidates, pageRowExpressions } from './index-url-utils.ts';

// Prerendered markup read for a page, with the card or file it was read from:
// the candidates a page URL expands to can name more than one card (`foo.json`
// and `foo/index.json`), and whatever governs the markup is that card's.
export interface RetrievedMarkup {
  html: string | null;
  // The card or file whose row the markup came from, as the URL it is read
  // by; null when no row held any.
  readURL: URL | null;
}

// A card's row is keyed by its `.json` source and the card is read without
// the extension; a file is read by its own URL, extension and all.
function matchedReadURL(
  row: { url?: string; type?: string } | undefined,
): URL | null {
  if (!row?.url) {
    return null;
  }
  return new URL(
    row.type === 'instance' ? row.url.replace(/\.json$/, '') : row.url,
  );
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
    return { html: null, readURL: null };
  }

  // The head HTML lives on prerendered_html; the boxel_index join scopes the
  // lookup to a live row serving the page (see `pageRowExpressions`) and
  // supplies the generation for logging.
  let rows = await query(dbAdapter, [
    `
      SELECT ph.head_html AS head_html, i.url AS url, i.type AS type, i.generation
      FROM boxel_index AS i
      JOIN prerendered_html AS ph
        ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type
      WHERE ph.head_html IS NOT NULL
       AND i.is_deleted IS NOT TRUE
       AND
    `,
    ...pageRowExpressions(cardURL, 'i'),
    `
      ORDER BY i.generation DESC
      LIMIT 1
    `,
  ]);

  log?.debug('Head query result for %s', cardURL.href, rows);

  let headRow = rows[0] as
    | {
        head_html?: string | null;
        url?: string;
        type?: string;
        generation?: string | number;
      }
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
    readURL: matchedReadURL(headRow),
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
    return { html: null, readURL: null };
  }

  // The isolated HTML lives on prerendered_html; the boxel_index join scopes
  // the lookup to a live row serving the page (see `pageRowExpressions`) and
  // supplies the generation for logging.
  let rows = await query(dbAdapter, [
    `
      SELECT ph.isolated_html AS isolated_html, i.url AS url, i.type AS type, i.generation
      FROM boxel_index AS i
      JOIN prerendered_html AS ph
        ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type
      WHERE ph.isolated_html IS NOT NULL
        AND i.is_deleted IS NOT TRUE
        AND
      `,
    ...pageRowExpressions(cardURL, 'i'),
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
        type?: string;
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
    readURL: matchedReadURL(isolatedRow),
  };
}

// Whether a page's card failed: its index row is an error, or its latest
// render is. Asked only when the page has no prerendered HTML, to tell a card
// that failed from one not rendered yet.
export async function pageRenderFailed({
  cardURL,
  dbAdapter,
}: {
  cardURL: URL;
  dbAdapter: DBAdapter;
}): Promise<boolean> {
  let rows = await query(dbAdapter, [
    `
      SELECT 1
      FROM boxel_index AS i
      LEFT JOIN prerendered_html AS ph
        ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type
      WHERE i.is_deleted IS NOT TRUE
        AND (
          i.has_error IS TRUE
          OR (ph.error_doc IS NOT NULL AND ph.generation >= i.generation)
        )
        AND
    `,
    ...pageRowExpressions(cardURL, 'i'),
    `
      LIMIT 1
    `,
  ]);
  return rows.length > 0;
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
