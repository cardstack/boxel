import type RouterService from '@ember/routing/router-service';
import { later, next, scheduleOnce } from '@ember/runloop';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { TrackedMap } from 'tracked-built-ins';

import {
  HOST_APP_QUERY_PARAMS,
  normalizeRoutingPath,
  type HostRouteShare,
  type HostRouteSnapshot,
} from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import type HostModeService from './host-mode-service';
import type HostModeStateService from './host-mode-state-service';
import type NetworkService from './network';
import type StoreService from './store';
import type { CardLinkTarget, Format } from '@cardstack/base/card-api';

// Navigation on a published site. A page has one address, its routed path
// under the site's mount, and moving between pages is an in-app transition:
// a link inside the site never loads a new document. Back and Forward are
// Ember's own HistoryLocation transitions; this service adds what a browser
// does for a document load and an SPA doesn't: catching link clicks,
// restoring scroll per history entry, and moving focus to the new page.

const INTENT_DELAY_MS = 80;
const MAX_PREFETCHES = 4;

export default class HostNavigationService extends Service {
  @service declare private router: RouterService;
  @service declare private hostModeService: HostModeService;
  @service declare private hostModeStateService: HostModeStateService;
  @service declare private store: StoreService;
  @service declare private network: NetworkService;

  private scrollPositions = new Map<string, number>();
  private pendingNavigation: 'push' | 'traverse' | undefined;
  private pendingHash: string | undefined;
  private prefetched = new Set<string>();
  // The query of the page now showing that the router doesn't declare
  // (`?tag=chalkup`). The router keeps only the params it declares in the
  // URLs it writes, so an in-app visit carries the rest here and puts them
  // back on the entry. Back and Forward read it from the entry.
  @tracked private foreignSearch = '';
  private prefetching = 0;

  get snapshot(): HostRouteSnapshot | undefined {
    let snapshot = (config as { hostRouteSnapshot?: HostRouteSnapshot })
      .hostRouteSnapshot;
    return snapshot && Array.isArray(snapshot.pages) ? snapshot : undefined;
  }

  // Where the site serves the cards this visit has met, by card key: the
  // served page and its links first, then each card a later page links to,
  // asked of the server in batches as its links render. Tracked, so a link
  // shows its address once it is known.
  private knownPaths = new TrackedMap<
    string,
    { path: string; share?: HostRouteShare } | null
  >();
  private seeded = false;
  private toLearn = new Set<string>();

  private known(): TrackedMap<
    string,
    { path: string; share?: HostRouteShare } | null
  > {
    if (!this.seeded) {
      this.seeded = true;
      for (let [path, card, share] of this.snapshot?.pages ?? []) {
        this.knownPaths.set(cardKey(card), { path, share });
      }
    }
    return this.knownPaths;
  }

  // Asks the server where a card is served, batched with the others asked
  // for in the same render.
  private learn(card: string) {
    if (!this.snapshot || this.toLearn.has(card)) {
      return;
    }
    this.toLearn.add(card);
    scheduleOnce('afterRender', this, this.learnBatch);
  }

  private async learnBatch() {
    let cards = [...this.toLearn].slice(0, 100);
    this.toLearn = new Set([...this.toLearn].slice(100));
    if (!cards.length || !config.realmServerURL || !this.snapshot) {
      return;
    }
    for (let card of cards) {
      // Asked once; null until answered, and when the site serves it nowhere.
      this.knownPaths.set(card, null);
    }
    let endpoint = new URL('_host-route', config.realmServerURL);
    endpoint.searchParams.set('realm', this.snapshot.realm);
    for (let card of cards) {
      endpoint.searchParams.append('card', card);
    }
    try {
      let response = await fetch(endpoint, {
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        let answer = (await response.json()) as {
          paths?: Record<string, string>;
          shares?: Record<string, HostRouteShare>;
        };
        for (let [card, path] of Object.entries(answer.paths ?? {})) {
          this.knownPaths.set(cardKey(card), {
            path,
            share: answer.shares?.[card],
          });
        }
      }
    } catch (e) {
      console.warn('could not learn where the site serves its links', e);
    }
    if (this.toLearn.size) {
      scheduleOnce('afterRender', this, this.learnBatch);
    }
  }

  // The served page carries its card's JSON. The app's first request for
  // that card is answered from it, once, so the card it was served doesn't
  // cost a second round trip.
  private servedDocAdopted = false;
  adoptServedDoc() {
    if (this.servedDocAdopted) {
      return;
    }
    this.servedDocAdopted = true;
    let script = document.querySelector('script[data-boxel-page-doc]');
    let cardURL = script?.getAttribute('data-card-url');
    let body = script?.textContent;
    script?.remove();
    if (!cardURL || !body) {
      return;
    }
    let handler = async (request: Request) => {
      let url = request.url.split('?')[0].replace(/\.json$/, '');
      if (
        request.method !== 'GET' ||
        url !== cardURL ||
        !request.headers.get('Accept')?.includes('card+json')
      ) {
        return null;
      }
      this.network.virtualNetwork.unmount(handler);
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.card+json' },
      });
    };
    this.network.virtualNetwork.mount(handler, { prepend: true });
  }

  // The card every page of the site is shown inside, when the site has one.
  get frame(): string | undefined {
    let frame = (config as { hostSiteFrame?: unknown }).hostSiteFrame;
    return typeof frame === 'string' ? frame.replace(/\.json$/, '') : undefined;
  }

  // The site's mount on this host, with a trailing slash.
  get mount(): string | undefined {
    return this.snapshot?.mount;
  }

  // The routed path of a card, realm-relative, when this visit knows it.
  // Otherwise the server is asked, and links update when it answers.
  routedPathOf(cardURL: string): string | undefined {
    let key = cardKey(cardURL);
    let known = this.known();
    if (!known.has(key)) {
      this.learn(key);
      return undefined;
    }
    return known.get(key)?.path;
  }

  // The card a realm-relative path serves, when this visit knows it.
  cardForPath(path: string): string | undefined {
    let normalized = normalizeRoutingPath(path);
    for (let [card, entry] of this.known()) {
      if (entry?.path === normalized) {
        return card;
      }
    }
    return undefined;
  }

  // What an address on this host serves, when this visit knows it without
  // asking the server: a literal redirect, then a page, as the server checks
  // them. A site-relative redirect target comes back on this host's path.
  // Undefined when it doesn't know, or the site sent nothing.
  resolveAddress(
    pathname: string,
  ): { card: string } | { redirectTo: string } | undefined {
    let mount = this.mount;
    if (!mount) {
      return undefined;
    }
    let withSlash = pathname.endsWith('/') ? pathname : `${pathname}/`;
    if (!withSlash.startsWith(mount)) {
      return undefined;
    }
    let path = normalizeRoutingPath(`/${pathname.slice(mount.length)}`);
    for (let [from, to] of this.snapshot?.redirects ?? []) {
      if (from === path) {
        return {
          redirectTo: to.startsWith('/') ? mount + to.replace(/^\//, '') : to,
        };
      }
    }
    let card = this.cardForPath(path);
    return card ? { card } : undefined;
  }

  // The site's not-found card, shown at a path that serves nothing.
  get notFoundCard(): string | undefined {
    return this.snapshot?.notFound;
  }

  // The site's error card, shown in place of a page whose card fails.
  get errorCard(): string | undefined {
    return this.snapshot?.errorCard;
  }

  // The current page's path relative to the site, with its query. Tracked
  // through the router, so it changes with every navigation.
  get sitePath(): string | undefined {
    let mount = this.mount;
    let current = this.router.currentURL;
    if (!mount || current == null) {
      return undefined;
    }
    let [pathname, search] = current.split('?');
    let withSlash = pathname.endsWith('/') ? pathname : `${pathname}/`;
    if (!withSlash.startsWith(mount)) {
      return undefined;
    }
    let path = normalizeRoutingPath(`/${pathname.slice(mount.length)}`);
    let query = new URLSearchParams(search ?? '');
    for (let [key, value] of new URLSearchParams(this.foreignSearch)) {
      query.set(key, value);
    }
    query.delete('hostModeStack');
    let rest = query.toString();
    return rest ? `${path}?${rest}` : path;
  }

  // A realm-relative path as an address on this host.
  addressOf(path: string): string {
    let mount = this.mount ?? '/';
    return mount + path.replace(/^\//, '');
  }

  // The address a link points at on this site: the routed path for a routed
  // card, the card's path for a card the site's realm holds, and the card's
  // own URL for anything else.
  hrefFor = (target: CardLinkTarget): string | undefined => {
    if ('path' in target) {
      return this.addressOf(target.path);
    }
    let card = cardKey(target.card);
    let routed = this.routedPathOf(card);
    if (routed) {
      return this.addressOf(routed);
    }
    let realm = this.snapshot?.realm;
    if (realm && card.startsWith(realm)) {
      return this.addressOf(card.slice(realm.length));
    }
    let url = new URL(card);
    if (url.origin === window.location.origin) {
      return url.pathname;
    }
    return undefined;
  };

  navigateTo = (
    target: CardLinkTarget,
    opts?: { format?: Format; overlay?: boolean },
  ) => {
    if ('card' in target && opts?.overlay) {
      this.hostModeStateService.pushCard(cardKey(target.card));
      return;
    }
    let address = this.hrefFor(target);
    if (!address) {
      // A card the site doesn't serve opens over the page, as cards always
      // have, rather than leaving the site.
      if ('card' in target) {
        this.hostModeStateService.pushCard(cardKey(target.card));
      }
      return;
    }
    this.visit(address);
  };

  // Loads the card a link leads to before it is clicked, so the page is ready
  // when it is. Only what the snapshot can resolve without asking the server,
  // at most four at a time, and nothing on a connection that asks to save
  // data.
  prefetch = (target: CardLinkTarget) => {
    let connection = (navigator as { connection?: { saveData?: boolean } })
      .connection;
    if (connection?.saveData || this.prefetching >= MAX_PREFETCHES) {
      return;
    }
    let card: string | undefined;
    if ('card' in target) {
      card = cardKey(target.card);
    } else {
      let known = this.resolveAddress(this.addressOf(target.path));
      card = known && 'card' in known ? known.card : undefined;
    }
    if (!card || this.prefetched.has(card)) {
      return;
    }
    this.prefetched.add(card);
    this.prefetching++;
    this.store
      .get(card)
      .catch(() => this.prefetched.delete(card!))
      .finally(() => this.prefetching--);
  };

  private prefetchAddress(url: URL) {
    let known = this.resolveAddress(url.pathname);
    if (known && 'card' in known) {
      this.prefetch({ card: known.card });
    }
  }

  // An in-app transition to an address on this site.
  visit(address: string, { replace = false }: { replace?: boolean } = {}) {
    this.saveScroll();
    this.pendingNavigation = 'push';
    // The router takes a path and the query it declares; the rest of the
    // query goes back on the entry once the transition lands, and the hash
    // is applied once the page has rendered.
    let [url, hash] = address.split('#');
    this.pendingHash = hash;
    let [pathname, search] = url.split('?');
    let declared = new URLSearchParams();
    let foreign = new URLSearchParams();
    for (let [key, value] of new URLSearchParams(search ?? '')) {
      (HOST_APP_QUERY_PARAMS.includes(key) ? declared : foreign).append(
        key,
        value,
      );
    }
    let routed = declared.size ? `${pathname}?${declared}` : pathname;
    let location = this.location();
    let before = location?.getURL();
    let transition = replace
      ? this.router.replaceWith(routed)
      : this.router.transitionTo(routed);
    transition.then(
      () => {
        this.foreignSearch = foreign.size ? `?${foreign}` : '';
        if (!location || !foreign.size) {
          return;
        }
        let landed = location.getURL();
        let [landedPath, landedSearch] = landed.split('?');
        let query = new URLSearchParams(landedSearch ?? '');
        for (let [key, value] of foreign) {
          query.set(key, value);
        }
        let full = `${landedPath}?${query}`;
        if (landed === before && !replace) {
          // Only the undeclared query changed, so the router made no entry
          // and showed no new page: make both here.
          location.setURL(full);
          this.pageShown();
        } else {
          location.replaceURL(full);
        }
      },
      () => {
        // An aborted or redirected transition: whatever replaced it decides.
      },
    );
  }

  private location():
    | {
        getURL(): string;
        setURL(url: string): void;
        replaceURL(url: string): void;
      }
    | undefined {
    let location = (this.router as unknown as { location?: unknown }).location;
    return location && typeof location === 'object'
      ? (location as ReturnType<HostNavigationService['location']>)
      : undefined;
  }

  // An alias met while resolving a path. On the first load it replaces the
  // entry, as the server's 301 would; during an in-app navigation the
  // transition that met it never committed its entry, so the target takes
  // that new entry's place instead of the page the visitor came from.
  redirect(address: string) {
    this.visit(address, { replace: this.pendingNavigation !== 'push' });
  }

  // Whether an address is a page of this site the app can show in place.
  private isSiteAddress(url: URL): boolean {
    if (url.origin !== window.location.origin) {
      return false;
    }
    let mount = this.mount;
    if (mount && !`${url.pathname}/`.startsWith(mount)) {
      return false;
    }
    let last = url.pathname.split('/').pop() ?? '';
    // A file the site serves raw, and the realm's own endpoints.
    if (last.includes('.') || last.startsWith('_')) {
      return false;
    }
    return true;
  }

  // Catches clicks on anchors inside the site that nothing else handled, so
  // links in prose, Markdown and prerendered HTML navigate in place.
  install(root: Document | HTMLElement = document): () => void {
    let onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      let anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      if (
        (anchor.target && anchor.target !== '_self') ||
        anchor.hasAttribute('download')
      ) {
        return;
      }
      let url = new URL(anchor.href, window.location.href);
      let here = new URL(window.location.href);
      if (
        url.pathname === here.pathname &&
        url.search === here.search &&
        url.hash
      ) {
        // A place on this page: the browser scrolls to it.
        return;
      }
      if (!this.isSiteAddress(url)) {
        return;
      }
      event.preventDefault();
      this.visit(url.pathname + url.search + url.hash);
    };
    // Back and Forward change the entry before anything here runs, so the
    // position is kept as it changes rather than read on the way out.
    let onScroll = (event: Event) => {
      if (this.pendingNavigation) {
        return;
      }
      let target =
        event.target instanceof HTMLElement
          ? event.target
          : document.scrollingElement;
      if (target instanceof HTMLElement && target === this.scroller()) {
        this.scrollPositions.set(this.entryKey(), target.scrollTop);
      }
    };
    // Intent: a pointer resting on a site link, or focus reaching one.
    let intentTimer: ReturnType<typeof setTimeout> | undefined;
    let onIntent = (event: Event) => {
      let anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      let url = new URL(anchor.href, window.location.href);
      if (!this.isSiteAddress(url)) {
        return;
      }
      clearTimeout(intentTimer);
      intentTimer = setTimeout(
        () => this.prefetchAddress(url),
        event.type === 'focusin' ? 0 : INTENT_DELAY_MS,
      );
    };
    let onIntentEnd = () => clearTimeout(intentTimer);
    let onPopState = () => {
      this.pendingNavigation = 'traverse';
      // The entry's own query: the router may make no transition when only
      // an undeclared param differs, and then keeps its earlier URL.
      let foreign = new URLSearchParams(window.location.search);
      for (let key of HOST_APP_QUERY_PARAMS) {
        foreign.delete(key);
      }
      this.foreignSearch = foreign.size ? `?${foreign}` : '';
    };
    let onRouteChange = () => this.pageShown();
    root.addEventListener('click', onClick as EventListener);
    root.addEventListener('pointerover', onIntent);
    root.addEventListener('pointerout', onIntentEnd);
    root.addEventListener('focusin', onIntent);
    document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener('popstate', onPopState);
    this.router.on('routeDidChange', onRouteChange);
    try {
      if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
      }
    } catch {
      // not allowed here; the browser restores what it can
    }
    return () => {
      root.removeEventListener('click', onClick as EventListener);
      root.removeEventListener('pointerover', onIntent);
      root.removeEventListener('pointerout', onIntentEnd);
      root.removeEventListener('focusin', onIntent);
      clearTimeout(intentTimer);
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('popstate', onPopState);
      this.router.off('routeDidChange', onRouteChange);
    };
  }

  // Called once a transition lands: the model hook has loaded the page card.
  private pageShown() {
    let kind = this.pendingNavigation;
    this.pendingNavigation = undefined;
    if (!kind) {
      return;
    }
    scheduleOnce('afterRender', this, this.settle, kind);
  }

  private settle(kind: 'push' | 'traverse') {
    // One more frame, so the card's own content has laid out.
    next(() => {
      let scroller = this.scroller();
      let hash = this.pendingHash ?? window.location.hash.slice(1);
      if (this.pendingHash) {
        window.history.replaceState(
          window.history.state,
          '',
          `${window.location.pathname}${window.location.search}#${this.pendingHash}`,
        );
      }
      this.pendingHash = undefined;
      let anchor = hash
        ? document.getElementById(decodeURIComponent(hash))
        : null;
      if (anchor) {
        anchor.scrollIntoView();
      } else if (kind === 'traverse') {
        this.restoreScroll(this.scrollPositions.get(this.entryKey()) ?? 0);
      } else if (scroller) {
        scroller.scrollTop = 0;
      }
      this.updateHead();
      if (kind === 'push') {
        this.focusPage();
      }
    });
  }

  // The tags a shared link and a search engine read, for the page now
  // showing: the server writes them into the page a visitor first loads, and
  // they follow the visitor from there. The title is the page card's own.
  // Set while the site's not-found card is showing for an address that
  // serves nothing, which has no canonical form.
  showingNotFound = false;

  private updateHead() {
    let snapshot = this.snapshot;
    let path = this.sitePath?.split('?')[0];
    if (!snapshot || !path) {
      return;
    }
    if (this.showingNotFound) {
      for (let stale of document.head.querySelectorAll(
        'link[rel~="canonical"], meta[property="og:url"]',
      )) {
        stale.remove();
      }
      return;
    }
    let share: HostRouteShare = {};
    for (let entry of this.known().values()) {
      if (entry?.path === path) {
        share = entry.share ?? {};
        break;
      }
    }
    let mount = new URL(snapshot.mount, window.location.origin).href;
    let address = new URL(path.replace(/^\//, ''), mount).href;
    setHeadTag('link', 'rel', 'canonical', 'href', address);
    setHeadTag('meta', 'property', 'og:url', 'content', address);
    let tags: [string, string, string | undefined][] = [
      ['property', 'og:title', share.title],
      ['property', 'og:description', share.description],
      ['property', 'og:image', share.image],
      ['name', 'twitter:title', share.title],
      ['name', 'twitter:description', share.description],
      ['name', 'twitter:image', share.image],
    ];
    for (let [attribute, name, value] of tags) {
      if (value) {
        setHeadTag('meta', attribute, name, 'content', value);
      }
    }
  }

  // The page's main heading takes focus, so assistive tech announces the
  // new page the way a document load would.
  private focusPage() {
    let page =
      document.querySelector('[data-host-mode-page]') ??
      document.querySelector('[data-host-mode-primary]');
    let heading = page?.querySelector('h1') ?? page;
    if (heading instanceof HTMLElement) {
      if (!heading.hasAttribute('tabindex')) {
        heading.setAttribute('tabindex', '-1');
      }
      heading.focus({ preventScroll: true });
    }
  }

  // A page card's content may arrive a little after the transition: wait,
  // up to two seconds, until the page is tall enough to reach the position.
  private restoreScroll(top: number, frames = 40) {
    let scroller = this.scroller();
    if (scroller && scroller.scrollHeight - scroller.clientHeight >= top) {
      scroller.scrollTop = top;
      return;
    }
    if (frames > 0) {
      later(() => this.restoreScroll(top, frames - 1), 50);
    } else if (scroller) {
      scroller.scrollTop = top;
    }
  }

  // What scrolls the page: the host's scroll container, or, for a card that
  // lays itself out to the viewport and scrolls inside, the first element in
  // it that scrolls.
  private scroller(): HTMLElement | undefined {
    let page = document.querySelector('[data-host-mode-primary]');
    let candidates = [
      page?.querySelector('[data-host-mode-card-scroll-container]'),
      page,
      document.scrollingElement,
    ];
    for (let candidate of candidates) {
      if (candidate instanceof HTMLElement && scrolls(candidate)) {
        return candidate;
      }
    }
    if (!page) {
      return undefined;
    }
    let walker = document.createTreeWalker(page, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof HTMLElement && scrolls(node)) {
        return node;
      }
    }
    return undefined;
  }

  private entryKey(): string {
    let state = window.history.state as { uuid?: string } | null;
    return state?.uuid ?? window.location.href;
  }

  private saveScroll() {
    let scroller = this.scroller();
    if (scroller) {
      this.scrollPositions.set(this.entryKey(), scroller.scrollTop);
    }
  }
}

function setHeadTag(
  tag: 'link' | 'meta',
  keyAttribute: string,
  key: string,
  valueAttribute: string,
  value: string,
) {
  let element = document.head.querySelector(`${tag}[${keyAttribute}="${key}"]`);
  if (!element) {
    element = document.createElement(tag);
    element.setAttribute(keyAttribute, key);
    document.head.append(element);
  }
  element.setAttribute(valueAttribute, value);
}

function scrolls(element: HTMLElement): boolean {
  if (element.scrollHeight <= element.clientHeight) {
    return false;
  }
  if (element === document.scrollingElement) {
    return true;
  }
  let overflow = getComputedStyle(element).overflowY;
  return overflow === 'auto' || overflow === 'scroll';
}

function cardKey(url: string): string {
  let key = new URL(url);
  key.hash = '';
  key.search = '';
  return key.href.replace(/\.json$/, '');
}

declare module '@ember/service' {
  interface Registry {
    'host-navigation': HostNavigationService;
  }
}
