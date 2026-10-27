// Hand-written types for the vendored bundle in this directory, so a host or
// catalog card that imports Lightbox type-checks. Only what Pret UI uses.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PhotoSwipeUIElement {
  name: string;
  order?: number;
  isButton?: boolean;
  appendTo?: 'root' | 'bar' | 'wrapper';
  onInit?: (element: HTMLElement, pswp: PhotoSwipe) => void;
}

export declare class PhotoSwipe {
  currIndex: number;
  ui?: { registerElement(element: PhotoSwipeUIElement): void };
  on(event: string, handler: (...args: any[]) => void): void;
}

export declare class PhotoSwipeLightbox {
  constructor(options: Record<string, unknown>);
  pswp?: PhotoSwipe;
  on(event: string, handler: (...args: any[]) => void): void;
  init(): void;
  destroy(): void;
}
