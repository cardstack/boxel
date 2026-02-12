import type { DBAdapter } from '@cardstack/runtime-common';
import { query } from '@cardstack/runtime-common';
import {
  indexURLCandidates,
  indexCandidateExpressions,
} from './index-url-utils';

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

  let rows = await query(dbAdapter, [
    `
      SELECT head_html, realm_version
      FROM boxel_index
      WHERE type = 'instance'
       AND head_html IS NOT NULL
       AND is_deleted IS NOT TRUE
       AND
    `,
    ...indexCandidateExpressions(candidates),
    `
      ORDER BY realm_version DESC
      LIMIT 1
    `,
  ]);

  log?.debug('Head query result for %s', cardURL.href, rows);

  let headRow = rows[0] as
    | { head_html?: string | null; realm_version?: string | number }
    | undefined;

  if (headRow?.head_html != null) {
    log?.debug(
      `Using head HTML from realm version ${headRow.realm_version} for ${cardURL.href}`,
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

  let rows = await query(dbAdapter, [
    `
      SELECT isolated_html, realm_version
      FROM boxel_index
      WHERE isolated_html IS NOT NULL
        AND type = 'instance'
        AND is_deleted IS NOT TRUE
        AND
      `,
    ...indexCandidateExpressions(candidates),
    `
      ORDER BY realm_version DESC
      LIMIT 1
    `,
  ]);

  log?.debug('Isolated query result for %s', cardURL.href, rows);

  let isolatedRow = rows[0] as
    | { isolated_html?: string | null; realm_version?: string | number }
    | undefined;

  if (isolatedRow?.isolated_html != null) {
    log?.debug(
      `Using isolated HTML from realm version ${isolatedRow.realm_version} for ${cardURL.href}`,
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
    /(<div[^>]+id="boxel-root"[^>]*>)([\s\S]*?)(<\/div>)/,
    (_match, open, _content, close) => `${open}${isolatedHTML}${close}

        <script>
        // jortle!!
      if (window?.location?.search?.includes('debugger=true')) {
        debugger;
      }
    </script>
    `,
  );
}

export function injectRenderModeScript(indexHTML: string): string {
  let script = `
    <script>
      globalThis.__boxelRenderMode = 'rehydrate';
    </script>`;
  let updated = indexHTML.replace(
    /(<meta[^>]+data-boxel-head-end[^>]*>)/,
    `$1\n${script}`,
  );
  if (updated === indexHTML) {
    return indexHTML.replace(/<\/head>/i, `${script}\n</head>`);
  }
  return updated;
}

// Extract base64-encoded shoebox data from isolatedHTML (appended by render-runner)
// Returns the clean HTML and the decoded shoebox JSON string (if present).
export function extractShoeboxFromIsolatedHTML(isolatedHTML: string): {
  html: string;
  shoeboxJSON: string | null;
} {
  let match = isolatedHTML.match(/<!--boxel-shoebox:([A-Za-z0-9+/=]+)-->$/);
  if (match) {
    let html = isolatedHTML.slice(0, match.index);
    let shoeboxJSON = Buffer.from(match[1], 'base64').toString('utf-8');
    return { html, shoeboxJSON };
  }
  return { html: isolatedHTML, shoeboxJSON: null };
}

// Inject a shoebox script that overrides fetch to serve cached card data.
// This must run before the Ember app boots so card requests resolve instantly.
export function injectShoeboxScript(
  indexHTML: string,
  shoeboxJSON: string,
): string {
  // Escape </script> sequences in JSON to prevent premature tag closing
  let safeJSON = shoeboxJSON.replace(/<\/(script)/gi, '<\\/$1');
  let script = `
    <script id="boxel-shoebox">
      (function() {
        var shoeboxData = ${safeJSON};
        globalThis.__boxelShoeboxData = shoeboxData;
        var originalFetch = globalThis.fetch;
        globalThis.fetch = function() {
          try {
            var firstArg = arguments[0];
            var options = arguments[1] || {};
            var url;
            if (typeof firstArg === 'string') {
              url = firstArg;
            } else if (firstArg instanceof Request) {
              url = firstArg.url;
            } else if (firstArg instanceof URL) {
              url = firstArg.href;
            }
            if (url && shoeboxData) {
              // Check for individual card data
              var cardUrl = url.replace(/\\.json$/, '');
              var entry = shoeboxData[cardUrl] || shoeboxData[url];
              if (!entry) {
                var indexUrl = cardUrl.replace(/\\/$/, '') + '/index';
                entry = shoeboxData[indexUrl];
              }
              if (entry) {
                return Promise.resolve(new Response(JSON.stringify(entry), {
                  status: 200,
                  headers: { 'Content-Type': 'application/vnd.card+source' }
                }));
              }
              // Check for cached search/collection responses
              // Read method from Request object (when VirtualNetwork passes Request) or from options
              var method = (firstArg instanceof Request ? firstArg.method : ((options.method || 'GET') + '')).toUpperCase();
              var body = typeof options.body === 'string' ? options.body : '';
              var searchKey = '__search:' + method + ':' + url + ':' + body;
              if (shoeboxData[searchKey]) {
                return Promise.resolve(new Response(JSON.stringify(shoeboxData[searchKey]), {
                  status: 200,
                  headers: { 'Content-Type': 'application/vnd.card+json' }
                }));
              }
            }
          } catch(e) {
            // Fall through to original fetch on any error
          }
          return originalFetch.apply(globalThis, arguments);
        };
      })();
    </script>`;
  // Inject after the render mode script (after data-boxel-head-end marker)
  let updated = indexHTML.replace(
    /(<meta[^>]+data-boxel-head-end[^>]*>)/,
    `$1\n${script}`,
  );
  if (updated === indexHTML) {
    return indexHTML.replace(/<\/head>/i, `${script}\n</head>`);
  }
  return updated;
}

export function ensureSingleTitle(headHTML: string): string {
  if (/<title[\s>]/.test(headHTML)) {
    return headHTML;
  }
  return `<title>Boxel</title>\n${headHTML}`;
}
