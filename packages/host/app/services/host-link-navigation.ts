import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { cancel, later, schedule } from '@ember/runloop';
import Service, { service } from '@ember/service';

import window from 'ember-window-mock';

import {
  isCardInstance,
  isRedirectRoutingRule,
  logger,
} from '@cardstack/runtime-common';

import type HostModeService from './host-mode-service';
import type HostRouteLinksService from './host-route-links';
import type StoreService from './store';

const log = logger('host-link-navigation');

// How long the pointer or the focus stays on a link before the app loads
// what a click on it needs, so a pointer that only crosses a list of links
// loads nothing.
const PREFETCH_DELAY_MS = 80;

// A link the app can follow without a page load.
interface SiteLink {
  // The link's URL.
  href: string;
  // The path the index route takes for it.
  path: string;
}

// Where a link leads. `app`: the app shows the page, and `cardHref` is the
// card the path opens when that is already known. `leave`: the browser
// loads the link's URL.
type Destination = { kind: 'app'; cardHref?: string } | { kind: 'leave' };

const LEAVE: Destination = { kind: 'leave' };

// On a page served on a host URL, follows a click on a link to another page
// of the site inside the app, with no page load. One set of listeners on
// the document serves every link, so a card needs nothing but an ordinary
// `<a href>`: the `hrefTo` helper's links, and links written by hand.
//
// A click is taken over only when the browser would have used it to load a
// page of this site in this tab. Everything else keeps the browser's
// default: a click another handler dealt with, a click with a modifier key
// or another button, a link with `target` or `download`, a link outside the
// site, a link with a query string or a fragment, and a link to a file.
//
// Where a link leads is worked out once for each address, when the link is
// hovered or focused, or else when it is clicked:
//
// - A fixed route's path is the route's. A redirect is left to the browser,
//   so the server answers it.
// - Any other path goes through the realm's dynamic routes, with the same
//   lookups the index route runs, and then loads as a card's own path. That
//   includes an address the `hrefTo` helper made: where more than one card
//   has the same value, the address opens the card a page load of it serves,
//   not the card the link was made for (ADR 036 §1.4).
//
// The card is loaded before the navigation starts. When the path resolves to
// a card, the index route is told which, so it runs no lookup. When it
// resolves to anything else (a redirect, a failed lookup, a file, nothing),
// the browser loads the link's URL and the server answers as it does for
// any request, so the visitor never lands on a page the app could not
// build.
//
// What is worked out is kept only while the visitor stays on the page, as
// are the cards the helper's links were made for. A link whose lookup
// failed, or whose destination couldn't be worked out, is not kept: a click
// on it now is left to the browser, and the next hover or click tries
// again.
export default class HostLinkNavigationService extends Service {
  @service declare private hostModeService: HostModeService;
  @service('host-route-links')
  declare private hostRouteLinks: HostRouteLinksService;
  @service declare private router: RouterService;
  @service declare private store: StoreService;

  private destinations = new Map<string, Promise<Destination>>();
  // The link the pointer or the focus rests on, until its delay ends.
  private intent: { href: string; timer: ReturnType<typeof later> } | undefined;
  // Counts the clicks taken over and the pages left, so a click that
  // another click or a move to another page follows before it navigates is
  // dropped.
  private follows = 0;
  private installs = 0;

  // Starts listening, and returns the function that stops it.
  install(): () => void {
    if (this.installs++ === 0) {
      document.addEventListener('click', this.onClick);
      document.addEventListener('mouseover', this.onLinkIntent);
      document.addEventListener('focusin', this.onLinkIntent);
      this.router.on('routeDidChange', this.onRouteDidChange);
    }
    let installed = true;
    return () => {
      if (!installed) {
        return;
      }
      installed = false;
      if (--this.installs === 0) {
        this.uninstall();
      }
    };
  }

  willDestroy() {
    if (this.installs > 0) {
      this.installs = 0;
      this.uninstall();
    }
    super.willDestroy();
  }

  private uninstall() {
    document.removeEventListener('click', this.onClick);
    document.removeEventListener('mouseover', this.onLinkIntent);
    document.removeEventListener('focusin', this.onLinkIntent);
    this.router.off('routeDidChange', this.onRouteDidChange);
    this.cancelIntent();
    this.forgetPage();
  }

  private forgetPage() {
    this.destinations.clear();
    this.hostRouteLinks.forgetLinkedCards();
  }

  // The visitor has left the page once a transition to another path is
  // done. A transition that is aborted or fails leaves the visitor on the
  // page, with its links, so nothing is forgotten before then. A change to
  // the stack of cards open on the page keeps the path. A click still
  // waiting for its destination is dropped, so it can't take the visitor
  // away from the page they went to.
  private onRouteDidChange = (transition: Transition) => {
    if (pageOf(transition.from) !== pageOf(transition.to)) {
      this.follows++;
      this.cancelIntent();
      this.forgetPage();
    }
  };

  // A keyboard activation of a link arrives as a click too.
  private onClick = (event: MouseEvent) => {
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
    let link = this.siteLink(event);
    if (!link) {
      return;
    }
    event.preventDefault();
    this.cancelIntent();
    void this.follow(link);
  };

  private onLinkIntent = (event: Event) => {
    let link = this.siteLink(event);
    if (!link) {
      this.cancelIntent();
      return;
    }
    if (this.intent?.href === link.href || this.destinations.has(link.href)) {
      return;
    }
    this.cancelIntent();
    let timer = later(() => {
      this.intent = undefined;
      void this.destination(link!);
    }, PREFETCH_DELAY_MS);
    this.intent = { href: link.href, timer };
  };

  private cancelIntent() {
    if (this.intent) {
      cancel(this.intent.timer);
      this.intent = undefined;
    }
  }

  // The link an event happened on, when a plain click on it would load a
  // page of this site in this tab.
  private siteLink(event: Event): SiteLink | undefined {
    if (!this.hostModeService.isActive) {
      return undefined;
    }
    let origin = event.composedPath()[0] ?? event.target;
    if (!(origin instanceof Element)) {
      return undefined;
    }
    let anchor = origin.closest('a[href]');
    if (
      !(anchor instanceof HTMLAnchorElement) ||
      anchor.hasAttribute('download') ||
      anchor.isContentEditable
    ) {
      return undefined;
    }
    let target = anchor.target.toLowerCase();
    if (target && target !== '_self') {
      return undefined;
    }
    let url: URL;
    try {
      url = new URL(anchor.href);
    } catch {
      return undefined;
    }
    // A query string is left to the browser because the app's router keeps
    // only its own query parameters, and a card may read the others. A
    // fragment is left to it because the browser scrolls to it.
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.href.includes('?') ||
      url.href.includes('#')
    ) {
      return undefined;
    }
    let path = this.hostModeService.sitePath(url);
    if (path === undefined) {
      return undefined;
    }
    let link = { href: url.href, path };
    if (
      namesFile(path) &&
      !this.hostRouteLinks.linkedCard(link.href) &&
      !this.hostModeService.fixedRoutingRule(path || '/')
    ) {
      return undefined;
    }
    return link;
  }

  // Never rejects: a link whose destination can't be worked out is left to
  // the browser. That answer is not kept, so the next hover or click on the
  // link works it out again.
  private destination(link: SiteLink): Promise<Destination> {
    let held = this.destinations.get(link.href);
    if (held) {
      return held;
    }
    let destination: Promise<Destination> = this.findDestination(link).catch(
      (e: unknown) => {
        log.debug(`could not work out where ${link.href} leads: ${String(e)}`);
        if (this.destinations.get(link.href) === destination) {
          this.destinations.delete(link.href);
        }
        return LEAVE;
      },
    );
    this.destinations.set(link.href, destination);
    return destination;
  }

  private async findDestination(link: SiteLink): Promise<Destination> {
    let rule = this.hostModeService.fixedRoutingRule(link.path || '/');
    if (rule) {
      if (isRedirectRoutingRule(rule)) {
        return LEAVE;
      }
      // As for a dynamic route: a card that can't be loaded is left to the
      // browser, so the server answers.
      let card = await this.store.get(rule.id);
      return isCardInstance(card) ? { kind: 'app' } : LEAVE;
    }
    // Even for an address a link was made for: the path opens the card the
    // routes resolve it to, as a page load of the address does.
    let routed = await this.hostModeService.lookUpDynamicRoutedPath(link.path);
    let cardHref: string;
    if (routed?.kind === 'card') {
      cardHref = routed.cardHref;
    } else if (routed?.kind === 'error') {
      // A lookup that failed may pass when tried again.
      throw routed.error;
    } else if (routed) {
      return LEAVE;
    } else {
      // No route serves the path, so it is a card's own path or nothing.
      // When Host Mode v2 lands, build the card's URL from the realm's
      // URL + path instead, because a card's id is always on the realm's
      // URL. Until then a site is served at its realm's URL, so the
      // page's origin + path is the card's URL.
      cardHref = `${this.hostModeService.hostModeOrigin}/${link.path}`;
    }
    let card = await this.store.get(cardHref);
    return isCardInstance(card) ? { kind: 'app', cardHref } : LEAVE;
  }

  private async follow(link: SiteLink): Promise<void> {
    let follow = ++this.follows;
    let destination = await this.destination(link);
    if (follow !== this.follows || this.isDestroying || this.isDestroyed) {
      return;
    }
    if (destination.kind === 'leave') {
      window.location.assign(link.href);
      return;
    }
    let navigationEnded = destination.cardHref
      ? this.hostModeService.followLink(link.path, destination.cardHref)
      : undefined;
    try {
      await this.router.transitionTo(this.appURL(link.path));
    } catch (e) {
      // Another navigation took this one's place, or the page shows its
      // error state.
      log.debug(`navigation to ${link.href} did not finish: ${String(e)}`);
      return;
    } finally {
      navigationEnded?.();
    }
    this.landOnPage();
  }

  // The URL the router takes for a path of the site. Going by URL gives the
  // index route the same path as a page load of the address does.
  private appURL(path: string): string {
    let { hostModeService } = this;
    let simulated = hostModeService.simulatingHostMode
      ? `?hostModeOrigin=${encodeURIComponent(
          hostModeService.hostModeOrigin ?? '',
        )}`
      : '';
    return `/${path}${simulated}`;
  }

  // A page that was navigated to starts at its top, and focus moves to it,
  // as after a page load: a keyboard user continues from the top of the new
  // page, and a screen reader reads from there.
  private landOnPage() {
    schedule('afterRender', () => {
      window.scrollTo(0, 0);
      let page = document.querySelector('[data-host-mode-primary-card]');
      if (!(page instanceof HTMLElement)) {
        return;
      }
      page.scrollTop = 0;
      let scroller = page.querySelector(
        '[data-host-mode-card-scroll-container]',
      );
      if (scroller) {
        scroller.scrollTop = 0;
      }
      // Focusable only for this move, so the page gains no tab stop.
      if (!page.hasAttribute('tabindex')) {
        page.setAttribute('tabindex', '-1');
        page.addEventListener('blur', () => page.removeAttribute('tabindex'), {
          once: true,
        });
      }
      page.focus({ preventScroll: true });
    });
  }
}

// What tells one page of the site from another: the index route's path.
function pageOf(
  route: { name: string; params?: unknown } | null | undefined | void,
): string {
  if (!route) {
    return '';
  }
  let path = (route.params as { path?: unknown } | undefined)?.path;
  return `${route.name}:${typeof path === 'string' ? path : ''}`;
}

// Whether a path's last segment has a file extension. A card's own path has
// none, and a routed address that has one is told from a file by the link
// the `hrefTo` helper made for it on this page.
function namesFile(path: string): boolean {
  let last = path.replace(/\/+$/, '').split('/').pop() ?? '';
  return last.includes('.');
}

declare module '@ember/service' {
  interface Registry {
    'host-link-navigation': HostLinkNavigationService;
  }
}
