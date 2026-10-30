import type Koa from 'koa';
import {
  isRedirectRoutingRule,
  normalizeRoutingPath,
  RealmPaths,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import {
  loadHostRoutes,
  matchHostTableRoute,
  resolveDynamicRoute,
} from '../lib/host-routes.ts';
import {
  findOrMountRealm,
  hasPublicPermissions,
  matchHostRoutingRule,
  type RealmRoutingDeps,
} from '../lib/realm-routing.ts';
import {
  sendResponseForBadRequest,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';

// What a site serves at a path, and where a site serves a card, for the host
// app's in-app navigation. Both answer from what serve-index uses: the exact
// routing rules, the route table, then the `:name` rules. Only a publicly
// readable realm answers, so a private realm's routes are never disclosed.
//
//   GET /_host-route?url=<a page's URL>
//     → { kind: 'page', card } | { kind: 'redirect', to, status }
//       | { kind: 'gone' } | { kind: 'listing' } | { kind: 'none' }
//   GET /_host-route?realm=<routing realm URL>&card=<card URL>[&card=…]
//     → { paths: { <card URL>: <realm-relative path> } }

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
  let table = await matchHostTableRoute(pageURL, deps);
  if (table) {
    let { row } = table;
    if (row.kind === 'alias' && row.targetPath) {
      let mount = new URL(realm.url).pathname.replace(/\/$/, '');
      return json(ctxt, {
        kind: 'redirect',
        to: mount + row.targetPath,
        status: 301,
      });
    }
    if (row.kind === 'page' && row.cardURL) {
      let holds = new RealmPaths(new URL(realm.url)).inRealm(
        new URL(row.cardURL),
      );
      if (holds || (await realm.getSiteSettings()).serveSourcePrerender) {
        return json(ctxt, { kind: 'page', card: row.cardURL });
      }
      return json(ctxt, { kind: 'none' });
    }
    return json(ctxt, { kind: row.kind });
  }
  let id = await resolveDynamicRoute(realm, pageURL, ctxt.req.headers);
  return json(ctxt, id ? { kind: 'page', card: id } : { kind: 'none' });
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
  let wanted = new Map<string, string>();
  for (let card of cards) {
    try {
      wanted.set(cardKey(card), card);
    } catch {
      // not a URL; nothing to answer for it
    }
  }
  let paths: Record<string, string> = {};
  // Exact rules first, as serve-index tries them.
  for (let rule of await realm.getHostRoutingMap()) {
    if (isRedirectRoutingRule(rule)) {
      continue;
    }
    let card = wanted.get(cardKey(rule.id));
    if (card && !(card in paths)) {
      paths[card] = normalizeRoutingPath(rule.path);
    }
  }
  for (let row of await loadHostRoutes(deps.dbAdapter, realm.url)) {
    if (row.kind !== 'page' || !row.cardURL) {
      continue;
    }
    let card = wanted.get(cardKey(row.cardURL));
    if (card && !(card in paths)) {
      paths[card] = row.path;
    }
  }
  return json(ctxt, { paths });
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
      if (realm) {
        return await pathsForCards(
          ctxt,
          new URL(realm),
          params.getAll('card'),
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
