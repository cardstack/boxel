import { createHmac } from 'crypto';
import type Koa from 'koa';
import type { Readable } from 'stream';
import { logger, param, query, type Realm } from '@cardstack/runtime-common';

import {
  fullRequestURL,
  readRequestBody,
  setRequestBody,
} from '../middleware/index.ts';
import { nodeStreamToText } from '../stream.ts';
import { findOrMountRealm, type RealmRoutingDeps } from './realm-routing.ts';
import { siteAt, siteMounts, sitePathsForCards } from './host-routes.ts';

// The boundary between a published site and its visitors (Host Mode v2 R2).
// Everything a visitor receives passes through `siteBoundary`: the page's
// HTML and config, card and search documents, modules, and every header that
// names a URL.
//
// A site that draws on other realms serves each of them under its own
// address, at `<site mount>/_r/<alias>/`, so a visitor never learns what those
// realms are called or who owns them. The alias is an HMAC of the site and the
// source realm, keyed by a server secret, so nothing is stored: outbound the
// server computes it, and inbound it computes the aliases of the site's own
// sources and matches one. An alias resolves only for a realm the site draws
// on, and the same realm has a different alias on every site. It is a
// pseudonym, not a credential: a request under it is a request to the source
// realm, whose permissions decide what it may read.
//
// Ids stay canonical in the index and in every stored document (ADR 002). The
// alias exists only here, at the network boundary.

const log = logger('site-boundary');

// Sent by the host app on a site visit, naming the site as the visitor sees
// it: its mount on the page's own host.
export const SITE_HEADER = 'x-boxel-site';

const ALIAS_LENGTH = 26;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
// An aliased URL anywhere in a request: the site's mount, `_r`, the alias.
const ALIASED_URL = new RegExp(
  `https?://[^\\s"'<>\\\\?#]*?/_r/[${BASE32}]{${ALIAS_LENGTH}}/`,
  'g',
);

// The response types whose bodies can name a URL.
const TEXT_TYPES =
  /^(text\/(html|css|plain|markdown|javascript|xml)|application\/(json|javascript|xml|[\w.+-]+\+json))$/;

export function realmAlias(
  secret: string,
  site: string,
  sourceRealm: string,
): string {
  let key = createHmac('sha256', secret)
    .update('boxel:site-realm-alias')
    .digest();
  let digest = createHmac('sha256', key)
    .update(`${site}\n${sourceRealm}`)
    .digest();
  let bits = 0;
  let value = 0;
  let out = '';
  for (let byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < ALIAS_LENGTH) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length === ALIAS_LENGTH) {
      break;
    }
  }
  return out;
}

export interface SiteBoundary {
  site: string;
  // Each source realm's URL and the address it is served under, both with a
  // trailing slash, longest first.
  realms: { canonical: string; aliased: string }[];
  // What an aliased realm says about itself: the site's own name and images.
  info: { name: string; iconURL: string | null; backgroundURL: string | null };
}

export type SiteBoundaryDeps = RealmRoutingDeps & { secret: string };

// Whether a realm is a published site. Only a published site is aliased: a
// realm its owner is editing keeps every URL as it is.
const publishedCache = new Map<string, { published: boolean; at: number }>();
const PUBLISHED_TTL_MS = 60_000;

async function isPublished(realm: Realm, deps: RealmRoutingDeps) {
  let cached = publishedCache.get(realm.url);
  if (cached && Date.now() - cached.at < PUBLISHED_TTL_MS) {
    return cached.published;
  }
  let rows = await query(deps.dbAdapter, [
    `SELECT 1 FROM realm_registry WHERE kind = 'published' AND url =`,
    param(realm.url),
  ]);
  let published = rows.length > 0;
  publishedCache.set(realm.url, { published, at: Date.now() });
  return published;
}

// The realms a site draws on: its page types' source realms and the realms
// holding its frame and not-found cards, other than its own.
async function sourceRealms(
  site: Realm,
  deps: RealmRoutingDeps,
): Promise<string[]> {
  let settings = await site.getSiteSettings();
  let sources = new Set(settings.pageTypes.map((t) => t.sourceRealm));
  for (let card of [settings.frame, settings.notFound]) {
    if (card) {
      let realm = await findOrMountRealm(new URL(card), deps).catch(
        () => undefined,
      );
      if (realm) {
        sources.add(realm.url);
      }
    }
  }
  sources.delete(site.url);
  return [...sources];
}

// The boundary of the site mounted at `mount` (as the visitor sees it), or
// undefined when it isn't a published site that draws on another realm.
export async function boundaryAt(
  mount: URL,
  deps: SiteBoundaryDeps,
): Promise<SiteBoundary | undefined> {
  let site = await siteAt(mount, deps).catch(() => undefined);
  if (!site || !(await isPublished(site, deps))) {
    return undefined;
  }
  let sources = await sourceRealms(site, deps);
  if (!sources.length) {
    return undefined;
  }
  let info = await site.getRealmInfo();
  return {
    site: site.url,
    realms: sources
      .map((canonical) => ({
        canonical,
        aliased: `${mount.href}_r/${realmAlias(deps.secret, site.url, canonical)}/`,
      }))
      .sort((a, b) => b.canonical.length - a.canonical.length),
    info: {
      name: info.name,
      iconURL: info.iconURL,
      backgroundURL: info.backgroundURL,
    },
  };
}

function replaceAll(text: string, pairs: [string, string][]): string {
  for (let [from, to] of pairs) {
    if (text.includes(from)) {
      text = text.split(from).join(to);
    }
  }
  return text;
}

export class SiteTranslator {
  readonly boundaries: SiteBoundary[];

  constructor(boundaries: SiteBoundary[]) {
    this.boundaries = boundaries;
  }

  private get realms() {
    return this.boundaries.flatMap((b) => b.realms);
  }

  // A visitor's URL or text, with the aliases it names as the realms' own
  // URLs.
  inbound(text: string): string {
    return replaceAll(
      text,
      this.realms.flatMap(({ canonical, aliased }) => [
        [aliased, canonical],
        [encodeURIComponent(aliased), encodeURIComponent(canonical)],
      ]),
    );
  }

  // Text bound for a visitor, with each source realm's URL as its alias,
  // spelled out or URL-encoded.
  outbound(text: string): string {
    return replaceAll(
      text,
      this.realms.flatMap(({ canonical, aliased }) => [
        [canonical, aliased],
        [encodeURIComponent(canonical), encodeURIComponent(aliased)],
      ]),
    );
  }

  private infoFor(realmURL: unknown) {
    if (typeof realmURL !== 'string') {
      return undefined;
    }
    for (let boundary of this.boundaries) {
      if (boundary.realms.some(({ aliased }) => realmURL === aliased)) {
        return boundary.info;
      }
    }
    return undefined;
  }

  // An aliased realm describes itself as the site does: the site's name and
  // images, and no owner, Matrix identity or publishing history.
  private aliasInfo(info: Record<string, unknown>, realmURL: unknown) {
    let site = this.infoFor(realmURL);
    if (!site) {
      return;
    }
    info.name = site.name;
    info.iconURL = site.iconURL;
    info.backgroundURL = site.backgroundURL;
    delete info.realmUserId;
    delete info.createdAt;
    delete info.updatedAt;
    info.lastPublishedAt = null;
    info.publishable = null;
  }

  private walk(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach((item) => this.walk(item));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    let object = value as Record<string, unknown>;
    if (object.realmInfo && typeof object.realmInfo === 'object') {
      this.aliasInfo(
        object.realmInfo as Record<string, unknown>,
        object.realmURL ?? object.realmIdentifier,
      );
    }
    if (
      object.type === 'realm-info' &&
      object.attributes &&
      typeof object.attributes === 'object'
    ) {
      this.aliasInfo(object.attributes as Record<string, unknown>, object.id);
    }
    for (let child of Object.values(object)) {
      this.walk(child);
    }
  }

  outboundJSON(text: string): string {
    let translated = this.outbound(text);
    try {
      let doc = JSON.parse(translated);
      this.walk(doc);
      return JSON.stringify(doc);
    } catch {
      return translated;
    }
  }

  // A served page: its markup and config, and the card data inlined in its
  // head, whose realm info is the site's.
  outboundHTML(html: string): string {
    return this.outbound(html).replace(
      /(<script type="application\/json" data-boxel-page-doc[^>]*>)([\s\S]*?)(<\/script>)/,
      (_match, open: string, body: string, close: string) => {
        let doc = this.outboundJSON(body.replace(/\\u003c/g, '<'));
        return `${open}${doc.replace(/</g, '\\u003c')}${close}`;
      },
    );
  }

  outboundBody(text: string, type: string): string {
    if (type === 'text/html') {
      return this.outboundHTML(text);
    }
    if (type === 'application/json' || type.endsWith('+json')) {
      return this.outboundJSON(text);
    }
    return this.outbound(text);
  }
}

// The sites whose aliases a request names, anywhere in its URL or body.
async function boundariesNamed(
  texts: string[],
  deps: SiteBoundaryDeps,
): Promise<SiteBoundary[]> {
  let mounts = new Set<string>();
  for (let text of texts) {
    for (let match of text.matchAll(ALIASED_URL)) {
      // Up to and including the mount's trailing slash.
      mounts.add(match[0].slice(0, -(ALIAS_LENGTH + 4)));
    }
  }
  let boundaries: SiteBoundary[] = [];
  for (let mount of mounts) {
    let boundary = await boundaryAt(new URL(mount), deps);
    if (boundary) {
      boundaries.push(boundary);
    }
  }
  return boundaries;
}

function isDocumentRequest(ctxt: Koa.Context) {
  let accept = (ctxt.get('accept') ?? '').toLowerCase();
  return (
    ['GET', 'HEAD'].includes(ctxt.method) &&
    accept.includes('text/html') &&
    !accept.includes('application/vnd.')
  );
}

// Points the request at a URL of its own host or another, as if it had been
// sent there.
function retarget(ctxt: Koa.Context, target: URL) {
  let pathAndQuery = `${target.pathname}${target.search}`;
  ctxt.url = pathAndQuery;
  ctxt.originalUrl = pathAndQuery;
  ctxt.req.headers.host = target.host;
  if (ctxt.req.headers['x-forwarded-host']) {
    ctxt.req.headers['x-forwarded-host'] = target.host;
  }
}

async function responseText(body: unknown): Promise<string | undefined> {
  if (typeof body === 'string') {
    return body;
  }
  if (Buffer.isBuffer(body)) {
    return body.toString('utf8');
  }
  if (body && typeof (body as Readable).pipe === 'function') {
    return await nodeStreamToText(body as Readable);
  }
  if (body && typeof body === 'object') {
    return JSON.stringify(body);
  }
  return undefined;
}

// Where the site serves a card a visitor opened at its aliased address.
async function routedAddress(
  boundaries: SiteBoundary[],
  card: URL,
  requestURL: URL,
  deps: SiteBoundaryDeps,
): Promise<string | undefined> {
  for (let boundary of boundaries) {
    let site = await siteAt(new URL(boundary.site), deps).catch(
      () => undefined,
    );
    if (!site) {
      continue;
    }
    let key = new URL(card.href);
    key.search = '';
    key.hash = '';
    let routed = (await sitePathsForCards(site, [key.href], deps)).get(
      key.href.replace(/\.json$/, ''),
    );
    if (routed) {
      let { mount } = siteMounts(site, requestURL);
      return new URL(routed.path.replace(/^\//, '') + card.search, mount).href;
    }
  }
  return undefined;
}

export function siteBoundary(
  deps: SiteBoundaryDeps,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt, next) {
    let requestURL = fullRequestURL(ctxt);
    let contentType = (ctxt.get('content-type') ?? '').toLowerCase();
    let body =
      contentType.includes('json') || contentType.startsWith('text/')
        ? await readRequestBody(ctxt)
        : undefined;
    let bodyText = typeof body === 'string' ? body : undefined;

    // Which sites this request is a visit to: the ones whose aliases it
    // names, the one the host app says it is showing, and the one a document
    // request is for.
    let boundaries = await boundariesNamed(
      [requestURL.href, bodyText ?? ''],
      deps,
    );
    let visiting = ctxt.get(SITE_HEADER);
    if (visiting) {
      try {
        let boundary = await boundaryAt(new URL(visiting), deps);
        if (boundary) {
          boundaries.push(boundary);
        }
      } catch {
        // not a URL; no site
      }
    }
    if (isDocumentRequest(ctxt)) {
      let site = await findOrMountRealm(requestURL, deps).catch(
        () => undefined,
      );
      if (site) {
        let boundary = await boundaryAt(
          siteMounts(site, requestURL).mount,
          deps,
        );
        if (boundary) {
          boundaries.push(boundary);
        }
      }
    }
    if (!boundaries.length) {
      return next();
    }
    let translator = new SiteTranslator(boundaries);

    // Inbound. An aliased address opened as a page is a card's own address,
    // which moves to where the site serves the card, as any card's own
    // address does. One the site doesn't serve stays where it is, and the
    // site answers it as not found.
    let target = new URL(translator.inbound(requestURL.href));
    if (target.href !== requestURL.href) {
      if (isDocumentRequest(ctxt)) {
        let routed = await routedAddress(boundaries, target, requestURL, deps);
        if (routed) {
          ctxt.redirect(routed);
          ctxt.status = 301;
          return;
        }
      } else {
        retarget(ctxt, target);
      }
    }
    if (bodyText !== undefined) {
      setRequestBody(ctxt, translator.inbound(bodyText));
    }

    await next();

    // Outbound.
    for (let [name, value] of Object.entries(ctxt.response.headers)) {
      if (typeof value === 'string') {
        let translated = translator.outbound(value);
        if (translated !== value) {
          ctxt.set(name, translated);
        }
      }
    }
    let type = ctxt.response.type;
    if (
      ctxt.method === 'HEAD' ||
      !TEXT_TYPES.test(type) ||
      ctxt.body == null ||
      // Koa reads an absent header as ''. A compressed body can't be read
      // as text here.
      !['', 'identity'].includes(ctxt.response.get('content-encoding'))
    ) {
      return;
    }
    let text = await responseText(ctxt.body);
    if (text === undefined) {
      return;
    }
    let translated = translator.outboundBody(text, type);
    if (translated !== text) {
      log.debug(`translated ${requestURL.href} for ${boundaries[0].site}`);
    }
    // Content-Type is already set, so assigning a string keeps it and sets
    // the new length.
    ctxt.body = translated;
  };
}
