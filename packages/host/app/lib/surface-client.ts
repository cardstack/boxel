import type {
  SurfaceHandle,
  SurfaceLayout,
  SurfaceObservation,
  SurfacePresentation,
} from '@cardstack/runtime-common';

import type SurfaceService from '@cardstack/host/services/surface-service';

export interface SurfaceClient {
  present(presentation: SurfacePresentation): Promise<void>;
  layout(layout: SurfaceLayout): Promise<void>;
  observe(callback: (observation: SurfaceObservation) => void): () => void;
}

/** Direct and Capsule target the same Host broker without a transport hop. */
export class LocalSurfaceClient implements SurfaceClient {
  constructor(
    private readonly surfaceService: SurfaceService,
    readonly handle: SurfaceHandle,
  ) {}

  async present(presentation: SurfacePresentation): Promise<void> {
    this.surfaceService.present(this.handle, presentation);
  }

  async layout(layout: SurfaceLayout): Promise<void> {
    this.surfaceService.layout(this.handle, layout);
  }

  observe(callback: (observation: SurfaceObservation) => void): () => void {
    return this.surfaceService.observe(this.handle, callback);
  }
}
