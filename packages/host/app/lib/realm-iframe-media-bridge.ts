type CapabilityFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const networkProtocols = new Set(['http:', 'https:']);

// Declarative media does not call the detached Loader's fetch implementation.
// In a credentialless iframe an ordinary realm URL therefore loses the user's
// Realm authorization even though the module graph itself loaded correctly.
// This Host-owned child helper discovers image elements and resolves them
// through a dedicated, bounded MessageChannel media capability. It is not the
// Loader's executable-module capability: public media stays credentialless,
// while only assets in the card's own Realm may receive Realm authorization.
// Authored code never receives the capability or the authenticated response.
export default class RealmIframeMediaBridge {
  private observer?: MutationObserver;
  private sourceByImage = new WeakMap<HTMLImageElement, string>();
  private hydrationByImage = new WeakMap<HTMLImageElement, Promise<void>>();
  private generationByImage = new WeakMap<HTMLImageElement, object>();
  private objectURLByImage = new Map<HTMLImageElement, string>();

  constructor(
    private root: HTMLElement,
    private fetch: CapabilityFetch,
    private rootModuleURL: string,
  ) {}

  start() {
    if (this.observer) {
      return;
    }
    this.root.dataset.realmSandboxMediaBridge = 'active';
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
    if (!authoredSource) {
      return Promise.resolve();
    }
    let sourceURL: URL;
    try {
      sourceURL = new URL(authoredSource, this.rootModuleURL);
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
    let generation = {};
    this.generationByImage.set(image, generation);
    let hydration = this.fetch(sourceURL, {
      headers: { Accept: 'image/*' },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Realm image returned ${response.status}`);
        }
        let contentType = response.headers.get('content-type')?.toLowerCase();
        if (!contentType?.startsWith('image/')) {
          throw new Error('Realm image response was not an image');
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
        console.error('Realm iframe media bridge failed', error);
        // Keep the authored URL in place for a public resource. An allowed
        // private Realm asset is replaced above; a denied URL gains no Host
        // credential or error detail through this compatibility shim.
      });
    this.hydrationByImage.set(image, hydration);
    return hydration;
  }
}
