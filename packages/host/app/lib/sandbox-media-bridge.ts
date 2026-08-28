type MediaFetch = (url: string) => Promise<Response>;

const networkProtocols = new Set(['http:', 'https:']);
const protectedSourceAttribute = 'data-boxel-media-source';

/**
 * Remove declarative network reads while prerendered HTML is still detached.
 * The media bridge restores them only after the Host's bounded authenticated
 * read succeeds, so a placeholder can never race an unauthenticated browser
 * request with its live Sandbox rendering.
 */
export function protectSandboxMediaSources(root: ParentNode): void {
  for (let image of root.querySelectorAll('img[src]')) {
    let source = image.getAttribute('src');
    if (!source || source.startsWith('blob:') || source.startsWith('data:')) {
      continue;
    }
    image.setAttribute(protectedSourceAttribute, source);
    image.removeAttribute('src');
  }
}

/**
 * Declarative media does not call the Sandbox Loader's fetch — an authored
 * `<img>` issues an ordinary browser request, and in a credentialless
 * iframe that request loses the user's Realm authorization even though the
 * module graph itself loaded correctly (main renders the same `<img>`
 * in-document with the browser session; this restores exactly that).
 *
 * This Host-owned child helper discovers image elements under the render
 * root and resolves them through the bounded media lane of the Sandbox
 * fetch channel (`SandboxFetchClient.fetchMedia` → the parent's
 * `respondMedia`, which enforces GET + image/* + the size cap). Authored
 * code never receives the capability or the authenticated response — it
 * only ever observes its own `<img>` gaining a blob URL.
 *
 * Ported from the frozen branch's RealmIframeMediaBridge.
 */
export default class SandboxMediaBridge {
  private observer?: MutationObserver;
  private sourceByImage = new WeakMap<HTMLImageElement, string>();
  private hydrationByImage = new WeakMap<HTMLImageElement, Promise<void>>();
  private generationByImage = new WeakMap<HTMLImageElement, object>();
  /**
   * Blob URLs cached by RESOLVED source href for this bridge's lifetime —
   * a re-rendered card recreates its `<img>` elements, and without the
   * cache each recreation would strip the src and wait a full authorized
   * round-trip again: a visible blink on every update (rehydration
   * continuity, RP-20.4). A cache hit hydrates synchronously. Shared by
   * every image with the same source (a grid of identical logos fetches
   * once), revoked only at stop().
   */
  private objectURLByHref = new Map<string, string>();
  private inFlightByHref = new Map<string, Promise<string>>();

  constructor(
    private root: HTMLElement,
    private fetchMedia: MediaFetch,
  ) {}

  start() {
    if (this.observer) {
      return;
    }
    this.root.dataset.boxelSandboxMediaBridge = 'active';
    this.observer = new MutationObserver((records) => {
      for (let record of records) {
        if (record.type === 'attributes') {
          void Promise.all(this.hydrateNode(record.target));
          continue;
        }
        for (let node of record.addedNodes) {
          void Promise.all(this.hydrateNode(node));
        }
      }
    });
    this.observer.observe(this.root, {
      attributes: true,
      attributeFilter: ['src'],
      childList: true,
      subtree: true,
    });
    void this.refresh();
  }

  async refresh() {
    await Promise.all(this.hydrateNode(this.root));
  }

  stop() {
    this.observer?.disconnect();
    this.observer = undefined;
    for (let objectURL of this.objectURLByHref.values()) {
      URL.revokeObjectURL(objectURL);
    }
    this.objectURLByHref.clear();
    this.inFlightByHref.clear();
  }

  private hydrateNode(node: Node): Promise<void>[] {
    let hydrations: Promise<void>[] = [];
    let view = this.root.ownerDocument.defaultView;
    if (!view) {
      return hydrations;
    }
    if (node instanceof view.HTMLImageElement) {
      hydrations.push(this.hydrateImage(node as HTMLImageElement));
    }
    if (node instanceof view.Element) {
      for (let image of node.querySelectorAll(
        `img[src], img[${protectedSourceAttribute}]`,
      )) {
        hydrations.push(this.hydrateImage(image as HTMLImageElement));
      }
    }
    return hydrations;
  }

  private hydrateImage(image: HTMLImageElement): Promise<void> {
    let authoredSource =
      image.getAttribute('src') ?? image.getAttribute(protectedSourceAttribute);
    if (!authoredSource || authoredSource.startsWith('blob:')) {
      return Promise.resolve();
    }
    let sourceURL: URL;
    try {
      sourceURL = new URL(authoredSource, this.mediaBaseURL(image));
    } catch {
      return Promise.resolve();
    }
    if (!networkProtocols.has(sourceURL.protocol)) {
      return Promise.resolve();
    }
    if (this.sourceByImage.get(image) === sourceURL.href) {
      return this.hydrationByImage.get(image) ?? Promise.resolve();
    }

    this.sourceByImage.set(image, sourceURL.href);
    image.removeAttribute(protectedSourceAttribute);
    // RP-20.4: an already-hydrated source swaps in synchronously — a
    // recreated image never blanks for a resource this bridge has.
    let cached = this.objectURLByHref.get(sourceURL.href);
    if (cached) {
      image.src = cached;
      return Promise.resolve();
    }
    // Do not let the browser race the bounded Host fetch with an
    // unauthenticated request relative to the iframe route. Some card
    // components intentionally turn an image error into a permanent
    // label-only fallback; once that handler fires, a later blob URL cannot
    // recover the image.
    image.removeAttribute('src');
    let generation = {};
    this.generationByImage.set(image, generation);
    let hydration = this.objectURLFor(sourceURL.href)
      .then((objectURL) => {
        if (
          this.generationByImage.get(image) !== generation ||
          !image.isConnected
        ) {
          return;
        }
        image.src = objectURL;
      })
      .catch((error) => {
        console.error('Sandbox media bridge failed', error);
        // Leave the source removed. Restoring an arbitrary authored URL would
        // turn the child document into an ambient image-request/egress lane
        // and bypass the exact projected-resource capability above.
        // Still reproduce the browser's ordinary failed-image contract. Base
        // image components use this signal to replace the element with their
        // established "Artwork unavailable" state. Dispatching the event
        // exposes no bytes, URL authority, or ambient network capability; it
        // only reports the failure of the bounded Host fetch the card asked
        // for. Guard it like the success leg so a stale request cannot mutate
        // a re-rendered image.
        if (
          this.generationByImage.get(image) === generation &&
          image.isConnected
        ) {
          let EventConstructor = image.ownerDocument.defaultView?.Event;
          if (EventConstructor) {
            image.dispatchEvent(new EventConstructor('error'));
          }
        }
      });
    this.hydrationByImage.set(image, hydration);
    return hydration;
  }

  /** One authorized fetch per source, shared by every interested image. */
  private objectURLFor(href: string): Promise<string> {
    let inFlight = this.inFlightByHref.get(href);
    if (inFlight) {
      return inFlight;
    }
    let fetching = this.fetchMedia(href)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Sandbox media ${href} returned ${response.status}`);
        }
        let blob = await response.blob();
        let objectURL = URL.createObjectURL(blob);
        this.objectURLByHref.set(href, objectURL);
        return objectURL;
      })
      .finally(() => {
        this.inFlightByHref.delete(href);
      });
    this.inFlightByHref.set(href, fetching);
    return fetching;
  }

  private mediaBaseURL(image: HTMLImageElement): string | undefined {
    // A linked card's URL fields are relative to that card instance, not
    // the root definition module that happened to render it. The render
    // chrome keeps the owning card ID on the nearest container, so preserve
    // that resource provenance when resolving declarative media. The
    // Host-side media lane still enforces the actual fetch policy; this
    // marker only supplies URL resolution context. With no owner marker,
    // only absolute authored URLs resolve — a relative URL against the
    // sandbox origin would be meaningless (and is exactly the 400s this
    // bridge exists to prevent).
    let owner = image.closest<HTMLElement>('[data-boxel-card-id]');
    let ownerURL = owner?.dataset.boxelCardId;
    if (ownerURL) {
      try {
        return new URL(ownerURL).href;
      } catch {
        // Fall through for malformed authored DOM.
      }
    }
    return undefined;
  }
}
