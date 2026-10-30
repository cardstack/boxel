import type RouterService from '@ember/routing/router-service';
import { later, next, scheduleOnce } from '@ember/runloop';
import Service, { service } from '@ember/service';

import {
  normalizeRoutingPath,
  type HostRouteSnapshot,
} from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import type HostModeService from './host-mode-service';
import type HostModeStateService from './host-mode-state-service';
import type { CardLinkTarget, Format } from '@cardstack/base/card-api';

// Navigation on a published site. A page has one address, its routed path
// under the site's mount, and moving between pages is an in-app transition:
// a link inside the site never loads a new document. Back and Forward are
// Ember's own HistoryLocation transitions; this service adds what a browser
// does for a document load and an SPA doesn't: catching link clicks,
// restoring scroll per history entry, and moving focus to the new page.

export default class HostNavigationService extends Service {
  @service declare private router: RouterService;
  @service declare private hostModeService: HostModeService;
  @service declare private hostModeStateService: HostModeStateService;

  private scrollPositions = new Map<string, number>();
  private pendingNavigation: 'push' | 'traverse' | undefined;
  private pendingHash: string | undefined;

  get snapshot(): HostRouteSnapshot | undefined {
    let snapshot = (config as { hostRouteSnapshot?: HostRouteSnapshot })
      .hostRouteSnapshot;
    return snapshot && Array.isArray(snapshot.pages) ? snapshot : undefined;
  }

  // The site's mount on this host, with a trailing slash.
  get mount(): string | undefined {
    return this.snapshot?.mount;
  }

  // The routed path of a card, realm-relative, from the snapshot.
  routedPathOf(cardURL: string): string | undefined {
    let key = cardKey(cardURL);
    return this.snapshot?.pages.find(([, card]) => cardKey(card) === key)?.[0];
  }

  // The card a realm-relative path serves, from the snapshot. A listing
  // serves the site's home card, which the server answers for.
  cardForPath(path: string): string | undefined {
    let normalized = normalizeRoutingPath(path);
    return this.snapshot?.pages.find(([p]) => p === normalized)?.[1];
  }

  aliasTarget(path: string): string | undefined {
    let normalized = normalizeRoutingPath(path);
    return this.snapshot?.aliases.find(([p]) => p === normalized)?.[1];
  }

  // What the snapshot says an address on this host serves, without asking
  // the server: a page's card, or an alias's target address. Undefined when
  // the snapshot doesn't hold the path (or the site sent none).
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
    let path = `/${pathname.slice(mount.length)}`;
    let card = this.cardForPath(path);
    if (card) {
      return { card };
    }
    let target = this.aliasTarget(path);
    if (target) {
      return { redirectTo: this.addressOf(target) };
    }
    return undefined;
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
    let exact = this.hostModeService.hostRoutingMap.find(
      (rule) => 'id' in rule && rule.id && cardKey(rule.id) === card,
    );
    if (exact) {
      return exact.path;
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

  // An in-app transition to an address on this site.
  visit(address: string, { replace = false }: { replace?: boolean } = {}) {
    this.saveScroll();
    this.pendingNavigation = 'push';
    // The router takes a path and query; the hash is applied once the page
    // has rendered.
    let [url, hash] = address.split('#');
    this.pendingHash = hash;
    if (replace) {
      this.router.replaceWith(url);
    } else {
      this.router.transitionTo(url);
    }
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
    let onPopState = () => {
      this.pendingNavigation = 'traverse';
    };
    let onRouteChange = () => this.pageShown();
    root.addEventListener('click', onClick as EventListener);
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
      if (kind === 'push') {
        this.focusPage();
      }
    });
  }

  // The page's main heading takes focus, so assistive tech announces the
  // new page the way a document load would.
  private focusPage() {
    let page = document.querySelector('[data-host-mode-primary]');
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
