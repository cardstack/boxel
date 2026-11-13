import type { Realm, ResponseWithNodeStream } from '@cardstack/runtime-common';
import {
  CLIENT_IP_HEADER,
  SupportedMimeType,
  hasExecutableExtension,
  isRedirectRoutingRule,
  isScopedCSSRequest,
} from '@cardstack/runtime-common';
import {
  hostRoutingRuleFor,
  realmHoldsExtensionlessSourceModule,
} from './realm-routing.ts';

// Whether a visitor who isn't signed in can view a realm's home page: read the
// card the realm serves at its root, and load that card's code from the realm.
// A realm is fit to be served at a host URL only when they can.
//
// Every answer comes from the realm itself. The check sends the requests such
// a visitor's browser would send, through `realm.handle` and without
// credentials, so the realm's permissions and its policy decide each one
// exactly as they would decide the visitor's. Nothing here evaluates a
// permission or a policy grant of its own.

// The address the check's requests come from. A policy grant that admits
// callers who aren't signed in admits them by address: it refuses a caller
// whose address its blocklist names, counts each address against its rate
// limit, and refuses a caller whose address the server could not work out
// (see `AnonymousAdmission.callerFor`). A request made here never passed
// through the client-address middleware, so it would have no address and be
// refused as a blocked caller, though the realm admits real visitors. It
// carries an address instead, from the range reserved for documentation
// (RFC 5737), which is no real visitor's and which no blocklist written for
// real visitors names. It is an ordinary visitor's address, not one of the
// platform's own: infrastructure is exempt from blocklists, so marking the
// check as infrastructure would pass a grant whose blocklist refuses every
// visitor. Like a visitor's, the check's requests count against the grant's
// rate limit for this address, so a check repeated within one rate-limit
// window can be refused with a 429.
export const ANONYMOUS_HOME_PAGE_CHECK_ADDRESS = '192.0.2.200';

export interface AnonymousHomePageModule {
  // The module's URL, as a browser loading the card requests it.
  url: string;
  // The status the realm answered a visitor who isn't signed in with.
  status: number;
}

export interface AnonymousHomePageReport {
  // The card the realm serves at its root: its index card, or the card a
  // routing rule for `/` names. Undefined when a rule redirects `/`.
  homeCardId: string | undefined;
  // Where the realm sends a visitor to its root, when a routing rule
  // redirects `/`. The realm itself then serves no home card to check.
  redirectTo?: string;
  // Whether a visitor who isn't signed in may read the home card.
  homeCardReadable: boolean;
  // The status the realm answered that read with. Undefined when there is no
  // home card.
  homeCardStatus: number | undefined;
  // The home card's modules in this realm that a visitor who isn't signed in
  // can't load.
  unloadableModules: AnonymousHomePageModule[];
  // Whether a visitor who isn't signed in can view the home page: the home
  // card is readable and every one of its modules in this realm loads.
  anonymousCanView: boolean;
}

export async function checkAnonymousHomePage(
  realm: Realm,
): Promise<AnonymousHomePageReport> {
  let home = await homePage(realm);
  if ('redirectTo' in home) {
    return {
      homeCardId: undefined,
      redirectTo: home.redirectTo,
      homeCardReadable: false,
      homeCardStatus: undefined,
      unloadableModules: [],
      anonymousCanView: false,
    };
  }
  let homeCardId = home.cardId;

  let homeCardStatus = await anonymousStatus(
    realm,
    homeCardId,
    SupportedMimeType.CardJson,
  );

  let unloadableModules: AnonymousHomePageModule[] = [];
  for (let url of await homeCardModules(realm, homeCardId)) {
    // A browser loading a card imports its modules with a plain `fetch`,
    // which asks for `*/*`: the realm's module serve answers it, and a
    // `readSource` grant is what opens that serve to a visitor who isn't
    // signed in.
    let status = await anonymousStatus(realm, url, SupportedMimeType.All);
    if (status !== 200) {
      unloadableModules.push({ url, status });
    }
  }

  let homeCardReadable = homeCardStatus === 200;
  return {
    homeCardId,
    homeCardReadable,
    homeCardStatus,
    unloadableModules,
    anonymousCanView: homeCardReadable && unloadableModules.length === 0,
  };
}

// What the realm serves at its root, decided as the host-mode index serve
// decides it (`serveIndex`): the routing rule for `/`, where the realm's
// routing map has one, and otherwise the realm's index card. Routing rules
// only ever name cards in the realm they belong to.
async function homePage(
  realm: Realm,
): Promise<{ cardId: string } | { redirectTo: string }> {
  let rule = hostRoutingRuleFor(await realm.getHostRoutingMap(), '/');
  if (rule) {
    return isRedirectRoutingRule(rule)
      ? { redirectTo: rule.redirectTo }
      : { cardId: rule.id };
  }
  return { cardId: new URL('index', realm.url).href };
}

// The modules in this realm that rendering the card loads, as URLs.
//
// They come from the card's index entry: its `deps` are what the index visit
// loaded while it rendered the card, so they hold the module the card adopts
// from, every module that module imports in turn, and the modules of the
// fields and linked cards it renders. Reading the card's `adoptsFrom` alone
// would miss all but the first. `deps` also lists the cards and files the
// render read, and scoped CSS, which are not modules, so a dep counts as a
// module only where the realm holds a module file for it. Deps in other realms
// are left out: their own realm's access decides them.
async function homeCardModules(
  realm: Realm,
  cardId: string,
): Promise<string[]> {
  let entry = await realm.realmIndexQueryEngine.instance(new URL(cardId));
  if (!entry) {
    return [];
  }
  let modules = new Set<string>();
  for (let dep of entry.deps ?? []) {
    if (isScopedCSSRequest(dep)) {
      continue;
    }
    let url: URL;
    try {
      url = realm.virtualNetwork.toURL(dep);
    } catch {
      continue;
    }
    if (!realm.paths.inRealm(url)) {
      continue;
    }
    let isModule = hasExecutableExtension(url.pathname)
      ? true
      : realmHoldsExtensionlessSourceModule(realm, url);
    if (isModule) {
      modules.add(url.href);
    }
  }
  return [...modules];
}

// The status the realm answers a visitor who isn't signed in with, for a
// `GET` of `url` asking for `accept`.
async function anonymousStatus(
  realm: Realm,
  url: string,
  accept: string,
): Promise<number> {
  let response: ResponseWithNodeStream | null = await realm.handle(
    new Request(url, {
      headers: {
        Accept: accept,
        [CLIENT_IP_HEADER]: ANONYMOUS_HOME_PAGE_CHECK_ADDRESS,
      },
    }),
  );
  if (!response) {
    return 404;
  }
  // Only the status matters, so release the body rather than read it.
  response.nodeStream?.destroy();
  await response.body?.cancel().catch(() => undefined);
  return response.status;
}
