import { scheduleOnce } from '@ember/runloop';

export interface RealmIframeDimensions {
  width: number;
  height: number;
}

// Renderer-owned equivalent of Conductor's height capability. It measures the
// child document rather than a card-owned element, so FieldDefs do not need a
// resize API and cannot gain a reference to the host document.
export default class RealmIframeHeightService {
  private resizeObserver?: ResizeObserver;
  private mutationObserver?: MutationObserver;
  private scheduled = false;
  private stopped = true;
  private previous?: RealmIframeDimensions;

  constructor(
    private element: HTMLElement,
    private report: (dimensions: RealmIframeDimensions) => void,
  ) {}

  start() {
    this.stopped = false;
    this.resizeObserver = new ResizeObserver(this.schedule);
    this.resizeObserver.observe(this.element);
    this.resizeObserver.observe(document.documentElement);
    if (document.body) {
      this.resizeObserver.observe(document.body);
    }
    this.mutationObserver = new MutationObserver(this.schedule);
    this.mutationObserver.observe(this.element, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    globalThis.addEventListener('resize', this.schedule);
    document.fonts?.ready.then(this.schedule).catch(() => undefined);
    this.schedule();
  }

  stop() {
    this.stopped = true;
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    globalThis.removeEventListener('resize', this.schedule);
  }

  private schedule = () => {
    if (this.scheduled || this.stopped) {
      return;
    }
    this.scheduled = true;
    scheduleOnce('afterRender', this, this.measureAndReport);
  };

  private measureAndReport = () => {
    this.scheduled = false;
    if (this.stopped) {
      return;
    }
    let dimensions = this.measure();
    if (
      dimensions.width !== this.previous?.width ||
      dimensions.height !== this.previous?.height
    ) {
      this.previous = dimensions;
      this.report(dimensions);
    }
  };

  private measure(): RealmIframeDimensions {
    let root = document.documentElement;
    let body = document.body;
    return {
      width: Math.ceil(
        Math.max(
          this.element.scrollWidth,
          root.scrollWidth,
          body?.scrollWidth ?? 0,
        ),
      ),
      height: Math.ceil(
        Math.max(
          this.element.scrollHeight,
          root.scrollHeight,
          body?.scrollHeight ?? 0,
        ),
      ),
    };
  }
}
