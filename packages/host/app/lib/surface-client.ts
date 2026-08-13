import type {
  SurfaceLayout,
  SurfaceObservation,
  SurfacePresentation,
} from '@cardstack/runtime-common';

/**
 * The tier-neutral shape of a mounted surface's capability calls. Direct and
 * Capsule dispatch to the Host SurfaceService through the surface-element
 * modifier; Sandbox implements this interface over its private MessageChannel.
 */
export interface SurfaceClient {
  present(presentation: SurfacePresentation): Promise<void>;
  layout(layout: SurfaceLayout): Promise<void>;
  observe(callback: (observation: SurfaceObservation) => void): () => void;
}
