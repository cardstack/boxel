import type Koa from 'koa';
import {
  isRedirectRoutingRule,
  RealmPaths,
  SupportedMimeType,
  type HostRouteShare,
} from '@cardstack/runtime-common';
import {
  resolveSiteRequest,
  siteHomeCard,
  sitePathOf,
  sitePathsForCards,
} from '../lib/host-routes.ts';
import {
  findOrMountRealm,
  hasPublicPermissions,
  isIndexedCardInstance,
  matchHostRoutingRule,
  type RealmRoutingDeps,
} from '../lib/realm-routing.ts';
import {
  sendResponseForBadRequest,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';

// What a site serves at a path, and where a site serves a card, for the host
// app's in-app navigation. Both answer as serve-index does: the exact
// routing rules, then the site's path templates. Only a publicly readable
// realm answers, so a private realm's routes are never disclosed.
//
//   GET /_host-route?url=<a page's URL>
//     → { kind: 'page', card } | { kind: 'redirect', to, status }
//       | { kind: 'none', notFound? }
//   GET /_host-route?[realm=<routing realm URL>&]card=<card URL>[&card=…]
//     → { realm: <routing realm URL>, paths: { <card URL>: <realm-relative path> },
//         shares: { <card URL>: { title, description, image } } }
//     Without `realm`, the realm holding the first card is the routing realm.

async function json(ctxt: Koa.Context, body: unknown) {
  await setContextResponse(
    ctxt,
    new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': SupportedMimeType.JSON,
        'Cache-Control': 'no-store',
      },
    }),
  );
}

function cardKey(url: string): string {
  let key = new URL(url);
  key.hash = '';
  key.search = '';
  return key.href.replace(/\.json$/, '');
}

async function resolvePath(
  ctxt: Koa.Context,
  pageURL: URL,
  deps: RealmRoutingDeps,
) {
  let realm = await findOrMountRealm(pageURL, deps);
  if (!realm || !(await hasPublicPermissions(realm, deps))) {
    return json(ctxt, { kind: 'none' });
  }
  let exact = await matchHostRoutingRule(pageURL, deps);
  if (exact) {
    if (isRedirectRoutingRule(exact.rule)) {
      return json(ctxt, {
        kind: 'redirect',
        to: exact.rule.redirectTo,
        status: exact.rule.statusCode,
      });
    }
    return json(ctxt, { kind: 'page', card: exact.rule.id });
  }
  let answer = await resolveSiteRequest(realm, pageURL, deps, ctxt.req.headers);
  let mount = new URL(realm.url).pathname.replace(/\/$/, '');
  if (answer.kind === 'redirect') {
    return json(ctxt, {
      kind: 'redirect',
      to: answer.to.startsWith('/') ? mount + answer.to : answer.to,
      status: answer.status,
    });
  }
  if (answer.kind === 'listing') {
    return json(ctxt, { kind: 'page', card: await siteHomeCard(realm) });
  }
  if (answer.kind === 'page') {
    let holds = new RealmPaths(new URL(realm.url)).inRealm(
      new URL(answer.card.id),
    );
    if (holds || (await realm.getSiteSettings()).serveSourcePrerender) {
      return json(ctxt, { kind: 'page', card: answer.card.id });
    }
    return json(ctxt, { kind: 'none' });
  }
  // A card's own address moves to where the site serves it; one that names
  // no card is not found.
  let path = sitePathOf(realm, pageURL);
  if (path && path !== '/') {
    let own = new URL(path.slice(1), realm.url);
    let routed = (await sitePathsForCards(realm, [own.href], deps)).get(
      cardKey(own.href),
    );
    if (routed) {
      return json(ctxt, {
        kind: 'redirect',
        to: mount + routed.path,
        status: 301,
      });
    }
    if (!(await isIndexedCardInstance(own, deps))) {
      let { notFound } = await realm.getSiteSettings();
      return json(
        ctxt,
        notFound ? { kind: 'none', notFound } : { kind: 'none' },
      );
    }
  }
  return json(ctxt, { kind: 'none' });
}

async function pathsForCards(
  ctxt: Koa.Context,
  realmURL: URL,
  cards: string[],
  deps: RealmRoutingDeps,
) {
  let realm = await findOrMountRealm(realmURL, deps);
  if (!realm || !(await hasPublicPermissions(realm, deps))) {
    return json(ctxt, { paths: {} });
  }
  let found = await sitePathsForCards(realm, cards.slice(0, 200), deps);
  let paths: Record<string, string> = {};
  let shares: Record<string, HostRouteShare> = {};
  for (let card of cards) {
    try {
      let routed = found.get(cardKey(card));
      if (routed) {
        paths[card] = routed.path;
        if (routed.share) {
          shares[card] = routed.share;
        }
      }
    } catch {
      // not a URL; nothing to answer for it
    }
  }
  return json(ctxt, { realm: realm.url, paths, shares });
}

export default function handleHostRoute({
  realms,
  reconciler,
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let deps: RealmRoutingDeps = { realms, reconciler, dbAdapter };
  return async function (ctxt: Koa.Context) {
    let params = new URL(ctxt.href).searchParams;
    let url = params.get('url');
    let realm = params.get('realm');
    try {
      if (url) {
        return await resolvePath(ctxt, new URL(url), deps);
      }
      let cards = params.getAll('card');
      if (realm || cards.length) {
        return await pathsForCards(
          ctxt,
          new URL(realm ?? cards[0]),
          cards,
          deps,
        );
      }
    } catch (e) {
      return await sendResponseForBadRequest(
        ctxt,
        e instanceof Error ? e.message : String(e),
      );
    }
    return await sendResponseForBadRequest(
      ctxt,
      'pass url=<page URL>, or realm=<routing realm URL> with card=<card URL>',
    );
  };
}
