import { createHash } from 'crypto';
import type Koa from 'koa';
import { JSDOM } from 'jsdom';
import { merge } from 'lodash-es';
import type {
  DBAdapter,
  PrerenderedHtmlFormat,
  Realm,
  SiteSettings,
} from '@cardstack/runtime-common';
import {
  CAPTURE_SERVING_PREFIXES,
  PRERENDERED_HTML_FORMATS,
  PREFIX_REALMS,
  RealmPaths,
  SCOPED_CSS_SERVING_PREFIX,
  foreignQueryParams,
  hasExtension,
  isCaptureServingPath,
  isHashedScopedCSSRequest,
  isLiteralRedirect,
  logger,
  normalizeRoutingPath,
  param,
  query,
  sanitizeHeadHTMLToString,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  ensureSingleTitle,
  injectHeadHTML,
  injectIsolatedHTML,
  retrieveHeadHTML,
  pageRenderFailed,
  retrieveIsolatedHTML,
} from '../lib/index-html-injection.ts';
import { retrieveScopedCSS } from '../lib/retrieve-scoped-css.ts';
import { fullRequestURL } from '../middleware/index.ts';
import {
  findOrMountRealm,
  getPublishedRealmInfo,
  hasPublicPermissions,
  anonymousCardDoc,
  anonymousMayRead,
  isIndexedCardInstance,
  type RealmRoutingDeps,
} from '../lib/realm-routing.ts';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler.ts';
import {
  resolveSiteRequest,
  siteHomeCard,
  siteGenerations,
  siteMounts,
  sitePathOf,
  sitePathsForCards,
} from '../lib/host-routes.ts';
import { cardKey, linkedCards, siteRewriter } from '../lib/site-rewrite.ts';
import { framePage } from '../lib/site-frame.ts';
import { SITE_FILES, siteFile, type SiteFileName } from '../lib/site-files.ts';
import type {
  HostRouteShare,
  HostRouteSnapshot,
  SiteAnswer,
} from '@cardstack/runtime-common';

// The prerendered formats the host-mode page for the card or file at `readURL`
// serves data-only, asked of the realm holding it: the one the request was
// routed to where it holds it, and otherwise the one a routing rule pointed
// into. A card no realm holds is served no markup at all, since nothing can say
// which of its formats its type withholds.

// The frame card a site shows its pages inside, as prerendered: its isolated
// HTML and scoped CSS. None when the page being served is the frame itself,
// when the frame has no prerendered HTML yet, or when it is another realm's
// card and the site doesn't opt in to serving those (ADR 021 §1.6).
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

async function siteFrameMarkup(
  frameURL: URL,
  pageURL: URL,
  routedRealm: Realm,
  serveSourcePrerender: boolean,
  dbAdapter: DBAdapter,
): Promise<{ url: URL; html: string; scopedCSS: string | null } | undefined> {
  let key = (url: URL) => url.href.replace(/\.json$/, '');
  if (key(frameURL) === key(pageURL)) {
    return undefined;
  }
  let holds = new RealmPaths(new URL(routedRealm.url)).inRealm(frameURL);
  if (!holds && !serveSourcePrerender) {
    return undefined;
  }
  let [markup, scopedCSS] = await Promise.all([
    retrieveIsolatedHTML({ cardURL: frameURL, dbAdapter, log: isolatedLog }),
    retrieveScopedCSS({ cardURL: frameURL, dbAdapter, log: scopedCSSLog }),
  ]);
  if (markup.html == null) {
    return undefined;
  }
  return { url: frameURL, html: markup.html, scopedCSS };
}

// Whether a realm routes paths of its own: page types, or fixed pages from
// realm.json's routing rules. Such a realm's pages are rewritten to the
// addresses it serves, and carry a snapshot of them for the host app.
function routesPaths(settings: SiteSettings): boolean {
  return Boolean(settings.pageTypes.length || settings.fixedPages.length);
}

async function unshareableFormatsForPage(
  readURL: URL,
  routedRealm: Realm | undefined,
  routingDeps: RealmRoutingDeps,
): Promise<PrerenderedHtmlFormat[]> {
  let holds = (realm: Realm) => {
    let realmURL = new URL(realm.url);
    realmURL.protocol = readURL.protocol;
    return new RealmPaths(realmURL).inRealm(readURL);
  };
  let realm =
    routedRealm && holds(routedRealm)
      ? routedRealm
      : await findOrMountRealm(readURL, routingDeps);
  if (!realm) {
    return [...PRERENDERED_HTML_FORMATS];
  }
  // The request may arrive under a different protocol than the realm is
  // mounted with, and the declaration is resolved against the realm's own
  // spelling of the URL.
  let url = new URL(readURL);
  url.protocol = new URL(realm.url).protocol;
  return await realm.unshareableFormatsFor(url);
}

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
  audioSizeLimitBytes: number;
  videoSizeLimitBytes: number;
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

// An <object>/<embed> load advertises text/html in its Accept header (the
// browser issues it as a frame-style navigation), but it is always embedding
// a document, never the app — answering with the shell boots the host app
// recursively inside the preview. Sec-Fetch-Dest is the only place these
// loads are distinguishable from an address-bar navigation (which carries
// `document` and must keep opening the app); browsers stamp it on requests
// to trustworthy origins (HTTPS and localhost). The distinction has to be
// drawn here on the server: service workers are spec-required to pass
// <object>/<embed> loads straight to the network without a fetch event, so
// no client-side layer ever sees these requests.
function isDocumentEmbedRequest(ctxt: Koa.Context): boolean {
  let destination = ctxt.header['sec-fetch-dest'];
  return destination === 'embed' || destination === 'object';
}

// A capture URL — `{realm}_capture/…`, or the legacy `{realm}_screenshot/…`
// a stored URL may still carry — names bytes the realm serves (a
// PNG or a PDF), never a card the app could open. A tab navigation to one (a
// "Download PDF" link opened in a new tab) advertises text/html like any
// navigation, and the shell would boot the app against a URL that is not a
// card; the realm's own route serves the capture whatever the request
// accepts. GET only, matching the realm's dispatch: it serves captures on GET
// alone, so any other method falls through to the ordinary negotiation.
//
// The realm reserves `_capture/` only at its root (`isCaptureServingPath`
// on the realm-local path), so a nested `folder/_capture/card` is an
// ordinary card path that must keep opening the app. The path-segment test
// is a cheap pre-filter; the realm lookup that decides runs only for URLs
// that pass it.
async function isCaptureServingRequest(
  ctxt: Koa.Context,
  requestURL: URL,
  routingDeps: RealmRoutingDeps,
): Promise<boolean> {
  if (
    ctxt.method !== 'GET' ||
    !CAPTURE_SERVING_PREFIXES.some((prefix) =>
      requestURL.pathname.includes(`/${prefix}`),
    )
  ) {
    return false;
  }
  let realm = await findOrMountRealm(requestURL, routingDeps);
  if (!realm) {
    return false;
  }
  // Match on the request's protocol, as findOrMountRealm does: a realm
  // registered as https is still this request's realm behind a
  // TLS-terminating proxy that hands the server http.
  let realmURL = new URL(realm.url);
  realmURL.protocol = requestURL.protocol;
  let paths = new RealmPaths(realmURL);
  return (
    paths.inRealm(requestURL) && isCaptureServingPath(paths.local(requestURL))
  );
}

// A hashed scoped-CSS URL — `{realm}_scoped-css/<file>.md5-<hash>.glimmer-scoped.css`
// — names a stylesheet module the realm serves, never a card the app could
// open, so the shell has nothing to boot against it and the realm's route
// answers whatever the request accepts. Falling through matters beyond that
// tidiness: the realm serves this body with a year-long `immutable`
// `Cache-Control` and no `Vary: Accept`, which is only sound while the URL
// yields one body for every `Accept`. Were the shell to answer a `text/html`
// request for one of these, the same URL would have two bodies and a browser
// cache — which stores one variant per URL — could hold either for a year.
//
// The gate mirrors the realm's own dispatch: GET only, and the `_scoped-css/`
// prefix as well as the hashed filename shape, so a realm file whose name
// merely looks hashed keeps opening the app.
async function isScopedCSSServingRequest(
  ctxt: Koa.Context,
  requestURL: URL,
  routingDeps: RealmRoutingDeps,
): Promise<boolean> {
  if (
    ctxt.method !== 'GET' ||
    !requestURL.pathname.includes(`/${SCOPED_CSS_SERVING_PREFIX}`)
  ) {
    return false;
  }
  let realm = await findOrMountRealm(requestURL, routingDeps);
  if (!realm) {
    return false;
  }
  let realmURL = new URL(realm.url);
  realmURL.protocol = requestURL.protocol;
  let paths = new RealmPaths(realmURL);
  if (!paths.inRealm(requestURL)) {
    return false;
  }
  let localPath = paths.local(requestURL);
  return (
    localPath.startsWith(SCOPED_CSS_SERVING_PREFIX) &&
    isHashedScopedCSSRequest(localPath)
  );
}

export function createServeIndex(deps: ServeIndexDeps): ServeIndexHandlers {
  let {
    serverURL,
    assetsURL,
    dbAdapter,
    matrixClient,
    getIndexHTML,
    cardSizeLimitBytes,
    fileSizeLimitBytes,
    audioSizeLimitBytes,
    videoSizeLimitBytes,
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
            // Stamp the deployed environment the host is running in so client
            // telemetry (and anything else) can report it, rather than the
            // Ember build mode. Falls back to whatever the build baked in when
            // this server has no REALM_SENTRY_ENVIRONMENT (e.g. local dev).
            hostedEnvironment:
              process.env.REALM_SENTRY_ENVIRONMENT ||
              config.hostedEnvironment ||
              'local',
            // Both views of every prefix realm, rewritten from the one
            // declaration: the realm-list property each realm is named by, and
            // the served-at map the host registers its prefixes from. Hand
            // listing these is how a realm gets added to the declaration and
            // missed here — which ships worse than an absent prefix, because
            // the host keeps the build-time URL while the realm-server serves
            // that realm somewhere else. `merge` ignores undefined sources, so
            // a realm absent from the served config stays absent.
            ...Object.fromEntries(
              PREFIX_REALMS.map(({ hostConfigKey }) => [
                hostConfigKey,
                rewriteRealmURL(
                  (config as Record<string, string | undefined>)[hostConfigKey],
                ),
              ]),
            ),
            prefixRealmURLs: Object.fromEntries(
              Object.entries(
                (config.prefixRealmURLs ?? {}) as Record<string, string>,
              ).map(([prefix, servedAt]) => [
                prefix,
                rewriteRealmURL(servedAt),
              ]),
            ),
            cardSizeLimitBytes,
            fileSizeLimitBytes,
            audioSizeLimitBytes,
            videoSizeLimitBytes,
            publishedRealmDomainOverrides:
              process.env.PUBLISHED_REALM_DOMAIN_OVERRIDES ??
              config.publishedRealmDomainOverrides,
            // Read here, per deployment, so turning sign-in on the secure
            // origin on or off needs no host rebuild. Outside development the
            // page is built once per process, so a changed value takes effect
            // when the realm server next starts.
            signInOnSecureOrigin:
              process.env.SIGN_IN_ON_SECURE_ORIGIN === undefined
                ? Boolean(config.signInOnSecureOrigin)
                : process.env.SIGN_IN_ON_SECURE_ORIGIN === 'true',
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
    // Derive the request URL via fullRequestURL so the protocol honors
    // `x-forwarded-proto` from a TLS-terminating proxy (ALB/Traefik), matching
    // the rest of the request pipeline. Building it from the raw `ctxt.protocol`
    // yields `http` behind such a proxy, which makes the published-realm module
    // probe (isIndexedCardInstance → hasExtensionlessSourceModule) throw on the
    // http-vs-https mismatch and mis-serve a module URL as the HTML page.
    let requestURL = fullRequestURL(ctxt);

    // A site's sitemap.xml, robots.txt and llms.txt, at its root, written
    // from its settings.
    let fileName = requestURL.pathname.split('/').pop() as SiteFileName;
    if (ctxt.method === 'GET' && SITE_FILES.includes(fileName)) {
      let realm = await findOrMountRealm(requestURL, routingDeps);
      if (
        realm &&
        requestURL.pathname ===
          `${siteMounts(realm, requestURL).mount.pathname}${fileName}` &&
        (await hasPublicPermissions(realm, routingDeps))
      ) {
        let file = await siteFile(
          fileName,
          realm,
          siteMounts(realm, requestURL).mount,
          requestURL.searchParams,
          routingDeps,
        );
        if (file) {
          ctxt.type = file.contentType;
          ctxt.set('Cache-Control', 'public, max-age=300');
          ctxt.body = file.body;
          return;
        }
      }
      return next();
    }

    // What the routing realm's site answers at the request's path, asked once
    // and only when needed.
    let siteAnswerPromise:
      | Promise<(SiteAnswer & { share?: HostRouteShare }) | undefined>
      | undefined;
    let siteAnswer = () =>
      (siteAnswerPromise ??= (async () => {
        let realm = await findOrMountRealm(requestURL, routingDeps);
        return realm
          ? resolveSiteRequest(realm, requestURL, routingDeps, ctxt.req.headers)
          : undefined;
      })());
    // Whether the path is a fixed page another realm holds. Such a page can
    // change, or stop being served, without this realm changing, so its
    // response carries no ETag a cache could revalidate against.
    let servesCrossRealm = async () => {
      let answer = await siteAnswer();
      return answer?.kind === 'fixed' && Boolean(answer.crossRealm);
    };

    if (
      isDocumentEmbedRequest(ctxt) ||
      (await isCaptureServingRequest(ctxt, requestURL, routingDeps)) ||
      (await isScopedCSSServingRequest(ctxt, requestURL, routingDeps))
    ) {
      // Fall through to the realm, which serves the file's (capture's, or
      // stylesheet's) own bytes and lets its content type decide what the
      // browser renders.
      return next();
    }
    let acceptHeader = ctxt.header.accept ?? '';
    let lowerAcceptHeader = acceptHeader.toLowerCase();
    let includesVndMimeType = lowerAcceptHeader.includes('application/vnd.');
    let includesHtmlMimeType = lowerAcceptHeader.includes('text/html');

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
          // A bare routed sub-path (e.g. /pricing) is not itself an indexed
          // card instance — its host routing rule maps it to a card that
          // lives elsewhere (e.g. /pages/pricing). Only fall through to the
          // module resolver (→ 404) when the path also matches no routing
          // rule. Without this, the bare form 404s while the trailing-slash
          // form — which skips this gate via isIndexRequest — renders.
          //
          // The rule match is additionally gated on public read: consulting
          // the routing map for a non-public realm would leak which bare
          // paths are configured routes via the 200-vs-404 difference (a real
          // route falls through to the generic 200 shell, a non-route 404s).
          // Requiring public read makes routed and non-routed bare paths
          // behave identically (both next() → 404) on a non-public realm.
          // A path the realm's site answers counts as routed too.
          let matchedRealm =
            (await siteAnswer())?.kind !== 'none'
              ? await findOrMountRealm(requestURL, routingDeps)
              : undefined;
          if (
            !matchedRealm ||
            !(await hasPublicPermissions(matchedRealm, routingDeps))
          ) {
            return next();
          }
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

    // Permit the JS Self-Profiling API so client-telemetry's Tier-2 wedge
    // stack sampling can run. Harmless for documents that never construct a
    // Profiler, and ignored by browsers that don't support the policy.
    ctxt.set('Document-Policy', 'js-profiling');

    // Resolve the realm once and reuse it for the permissions check and the
    // routing-map lookup below. `findOrMountRealm` can fall back to a DB probe
    // when the in-memory registry is cold, so we don't want to pay that cost
    // more than necessary on the hot HTML path.
    let routedRealm = await findOrMountRealm(requestURL, routingDeps);

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
    // A site's pages are revalidated further down, once the markup they are
    // built from has been read (see siteETag). Another page routed into
    // another realm can change without this realm knowing, so it gets none.
    let isSitePage = Boolean(
      routedRealm && (await routedRealm.getSiteSettings()).pageTypes.length,
    );
    let etag: string | null = null;
    if (
      lastPublishedAt &&
      indexHTMLHash &&
      !isSitePage &&
      !(await servesCrossRealm())
    ) {
      etag = `"${lastPublishedAt}-${indexHTMLHash}"`;
    }
    let notModified = (tag: string) => {
      let ifNoneMatch = ctxt.get('If-None-Match');
      if (
        ifNoneMatch !== '*' &&
        !ifNoneMatch
          .split(',')
          .some((t) => t.trim().replace(/^W\//, '') === tag)
      ) {
        return false;
      }
      ctxt.status = 304;
      ctxt.set('ETag', tag);
      ctxt.set('Cache-Control', 'public, max-age=0, must-revalidate');
      ctxt.vary('Accept');
      // The shell is withheld from document embeds (see
      // isDocumentEmbedRequest), so a cached copy must not satisfy them.
      ctxt.vary('Sec-Fetch-Dest');
      return true;
    };

    if (etag && notModified(etag)) {
      return;
    }
    let publicPermissions = await hasPublicPermissions(
      routedRealm,
      routingDeps,
    );

    if (!publicPermissions) {
      ctxt.body = injectHeadHTML(
        indexHTML,
        `<title>Boxel</title>\n${defaultIconLinks().join('\n')}`,
      );
      return;
    }

    // Then what the realm's site answers, in its precedence order
    // (runtime-common's resolveSitePath): redirects, fixed pages (realm.json's
    // routing rules, CS-10055), listings and pages from the page types' path
    // templates. A path it doesn't answer is a card's own address, or
    // nothing. This runs after the public-permission gate above, so a
    // non-public realm never discloses which of its paths are routed.
    let servedShare: HostRouteShare | undefined;
    // Set when the site answers the path with its not-found card. Koa's own
    // status reads 404 until a body is set, so it can't say this.
    let servedNotFound = false;
    if (routedRealm) {
      let answer = await siteAnswer();
      let mount = siteMounts(routedRealm, requestURL).mount.pathname.replace(
        /\/$/,
        '',
      );
      if (answer?.kind === 'redirect') {
        let target = new URL(
          answer.to.startsWith('/') ? mount + answer.to : answer.to,
          requestURL,
        );
        let forwarded = foreignQueryParams(requestURL.search);
        if (forwarded && !target.search) {
          target.search = forwarded;
        }
        ctxt.redirect(target.href);
        ctxt.status = answer.status;
        return;
      }
      // One form of each path: a fixed page or a page is served at its
      // declared path, so '/pricing/' moves to '/pricing' (308), which keeps
      // relative links in the page resolving against a stable base. The
      // root keeps its trailing slash.
      if (
        answer?.kind === 'page' ||
        answer?.kind === 'listing' ||
        answer?.kind === 'fixed'
      ) {
        let canonical = mount + (sitePathOf(routedRealm, requestURL) ?? '/');
        if (canonical !== mount + '/' && requestURL.pathname !== canonical) {
          ctxt.redirect(
            new URL(canonical + requestURL.search, requestURL).href,
          );
          ctxt.status = 308;
          return;
        }
      }
      if (answer?.kind === 'listing') {
        cardURL = new URL(await siteHomeCard(routedRealm));
        // The home card's own head names the site, not the listing.
        let { listingTitle, name } = answer.pageType;
        servedShare = {
          title: listingTitle || name,
          description: (await routedRealm.getSiteSettings()).tagline,
        };
      } else if (answer?.kind === 'fixed') {
        // A fixed page in another realm (realm.json opted in) is served as
        // that realm prerendered it, and only when a visitor who isn't
        // signed in may read it; otherwise the path is served as if unrouted.
        let target = new URL(answer.card);
        if (
          !answer.crossRealm ||
          (await anonymousMayRead(target, routingDeps, ctxt.req.headers))
        ) {
          cardURL = target;
        } else {
          log.warn(
            `not serving ${target.href} at ${requestURL.pathname}: a visitor who isn't signed in may not read it`,
          );
        }
      } else if (answer?.kind === 'page') {
        servedShare = answer.share;
        let target = new URL(answer.card.id);
        let holds = new RealmPaths(new URL(routedRealm.url)).inRealm(target);
        if (holds) {
          cardURL = target;
        } else if (
          (await routedRealm.getSiteSettings()).serveSourcePrerender &&
          (await anonymousMayRead(target, routingDeps, ctxt.req.headers))
        ) {
          cardURL = target;
        } else {
          log.warn(
            `not serving ${target.href} at ${requestURL.pathname}: it is in another realm, and either realm.json doesn't opt in or a visitor who isn't signed in may not read it`,
          );
        }
      } else {
        let path = sitePathOf(routedRealm, requestURL);
        let ownCard =
          path && path !== '/'
            ? new URL(path.slice(1), routedRealm.url)
            : undefined;
        // A routed card visited at its own card path moves to the address
        // the site serves it at, so a page has one address.
        let routed = ownCard
          ? (
              await sitePathsForCards(routedRealm, [ownCard.href], routingDeps)
            ).get(cardKey(ownCard))
          : undefined;
        if (routed) {
          ctxt.redirect(
            new URL(mount + routed.path + requestURL.search, requestURL).href,
          );
          ctxt.status = 301;
          return;
        }
        // A path that names no card is not found: the site's not-found card,
        // with status 404.
        let settings = await routedRealm.getSiteSettings();
        if (
          (settings.pageTypes.length || settings.notFound) &&
          !isIndexRequest &&
          !(await isIndexedCardInstance(cardURL, routingDeps))
        ) {
          ctxt.status = 404;
          servedNotFound = true;
          if (settings.notFound) {
            cardURL = new URL(settings.notFound);
          }
        }
      }
    }

    headLog.debug(`Fetching head HTML for ${cardURL.href}`);
    isolatedLog.debug(`Fetching isolated HTML for ${cardURL.href}`);
    scopedCSSLog.debug(`Fetching scoped CSS for ${cardURL.href}`);

    let readMarkup = (url: URL) =>
      Promise.all([
        retrieveHeadHTML({
          cardURL: url,
          dbAdapter,
          log: headLog,
        }),
        retrieveIsolatedHTML({
          cardURL: url,
          dbAdapter,
          log: isolatedLog,
        }),
        retrieveScopedCSS({
          cardURL: url,
          dbAdapter,
          log: scopedCSSLog,
        }),
      ]);
    let [headMarkup, isolatedMarkup, scopedCSS] = await readMarkup(cardURL);

    // A page whose card failed to render shows the site's error card in its
    // place, with status 500, as the not-found card stands in for a missing
    // one. A card that simply hasn't been rendered yet is left to the app.
    let servedError = false;
    if (routedRealm && isolatedMarkup.html == null && !servedNotFound) {
      let { errorCard } = await routedRealm.getSiteSettings();
      if (errorCard && (await pageRenderFailed({ cardURL, dbAdapter }))) {
        cardURL = new URL(errorCard);
        ctxt.status = 500;
        servedError = true;
        [headMarkup, isolatedMarkup, scopedCSS] = await readMarkup(cardURL);
      }
    }
    // The page is a read rooted at the card, so a format its type's `read`
    // declares unshareable is served data-only here as on every other route:
    // no markup of it is injected, and the host renders the card from its
    // data once it boots. Each format is judged by the card its markup was
    // read from, which the page URL can resolve to more than one of, and only
    // where some markup was found, so a path naming no card costs no
    // definition lookup.
    let formatsFor = new Map<string, Promise<PrerenderedHtmlFormat[]>>();
    let withheld = async (
      markup: { html: string | null; readURL: URL | null },
      format: PrerenderedHtmlFormat,
    ) => {
      if (markup.html == null || !markup.readURL) {
        return false;
      }
      let key = markup.readURL.href;
      let formats = formatsFor.get(key);
      if (!formats) {
        formats = unshareableFormatsForPage(
          markup.readURL,
          routedRealm,
          routingDeps,
        );
        formatsFor.set(key, formats);
      }
      return (await formats).includes(format);
    };
    let [headWithheld, isolatedWithheld] = await Promise.all([
      withheld(headMarkup, 'head'),
      withheld(isolatedMarkup, 'isolated'),
    ]);
    let headHTML = headWithheld ? null : headMarkup.html;
    let isolatedHTML = isolatedWithheld ? null : isolatedMarkup.html;

    let doc = new JSDOM().window.document;
    if (headHTML != null) {
      let sanitized = sanitizeHeadHTMLToString(headHTML, doc);
      if (sanitized !== null) {
        headHTML = sanitized;
      } else {
        headHTML = null;
      }
    }

    // A site with a frame shows every page inside it: the frame card's
    // prerendered HTML, with the page's in the place its <SitePage /> marks.
    let siteSettings = routedRealm
      ? await routedRealm.getSiteSettings()
      : undefined;
    let frame = siteSettings?.frame
      ? await siteFrameMarkup(
          new URL(siteSettings.frame),
          cardURL,
          routedRealm!,
          siteSettings.serveSourcePrerender === true,
          dbAdapter,
        )
      : undefined;
    if (frame?.scopedCSS) {
      scopedCSS = scopedCSS
        ? `${frame.scopedCSS}\n${scopedCSS}`
        : frame.scopedCSS;
    }

    // A site page's ETag names everything it is built from: the publish, the
    // host shell, the index generation of every realm the site draws on
    // (which covers where its links go), and the page's and frame's
    // prerendered markup, which a render can replace after the index has
    // committed. A revalidation is answered here, before the work of placing
    // the page's links. A page whose card hasn't been prerendered yet, or a
    // missing one, isn't given one.
    if (
      isSitePage &&
      lastPublishedAt &&
      indexHTMLHash &&
      isolatedHTML != null &&
      !servedNotFound &&
      !servedError
    ) {
      let generations = await siteGenerations(routedRealm!, routingDeps);
      etag = `"site-${createHash('sha256')
        .update(
          [
            lastPublishedAt,
            indexHTMLHash,
            generations,
            cardURL.href,
            headHTML ?? '',
            isolatedHTML,
            scopedCSS ?? '',
            frame?.html ?? '',
          ].join('\n'),
        )
        .digest('hex')
        .slice(0, 32)}"`;
      if (notModified(etag)) {
        return;
      }
    }

    // A site's pages are rewritten on the way out to the address they are
    // served at: links to routed cards, the canonical URL and og:url. The
    // cards the page and its frame link to are looked up in one batch.
    let canonicalHead: string | undefined;
    let sitePaths: Map<string, { path: string; share?: HostRouteShare }> =
      new Map();
    if (routedRealm && siteSettings && routesPaths(siteSettings)) {
      let { mount, canonical } = siteMounts(routedRealm, requestURL);
      let linked = new Set<string>([cardKey(cardURL)]);
      for (let key of linkedCards(isolatedHTML ?? '', cardURL, doc)) {
        linked.add(key);
      }
      if (frame) {
        for (let key of linkedCards(frame.html, frame.url, doc)) {
          linked.add(key);
        }
      }
      sitePaths = await sitePathsForCards(
        routedRealm,
        [...linked],
        routingDeps,
      );
      let rewriter = siteRewriter({
        requestMount: mount,
        canonicalMount: canonical,
        requestPath: `/${requestURL.pathname.slice(mount.pathname.length)}`,
        paths: new Map([...sitePaths].map(([card, { path }]) => [card, path])),
        share: servedShare,
        canonical: !servedNotFound && !servedError,
        document: doc,
      });
      if (isolatedHTML != null) {
        isolatedHTML = rewriter.body(isolatedHTML, cardURL);
      }
      if (frame) {
        frame.html = rewriter.body(frame.html, frame.url);
      }
      if (headHTML != null) {
        headHTML = rewriter.head(headHTML);
      } else {
        canonicalHead = rewriter.head('');
      }
    }
    if (frame) {
      isolatedHTML = framePage(frame.html, isolatedHTML ?? '', doc);
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
      if (canonicalHead) {
        headFragments.push(canonicalHead);
      }
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

    // The shell's empty description gives way to the page's own.
    if (
      /<meta[^>]+name="description"[^>]+content="[^"]/.test(
        headFragments.join(''),
      )
    ) {
      responseHTML = responseHTML.replace(
        /<meta name="description" content=""\s*\/?>\s*/,
        '',
      );
    }

    if (headFragments.length > 0) {
      responseHTML = injectHeadHTML(responseHTML, headFragments.join('\n'));
    }

    // Per-request additions to the host's config: where the site serves this
    // page and its links, as a snapshot.
    let configPatch: Record<string, unknown> = {};
    if (routedRealm && siteSettings && routesPaths(siteSettings)) {
      // Where the page, the cards it links to and the fixed pages are
      // served, and the literal redirects, so its links and navigation need
      // no request. Anything else the host asks for.
      let pages = new Map<
        string,
        [string, string] | [string, string, HostRouteShare]
      >();
      for (let page of siteSettings.fixedPages) {
        pages.set(page.path, [page.path, page.card]);
      }
      for (let [card, { path, share }] of sitePaths) {
        if (!pages.has(path)) {
          pages.set(path, share ? [path, card, share] : [path, card]);
        }
      }
      let snapshot: HostRouteSnapshot = {
        realm: routedRealm.url,
        mount: siteMounts(routedRealm, requestURL).mount.pathname,
        pages: [...pages.values()],
        redirects: siteSettings.redirects.flatMap((r) =>
          isLiteralRedirect(r)
            ? [[normalizeRoutingPath(r.from), r.to, r.statusCode]]
            : [],
        ) as [string, string, number][],
        listings: siteSettings.pageTypes.flatMap((t) =>
          t.listingPath ? [t.listingPath] : [],
        ),
        ...(siteSettings.notFound ? { notFound: siteSettings.notFound } : {}),
        ...(siteSettings.errorCard
          ? { errorCard: siteSettings.errorCard }
          : {}),
      };
      configPatch.hostRouteSnapshot = snapshot;
    }
    if (
      routedRealm &&
      siteSettings &&
      (siteSettings.pageTypes.length ||
        siteSettings.frame ||
        siteSettings.notFound)
    ) {
      // The site as the visitor sees it, which the host app names on every
      // request it makes for the visit, so the realm server answers it as the
      // site (see site-boundary).
      configPatch.hostSite = siteMounts(routedRealm, requestURL).mount.href;
    }
    if (
      routedRealm &&
      siteSettings?.frame &&
      (siteSettings.serveSourcePrerender ||
        new RealmPaths(new URL(routedRealm.url)).inRealm(
          new URL(siteSettings.frame),
        ))
    ) {
      configPatch.hostSiteFrame = siteSettings.frame;
    }
    if (Object.keys(configPatch).length > 0) {
      responseHTML = responseHTML.replace(
        /(<meta name="@cardstack\/host\/config\/environment" content=")([^"]+)("\s*\/?>)/,
        (_match, g1, g2, g3) => {
          let cfg = { ...JSON.parse(decodeURIComponent(g2)), ...configPatch };
          return `${g1}${encodeURIComponent(JSON.stringify(cfg))}${g3}`;
        },
      );
    }

    // A site's page carries its card's data, so the app shows the card it was
    // served without fetching it again.
    if (siteSettings && isolatedHTML != null) {
      let pageDoc = await anonymousCardDoc(
        cardURL,
        routingDeps,
        ctxt.req.headers,
      );
      if (pageDoc) {
        // Beside the head, not inside its markers: injectHeadHTML replaces
        // what the markers hold, which is the page's title and share tags.
        let script = `<script type="application/json" data-boxel-page-doc data-card-url="${escapeAttribute(
          cardURL.href.replace(/\.json$/, ''),
        )}">${pageDoc.replace(/</g, '\\u003c')}</script>`;
        responseHTML = responseHTML.replace(
          '</head>',
          () => `${script}\n</head>`,
        );
      }
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
      // The shell is withheld from document embeds (see
      // isDocumentEmbedRequest), so a cached copy must not satisfy them.
      ctxt.vary('Sec-Fetch-Dest');
    }

    ctxt.body = responseHTML;
    return;
  };

  let serveHostApp = async (ctxt: Koa.Context, next: Koa.Next) => {
    let acceptHeader = (ctxt.header.accept ?? '').toLowerCase();
    let isHead = ctxt.method === 'HEAD';
    if (isDocumentEmbedRequest(ctxt)) {
      return next();
    }
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
