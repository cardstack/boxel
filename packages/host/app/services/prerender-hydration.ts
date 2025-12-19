import Service from '@ember/service';

export default class PrerenderHydrationService extends Service {
  private startMarker: Element | undefined;
  private endMarker: Element | undefined;
  private prerenderCardURL: string | undefined;
  private consumed = false;
  private markersInitialized = false;

  hasMarkupFor(cardURL: string | null | undefined): boolean {
    this.ensureMarkers();

    if (
      this.consumed ||
      !cardURL ||
      !this.startMarker ||
      !this.endMarker ||
      !this.prerenderCardURL
    ) {
      return false;
    }

    return this.normalizeCardURL(cardURL) === this.prerenderCardURL;
  }

  consume(element: Element, cardURL: string | null | undefined): boolean {
    this.ensureMarkers();

    if (!this.hasMarkupFor(cardURL)) {
      return false;
    }

    let fragment = this.extractFragment();

    if (!fragment) {
      return false;
    }

    element.replaceChildren(fragment);
    element.setAttribute('data-boxel-prerender-hydrated', 'true');
    this.clearMarkers();
    this.consumed = true;

    return true;
  }

  discard() {
    this.ensureMarkers();

    if (!this.startMarker || !this.endMarker) {
      return;
    }

    for (
      let node = this.startMarker.nextSibling;
      node && node !== this.endMarker;
    ) {
      let next = node.nextSibling;
      node.parentNode?.removeChild(node);
      node = next;
    }

    this.clearMarkers();
    this.consumed = true;
  }

  private extractFragment(): DocumentFragment | null {
    if (!this.startMarker || !this.endMarker) {
      return null;
    }

    let fragment = document.createDocumentFragment();

    for (
      let node = this.startMarker.nextSibling;
      node && node !== this.endMarker;
    ) {
      let next = node.nextSibling;
      fragment.appendChild(node);
      node = next;
    }

    return fragment;
  }

  private ensureMarkers() {
    if (this.markersInitialized) {
      return;
    }

    if (typeof document === 'undefined') {
      this.markersInitialized = true;
      return;
    }

    this.startMarker =
      document.querySelector('[data-boxel-prerender-start]') ?? undefined;
    this.endMarker =
      document.querySelector('[data-boxel-prerender-end]') ?? undefined;

    if (this.startMarker && this.endMarker) {
      let cardElement = this.findCardElement();
      let cardURL = cardElement?.getAttribute('data-card-url') ?? undefined;
      this.prerenderCardURL = cardURL
        ? this.normalizeCardURL(cardURL)
        : undefined;
    } else {
      this.startMarker = undefined;
      this.endMarker = undefined;
    }

    this.markersInitialized = true;
  }

  private clearMarkers() {
    let prerenderRoot =
      this.startMarker?.parentElement ?? this.endMarker?.parentElement;

    this.startMarker?.parentNode?.removeChild(this.startMarker);
    this.endMarker?.parentNode?.removeChild(this.endMarker);
    this.startMarker = undefined;
    this.endMarker = undefined;

    if (prerenderRoot && prerenderRoot.id === 'boxel-prerender-root') {
      prerenderRoot.remove();
    }
  }

  private findCardElement(): Element | null {
    if (!this.startMarker || !this.endMarker) {
      return null;
    }

    for (
      let node = this.startMarker.nextSibling;
      node && node !== this.endMarker;
      node = node.nextSibling
    ) {
      if (
        node instanceof Element &&
        node.hasAttribute('data-boxel-prerender-card')
      ) {
        return node;
      }
    }

    return null;
  }

  private normalizeCardURL(cardURL: string): string {
    return cardURL
      .replace(/\?.*/, '')
      .replace(/#.*$/, '')
      .replace(/\.json$/, '')
      .replace(/\/$/, '');
  }
}

declare module '@ember/service' {
  interface Registry {
    'prerender-hydration': PrerenderHydrationService;
  }
}
