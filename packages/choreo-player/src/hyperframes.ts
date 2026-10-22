export interface HyperframesFrameRenderer {
  renderAt(timeSeconds: number): PromiseLike<void> | void;
}

export interface HyperframesSeekDetail {
  time: number;
  waitUntil(operation: PromiseLike<void>): void;
}

/**
 * Bind an awaitable frame renderer to HyperFrames' native seek event.
 *
 * The renderer owns application-state reconstruction and must not resolve
 * until the requested frame is ready to capture. No HyperFrames package is
 * imported at runtime; this is only its browser event protocol.
 */
export function bindHyperframes(
  renderer: HyperframesFrameRenderer,
  target?: EventTarget,
): () => void {
  const eventTarget =
    target ?? (typeof window === 'undefined' ? undefined : window);
  if (!eventTarget) {
    throw new Error(
      'bindHyperframes() needs a browser window or an explicit EventTarget.',
    );
  }
  const listener: EventListener = (event) => {
    const detail = (event as CustomEvent<HyperframesSeekDetail>).detail;
    if (
      !detail ||
      !Number.isFinite(detail.time) ||
      typeof detail.waitUntil !== 'function'
    ) {
      return;
    }
    let operation: Promise<void>;
    try {
      operation = Promise.resolve(renderer.renderAt(detail.time));
    } catch (error) {
      operation = Promise.reject(error);
    }
    detail.waitUntil(operation);
  };

  eventTarget.addEventListener('hf-seek', listener);
  return () => eventTarget.removeEventListener('hf-seek', listener);
}
