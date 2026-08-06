import {
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  assertBoxelExecutionTransportVersion,
  type BoxelInstanceHandle,
  type SandboxRenderRequest,
  type SandboxRenderResponse,
} from '@cardstack/runtime-common';

export interface SandboxRenderTarget {
  render(
    card: BoxelInstanceHandle,
    format: string,
    generation: number,
  ): void | Promise<void>;
  clear(generation: number): void | Promise<void>;
  /**
   * Sandbox HMR (RP-17.1 un-deferral): re-derive the currently rendered
   * card after `url`'s module has been invalidated and its draft source
   * admitted through the fetch channel's override — see
   * `SandboxRuntimeProcess`'s draft override map. `generation` is this
   * draft's echoed sequence number; the target should re-check it (via
   * `setStaleCheck`, if it registers one) after its own internal awaits so
   * a draft superseded mid-flight doesn't apply stale output.
   */
  draft(url: string, generation: number): void | Promise<void>;
  /**
   * Called once, right after this target's `SandboxRenderServer` is
   * constructed, with a live check against every generation the server has
   * SEEN ARRIVE — not just ones already dispatched through this target's
   * own serialized queue. A target's `render`/`draft` implementation can
   * call this after an internal await to bail out early once a newer
   * generation is already queued behind it, rather than finishing
   * pointless work only to have it immediately superseded (dossier:
   * "re-check generation post-await"). Optional: a target that never
   * awaits internally has nothing to gain from it.
   */
  setStaleCheck?(isStale: (generation: number) => boolean): void;
}

interface PendingRenderRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

// RP-15.3: silence after `render()` resolves is a protocol violation. A
// mounted iframe that never confirms its render (a hung module graph, a
// wedged runloop, a child that stops responding) must still fail the
// generation instead of leaving the placeholder slot blank forever with no
// error ever reaching the parent.
export const defaultSandboxRenderTimeoutMs = 10_000;

/** Parent-side controller for the DOM that remains owned by the child. */
export class SandboxRenderClient {
  private nextRequest = 0;
  private pending = new Map<string, PendingRenderRequest>();
  private closed = false;
  private readonly renderTimeoutMs: number;

  constructor(
    private readonly port: MessagePort,
    renderTimeoutMs = defaultSandboxRenderTimeoutMs,
  ) {
    this.renderTimeoutMs = renderTimeoutMs;
    port.addEventListener('message', this.receive);
    port.start();
  }

  render(
    card: BoxelInstanceHandle,
    format: string,
    generation: number,
  ): Promise<void> {
    return this.request({ operation: 'render', card, format, generation });
  }

  clear(generation: number): Promise<void> {
    return this.request({ operation: 'clear', generation });
  }

  /** Sandbox HMR — see `SandboxRenderTarget.draft`. */
  draft(url: string, generation: number): Promise<void> {
    return this.request({ operation: 'draft', url, generation });
  }

  /**
   * Fails every in-flight request without waiting out its timeout.
   *
   * Used when the Host learns by an out-of-band signal (a child-reported
   * runtime error) that the mounted render can never complete, so the
   * generation fails immediately instead of idling until the bounded
   * timeout above elapses.
   */
  failPending(error: Error): void {
    for (let [requestId, pending] of this.pending) {
      if (pending.timeout !== undefined) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
      this.pending.delete(requestId);
    }
  }

  destroy(reason = 'Sandbox render client was destroyed'): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.port.removeEventListener('message', this.receive);
    for (let pending of this.pending.values()) {
      if (pending.timeout !== undefined) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private request(
    body:
      | Pick<
          Extract<SandboxRenderRequest, { operation: 'render' }>,
          'operation' | 'card' | 'format' | 'generation'
        >
      | Pick<
          Extract<SandboxRenderRequest, { operation: 'clear' }>,
          'operation' | 'generation'
        >
      | Pick<
          Extract<SandboxRenderRequest, { operation: 'draft' }>,
          'operation' | 'url' | 'generation'
        >,
  ): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Sandbox render client is closed'));
    }
    let requestId = `render:${++this.nextRequest}`;
    let request = {
      kind: 'boxel-sandbox-render-request',
      transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
      requestId,
      ...body,
    } as SandboxRenderRequest;
    return new Promise((resolve, reject) => {
      let timeout =
        this.renderTimeoutMs > 0
          ? setTimeout(() => {
              if (!this.pending.delete(requestId)) {
                return;
              }
              reject(
                new Error(
                  `Sandbox ${body.operation} timed out after ${this.renderTimeoutMs}ms waiting for the child to confirm`,
                ),
              );
            }, this.renderTimeoutMs)
          : undefined;
      this.pending.set(requestId, { resolve, reject, timeout });
      try {
        this.port.postMessage(request);
      } catch (error) {
        if (this.pending.delete(requestId) && timeout !== undefined) {
          clearTimeout(timeout);
        }
        reject(asError(error));
      }
    });
  }

  private receive = (event: MessageEvent<unknown>) => {
    let response = event.data;
    if (!isSandboxRenderResponse(response)) {
      return;
    }
    try {
      assertBoxelExecutionTransportVersion(response.transportVersion);
    } catch (error) {
      this.failAll(asError(error));
      return;
    }
    let pending = this.pending.get(response.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(response.requestId);
    if (pending.timeout !== undefined) {
      clearTimeout(pending.timeout);
    }
    if (response.ok) {
      pending.resolve();
    } else {
      let error = new Error(response.error.message);
      error.name = response.error.name;
      pending.reject(error);
    }
  };

  private failAll(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.port.removeEventListener('message', this.receive);
    for (let pending of this.pending.values()) {
      if (pending.timeout !== undefined) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }
}

/** Marks a request that was never (or only partly) run because a newer
 * generation had already superseded it by dispatch time — distinct from a
 * genuine render/draft failure so the response can flag `dropped: true`. */
class SandboxGenerationSuperseded extends Error {
  constructor(generation: number, latest: number) {
    super(
      `Sandbox generation ${generation} was superseded by generation ${latest}`,
    );
    this.name = 'SandboxGenerationSuperseded';
  }
}

/**
 * Child-side serial dispatcher for one persistent rendered island.
 *
 * RP-17.1's HMR un-deferral: every request carries a monotonic `generation`
 * (see `SandboxRenderRequest`'s doc comment). This server tracks the
 * highest generation it has SEEN ARRIVE (updated the moment a message is
 * received, before it is even queued) and refuses to dispatch a queued
 * request whose generation has since been superseded — dossier step 2's
 * "drop generation <= latest on arrival." `setStaleCheck` exposes that same
 * live check to the target so it can also re-check after its own internal
 * awaits ("re-check generation post-await"), since a request already
 * dispatched keeps running to completion inside this server's serialized
 * queue regardless of what arrives after it.
 */
export class SandboxRenderServer {
  private closed = false;
  private queue = Promise.resolve();
  private latestGenerationSeen = -1;

  constructor(
    private readonly port: MessagePort,
    private readonly target: SandboxRenderTarget,
  ) {
    port.addEventListener('message', this.receive);
    port.start();
  }

  /** True once a strictly newer generation than `generation` has arrived. */
  isStale(generation: number): boolean {
    return generation < this.latestGenerationSeen;
  }

  destroy(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.port.removeEventListener('message', this.receive);
  }

  private receive = (event: MessageEvent<unknown>) => {
    let request = event.data;
    if (!isSandboxRenderRequest(request)) {
      return;
    }
    if (request.generation > this.latestGenerationSeen) {
      this.latestGenerationSeen = request.generation;
    }
    // MessagePort preserves order. Keep async template resolution ordered too,
    // so an older render cannot become visible after a newer selection.
    this.queue = this.queue
      .then(() => this.dispatch(request))
      .then(
        () => this.respond(request, { ok: true }),
        (error) =>
          this.respond(request, {
            ok: false,
            error: projectedError(error),
            ...(error instanceof SandboxGenerationSuperseded
              ? { dropped: true as const }
              : {}),
          }),
      );
  };

  private dispatch(request: SandboxRenderRequest): void | Promise<void> {
    assertBoxelExecutionTransportVersion(request.transportVersion);
    if (this.isStale(request.generation)) {
      throw new SandboxGenerationSuperseded(
        request.generation,
        this.latestGenerationSeen,
      );
    }
    switch (request.operation) {
      case 'render':
        return this.target.render(
          request.card,
          request.format,
          request.generation,
        );
      case 'clear':
        return this.target.clear(request.generation);
      case 'draft':
        return this.target.draft(request.url, request.generation);
    }
  }

  private respond(
    request: SandboxRenderRequest,
    result:
      | Pick<Extract<SandboxRenderResponse, { ok: true }>, 'ok'>
      | Pick<
          Extract<SandboxRenderResponse, { ok: false }>,
          'ok' | 'error' | 'dropped'
        >,
  ): void {
    if (this.closed) {
      return;
    }
    this.port.postMessage({
      kind: 'boxel-sandbox-render-response',
      transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
      requestId: request.requestId,
      generation: request.generation,
      ...result,
    } satisfies SandboxRenderResponse);
  }
}

// Bounded, non-negative integer: the wire's monotonic generation sequence
// number (see SandboxRenderRequest's doc comment). The upper bound is
// generous — Number.MAX_SAFE_INTEGER — since this is a defensive envelope
// check, not a realistic session-length limit.
function isValidGeneration(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

function isSandboxRenderRequest(value: unknown): value is SandboxRenderRequest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('kind' in value) ||
    value.kind !== 'boxel-sandbox-render-request' ||
    !('transportVersion' in value) ||
    typeof value.transportVersion !== 'number' ||
    !('requestId' in value) ||
    typeof value.requestId !== 'string' ||
    value.requestId.length === 0 ||
    value.requestId.length > 256 ||
    !('generation' in value) ||
    !isValidGeneration(value.generation) ||
    !('operation' in value)
  ) {
    return false;
  }
  return (
    value.operation === 'clear' ||
    (value.operation === 'render' &&
      'card' in value &&
      typeof value.card === 'string' &&
      'format' in value &&
      typeof value.format === 'string' &&
      value.format.length > 0 &&
      value.format.length <= 128) ||
    (value.operation === 'draft' &&
      'url' in value &&
      typeof value.url === 'string' &&
      value.url.length > 0 &&
      value.url.length <= 4096)
  );
}

function isSandboxRenderResponse(
  value: unknown,
): value is SandboxRenderResponse {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('kind' in value) ||
    value.kind !== 'boxel-sandbox-render-response' ||
    !('transportVersion' in value) ||
    typeof value.transportVersion !== 'number' ||
    !('requestId' in value) ||
    typeof value.requestId !== 'string' ||
    !('generation' in value) ||
    !isValidGeneration(value.generation) ||
    !('ok' in value) ||
    typeof value.ok !== 'boolean'
  ) {
    return false;
  }
  return (
    value.ok ||
    ('error' in value &&
      typeof value.error === 'object' &&
      value.error !== null &&
      'name' in value.error &&
      typeof value.error.name === 'string' &&
      'message' in value.error &&
      typeof value.error.message === 'string' &&
      (!('dropped' in value) || typeof value.dropped === 'boolean'))
  );
}

function projectedError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'SandboxRenderError', message: String(error) };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
