type MediaFetch = (url: string) => Promise<Response>;

const networkProtocols = new Set(['http:', 'https:']);

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
  private objectURLByImage = new Map<HTMLImageElement, string>();

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
    for (let objectURL of this.objectURLByImage.values()) {
      URL.revokeObjectURL(objectURL);
    }
    this.objectURLByImage.clear();
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
      for (let image of node.querySelectorAll('img[src]')) {
        hydrations.push(this.hydrateImage(image as HTMLImageElement));
      }
    }
    return hydrations;
  }

  private hydrateImage(image: HTMLImageElement): Promise<void> {
    let authoredSource = image.getAttribute('src');
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
    // Do not let the browser race the bounded Host fetch with an
    // unauthenticated request relative to the iframe route. Some card
    // components intentionally turn an image error into a permanent
    // label-only fallback; once that handler fires, a later blob URL cannot
    // recover the image.
    image.removeAttribute('src');
    let generation = {};
    this.generationByImage.set(image, generation);
    let hydration = this.fetchMedia(sourceURL.href)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Sandbox media ${sourceURL.href} returned ${response.status}`,
          );
        }
        let blob = await response.blob();
        if (
          this.generationByImage.get(image) !== generation ||
          !image.isConnected
        ) {
          return;
        }
        let previousObjectURL = this.objectURLByImage.get(image);
        if (previousObjectURL) {
          URL.revokeObjectURL(previousObjectURL);
        }
        let objectURL = URL.createObjectURL(blob);
        this.objectURLByImage.set(image, objectURL);
        image.src = objectURL;
      })
      .catch((error) => {
        console.error('Sandbox media bridge failed', error);
        // Keep the authored URL in place for a public resource. An allowed
        // private Realm asset is replaced above; a denied URL gains no Host
        // credential or error detail through this compatibility shim.
        if (
          this.generationByImage.get(image) === generation &&
          image.isConnected
        ) {
          image.src = authoredSource;
        }
      });
    this.hydrationByImage.set(image, hydration);
    return hydration;
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
