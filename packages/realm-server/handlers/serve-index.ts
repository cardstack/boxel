import type Koa from 'koa';
import { JSDOM } from 'jsdom';
import merge from 'lodash/merge';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import {
  hasExtension,
  logger,
  param,
  query,
  RealmPaths,
  sanitizeHeadHTMLToString,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  ensureSingleTitle,
  injectHeadHTML,
  injectIsolatedHTML,
  retrieveHeadHTML,
  retrieveIsolatedHTML,
} from '../lib/index-html-injection';
import { retrieveScopedCSS } from '../lib/retrieve-scoped-css';
import {
  findOrMountRealm,
  getPublishedRealmInfo,
  hasPublicPermissions,
  isIndexedCardInstance,
  type RealmRoutingDeps,
} from '../lib/realm-routing';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler';

export type ServeIndexDeps = {
  serverURL: URL;
  assetsURL: URL;
  realms: Realm[];
  reconciler: RealmRegistryReconciler;
  dbAdapter: DBAdapter;
  matrixClient: MatrixClient;
  getIndexHTML: () => Promise<string>;
  cardSizeLimitBytes: number;
  fileSizeLimitBytes: number;
};

export type ServeIndexHandlers = {
  serveIndex: (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;
  serveHostApp: (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;
  // Exposed for tests that exercise the index-HTML rewriting in
  // isolation. Same closure backs `serveIndex` / `serveHostApp` so the
  // production cache behaviour is preserved.
  retrieveIndexHTML: () => Promise<string>;
};

const log = logger('realm-server');
const headLog = logger('realm-server:head');
const isolatedLog = logger('realm-server:isolated');
const scopedCSSLog = logger('realm-server:scoped-css');

export function createServeIndex(deps: ServeIndexDeps): ServeIndexHandlers {
  let {
    serverURL,
    assetsURL,
    dbAdapter,
    matrixClient,
    getIndexHTML,
    cardSizeLimitBytes,
    fileSizeLimitBytes,
  } = deps;

  let routingDeps: RealmRoutingDeps = {
    realms: deps.realms,
    reconciler: deps.reconciler,
    dbAdapter: deps.dbAdapter,
  };

  // Production cache of the rewritten index.html plus a short hash used
  // for ETag invalidation. Dev mode (assetsURL.hostname === 'localhost')
  // bypasses the cache so shell changes are reflected immediately.
  let promiseForIndexHTML: Promise<string> | undefined;
  let indexHTMLHash: string | undefined;

  async function retrieveIndexHTML(): Promise<string> {
    let isDev = assetsURL.hostname === 'localhost';

    if (!isDev && promiseForIndexHTML) {
      return promiseForIndexHTML;
    }

    let rewriteRealmURL = (url?: string) => {
      if (!url) {
        return url;
      }

      let parsed = new URL(url);
      return new URL(
        `${parsed.pathname}${parsed.search}${parsed.hash}`,
        serverURL,
      ).href;
    };

    let work = (async () => {
      let indexHTML = (await getIndexHTML()).replace(
        // Closing matches both HTML5-style `">` and Vite's XHTML-style `" />`
        // so the rewrite runs against both production build and Vite dev HTML.
        /(<meta name="@cardstack\/host\/config\/environment" content=")([^"].*?)("\s*\/?>)/,
        (_match, g1, g2, g3) => {
          let config = JSON.parse(decodeURIComponent(g2));

          if (config.publishedRealmBoxelSpaceDomain === 'localhost:4201') {
            // if this is the default, this needs to be the realm server’s host
            // to work in Matrix tests, since publishedRealmBoxelSpaceDomain is currently
            // the default domain for publishing a realm
            config.publishedRealmBoxelSpaceDomain = serverURL.host;
          }

          if (config.publishedRealmBoxelSiteDomain === 'localhost:4201') {
            // if this is the default, this needs to be the realm server’s host
            // to work in Matrix tests, since publishedRealmBoxelSiteDomain is currently
            // the default domain for publishing a realm
            config.publishedRealmBoxelSiteDomain = serverURL.host;
          }

          config = merge({}, config, {
            hostsOwnAssets: false,
            assetsURL: assetsURL.href,
            matrixURL: matrixClient.matrixURL.href.replace(/\/$/, ''),
            matrixServerName:
              process.env.MATRIX_SERVER_NAME || matrixClient.matrixURL.hostname,
            realmServerURL: serverURL.href,
            resolvedBaseRealmURL: rewriteRealmURL(config.resolvedBaseRealmURL),
            resolvedCatalogRealmURL: rewriteRealmURL(
              config.resolvedCatalogRealmURL,
            ),
            resolvedSkillsRealmURL: rewriteRealmURL(
              config.resolvedSkillsRealmURL,
            ),
            resolvedOpenRouterRealmURL: rewriteRealmURL(
              config.resolvedOpenRouterRealmURL,
            ),
            defaultSystemCardId: rewriteRealmURL(config.defaultSystemCardId),
            defaultFieldSpecId: rewriteRealmURL(config.defaultFieldSpecId),
            cardSizeLimitBytes,
            fileSizeLimitBytes,
            publishedRealmDomainOverrides:
              process.env.PUBLISHED_REALM_DOMAIN_OVERRIDES ??
              config.publishedRealmDomainOverrides,
          });
          return `${g1}${encodeURIComponent(JSON.stringify(config))}${g3}`;
        },
      );

      indexHTML = indexHTML.replace(/(src|href)="\//g, `$1="${assetsURL.href}`);

      // Strip any static favicon/apple-touch-icon links from the base HTML
      // since these are now dynamically injected between the head markers
      indexHTML = indexHTML
        .replace(/<link[^>]*\brel="icon"[^>]*\/?>/gi, '')
        .replace(/<link[^>]*\brel="apple-touch-icon"[^>]*\/?>/gi, '');

      // Recompute the hash in dev mode (where index.html is not cached) so
      // that changes to the shell are reflected in the ETag.
      if (!indexHTMLHash || isDev) {
        let { createHash } = await import('crypto');
        indexHTMLHash = createHash('md5')
          .update(indexHTML)
          .digest('hex')
          .slice(0, 8);
      }

      return indexHTML;
    })();

    if (!isDev) {
      promiseForIndexHTML = work;
      // If the work rejects, clear the cache so the next request retries
      // instead of awaiting a permanently-rejected (or pending) promise.
      work.catch(() => {
        promiseForIndexHTML = undefined;
      });
    }

    return work;
  }

  function defaultIconLinks(): string[] {
    let faviconURL = new URL('boxel-favicon.png', assetsURL).href;
    let webclipURL = new URL('boxel-webclip.png', assetsURL).href;
    return [
      `<link href="${faviconURL}" rel="icon" />`,
      `<link href="${webclipURL}" rel="apple-touch-icon" />`,
    ];
  }

  let serveIndex = async (ctxt: Koa.Context, next: Koa.Next) => {
    let acceptHeader = ctxt.header.accept ?? '';
    let lowerAcceptHeader = acceptHeader.toLowerCase();
    let includesVndMimeType = lowerAcceptHeader.includes('application/vnd.');
    let includesHtmlMimeType = lowerAcceptHeader.includes('text/html');

    let requestURL = new URL(
      `${ctxt.protocol}://${ctxt.host}${ctxt.originalUrl}`,
    );

    // Track published realm info from routing checks to avoid redundant
    // DB queries in the ETag logic below.
    let publishedRealmInfo: { lastPublishedAt: string | null } | null = null;
    let publishedRealmInfoFetched = false;

    if (includesHtmlMimeType) {
      if (includesVndMimeType) {
        publishedRealmInfo = await getPublishedRealmInfo(
          requestURL,
          routingDeps,
        );
        publishedRealmInfoFetched = true;

        if (publishedRealmInfo) {
          return next();
        }
      }
    } else {
      if (includesVndMimeType) {
        return next();
      }

      if (hasExtension(requestURL.pathname)) {
        return next();
      }

      publishedRealmInfo = await getPublishedRealmInfo(requestURL, routingDeps);
      publishedRealmInfoFetched = true;

      if (!publishedRealmInfo) {
        return next();
      }

      // For published realms with generic Accept headers (like */*), we need to
      // distinguish card URLs from module URLs. Module imports (e.g., "./person")
      // resolve to URLs without extensions and would incorrectly get HTML served.
      // Only serve HTML if:
      // 1. This is a directory index request (path ends with /), OR
      // 2. The URL corresponds to an indexed card instance
      let isIndexRequest = requestURL.pathname.endsWith('/');
      if (!isIndexRequest) {
        let cardURL = requestURL;
        let isCardInstance = await isIndexedCardInstance(cardURL, routingDeps);
        if (!isCardInstance) {
          return next();
        }
      }
    }

    // If this is a /connect iframe request, is the origin a valid published realm?
    let connectMatch = ctxt.request.path.match(/\/connect\/(.+)$/);

    if (connectMatch) {
      try {
        let originParameter = new URL(decodeURIComponent(connectMatch[1])).href;

        let publishedRealms = await query(dbAdapter, [
          `SELECT url FROM realm_registry WHERE kind = 'published' AND url LIKE `,
          param(`${originParameter}%`),
        ]);

        if (publishedRealms.length === 0) {
          ctxt.status = 404;
          ctxt.body = `Not Found: No published realm found for origin ${originParameter}`;

          log.debug(
            `Ignoring /connect request for origin ${originParameter}: no matching published realm`,
          );

          return;
        }

        ctxt.set(
          'Content-Security-Policy',
          `frame-ancestors ${originParameter}`,
        );
      } catch (error) {
        ctxt.status = 400;
        ctxt.body = 'Bad Request';

        log.info(`Error processing /connect request: ${error}`);

        return;
      }
    }

    ctxt.type = 'html';

    let cardURL = requestURL;
    let isIndexRequest = requestURL.pathname.endsWith('/');
    if (isIndexRequest) {
      cardURL = new URL('index', requestURL);
    }

    // Retrieve index HTML early so the shell hash is available for ETag.
    // This is memoized in production, so it's cheap after the first call.
    let indexHTML = await retrieveIndexHTML();

    // For published realms, support HTTP caching via ETag.
    // The ETag includes both last_published_at and a hash of the host app
    // shell, so a deploy that changes index.html invalidates cached responses.
    if (!publishedRealmInfoFetched) {
      publishedRealmInfo = await getPublishedRealmInfo(requestURL, routingDeps);
    }
    let lastPublishedAt = publishedRealmInfo?.lastPublishedAt;
    let etag =
      lastPublishedAt && indexHTMLHash
        ? `"${lastPublishedAt}-${indexHTMLHash}"`
        : null;

    if (etag) {
      let ifNoneMatch = ctxt.get('If-None-Match');
      if (
        ifNoneMatch === '*' ||
        ifNoneMatch
          .split(',')
          .some((t) => t.trim().replace(/^W\//, '') === etag)
      ) {
        ctxt.status = 304;
        ctxt.set('ETag', etag);
        ctxt.set('Cache-Control', 'public, max-age=0, must-revalidate');
        ctxt.vary('Accept');
        return;
      }
    }
    let publicPermissions = await hasPublicPermissions(cardURL, routingDeps);

    if (!publicPermissions) {
      ctxt.body = injectHeadHTML(
        indexHTML,
        `<title>Boxel</title>\n${defaultIconLinks().join('\n')}`,
      );
      return;
    }

    // CS-10055: host routing rules in the realm config can map a bare path
    // (e.g. /whitepaper) to a target card. When the requested path matches
    // a rule, rewrite cardURL so the head/isolated/scoped CSS fetched
    // below render the routed target. The same map is also written into
    // the @cardstack/host/config/environment meta tag further down so the
    // SPA can resolve the path post-hydration.
    let routingMap: { path: string; id: string }[] = [];
    let routedRealm = await findOrMountRealm(requestURL, routingDeps);
    if (routedRealm) {
      routingMap = await routedRealm.getHostRoutingMap();
      if (routingMap.length > 0) {
        let realmURL = new URL(routedRealm.url);
        realmURL.protocol = requestURL.protocol;
        let realmPaths = new RealmPaths(realmURL);
        let pathInRealm = '/' + realmPaths.local(requestURL);
        let rule = routingMap.find((r) => r.path === pathInRealm);
        if (rule) {
          cardURL = new URL(rule.id);
        }
      }
    }

    headLog.debug(`Fetching head HTML for ${cardURL.href}`);
    isolatedLog.debug(`Fetching isolated HTML for ${cardURL.href}`);
    scopedCSSLog.debug(`Fetching scoped CSS for ${cardURL.href}`);

    let [headHTML, isolatedHTML, scopedCSS] = await Promise.all([
      retrieveHeadHTML({
        cardURL,
        dbAdapter,
        log: headLog,
      }),
      retrieveIsolatedHTML({
        cardURL,
        dbAdapter,
        log: isolatedLog,
      }),
      retrieveScopedCSS({
        cardURL,
        dbAdapter,
        log: scopedCSSLog,
      }),
    ]);

    let doc = new JSDOM().window.document;
    if (headHTML != null) {
      let sanitized = sanitizeHeadHTMLToString(headHTML, doc);
      if (sanitized !== null) {
        headHTML = sanitized;
      } else {
        headHTML = null;
      }
    }

    if (headHTML != null) {
      headLog.debug(
        `Injecting head HTML for ${cardURL.href} (length ${headHTML.length})\n${truncateLogLines(
          headHTML,
        )}`,
      );
    } else {
      headLog.debug(
        `No head HTML found for ${cardURL.href}, serving base index.html`,
      );
    }

    if (scopedCSS != null) {
      scopedCSSLog.debug(
        `Using scoped CSS for ${cardURL.href} (length ${scopedCSS.length})`,
      );
    } else {
      scopedCSSLog.debug(
        `No scoped CSS returned from database for ${cardURL.href}`,
      );
    }

    let responseHTML = indexHTML;
    let headFragments: string[] = [];

    if (headHTML != null) {
      headFragments.push(ensureSingleTitle(headHTML));
    } else {
      headFragments.push('<title>Boxel</title>');
    }

    if (scopedCSS != null) {
      scopedCSSLog.debug(`Injecting scoped CSS for ${cardURL.href}`);
      headFragments.push(
        `<style data-boxel-scoped-css>\n${scopedCSS}\n</style>`,
      );
    }

    let hasFavicon = false;
    let hasAppleTouchIcon = false;
    if (headHTML != null) {
      let fragment = doc.createRange().createContextualFragment(headHTML);
      hasFavicon = fragment.querySelector('link[rel~="icon"]') != null;
      hasAppleTouchIcon =
        fragment.querySelector('link[rel~="apple-touch-icon"]') != null;
    }
    let faviconURL = new URL('boxel-favicon.png', assetsURL).href;
    let webclipURL = new URL('boxel-webclip.png', assetsURL).href;
    if (!hasFavicon) {
      headFragments.push(`<link href="${faviconURL}" rel="icon" />`);
    }
    if (!hasAppleTouchIcon) {
      headFragments.push(
        `<link href="${webclipURL}" rel="apple-touch-icon" />`,
      );
    }

    if (headFragments.length > 0) {
      responseHTML = injectHeadHTML(responseHTML, headFragments.join('\n'));
    }

    if (routingMap.length > 0 && routedRealm) {
      // Rules are stored realm-relative ('/whitepaper'). The client sees URL
      // paths that include the realm's mount segment ('/routing/whitepaper'
      // when the realm is mounted at '/routing/' on the published host). For
      // the SPA's path lookup to be a direct equality match, prefix each
      // rule path with the realm's pathname before serializing.
      let realmPathname = new URL(routedRealm.url).pathname;
      let hostScopedMap = routingMap.map((rule) => ({
        path: realmPathname + rule.path.replace(/^\//, ''),
        id: rule.id,
      }));
      // Per-request merge into the already-rewritten config meta tag.
      // The retrieveIndexHTML rewrite is cached process-wide because the
      // fields it touches are global; the routing map is per-realm so it
      // can't share that cache. This second regex pass parses the URL-
      // encoded JSON, sets hostRoutingMap, and re-encodes — keeping the
      // routing data on the same typed channel the host already reads
      // for hostsOwnAssets / realmServerURL / matrixURL etc., rather
      // than via a separate `window.__hostRoutingMap` global.
      responseHTML = responseHTML.replace(
        /(<meta name="@cardstack\/host\/config\/environment" content=")([^"]+)("\s*\/?>)/,
        (_match, g1, g2, g3) => {
          let cfg = JSON.parse(decodeURIComponent(g2));
          cfg.hostRoutingMap = hostScopedMap;
          return `${g1}${encodeURIComponent(JSON.stringify(cfg))}${g3}`;
        },
      );
    }

    if (isolatedHTML != null) {
      isolatedLog.debug(
        `Injecting isolated HTML for ${cardURL.href} (length ${isolatedHTML.length})\n${truncateLogLines(
          isolatedHTML,
        )}`,
      );
      responseHTML = injectIsolatedHTML(responseHTML, isolatedHTML);
    }

    if (etag) {
      ctxt.set('ETag', etag);
      ctxt.set('Cache-Control', 'public, max-age=0, must-revalidate');
      ctxt.vary('Accept');
    }

    ctxt.body = responseHTML;
    return;
  };

  let serveHostApp = async (ctxt: Koa.Context, next: Koa.Next) => {
    let acceptHeader = (ctxt.header.accept ?? '').toLowerCase();
    let isHead = ctxt.method === 'HEAD';
    if (!isHead && !acceptHeader.includes('text/html')) {
      return next();
    }

    ctxt.type = 'html';
    ctxt.body = injectHeadHTML(
      await retrieveIndexHTML(),
      `<title>Boxel</title>\n${defaultIconLinks().join('\n')}`,
    );
  };

  return { serveIndex, serveHostApp, retrieveIndexHTML };
}

function truncateLogLines(value: string, maxLines = 3): string {
  let lines = value.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return value;
  }
  let truncated = lines.slice(0, maxLines);
  truncated[maxLines - 1] = `${truncated[maxLines - 1]} ...`;
  return truncated.join('\n');
}
