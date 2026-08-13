import {
  surfaceLayoutEvent,
  surfaceObserveEvent,
  surfacePresentationEvent,
  type SurfaceLayoutIntent,
  type SurfaceObserveIntent,
  type SurfacePresentationIntent,
} from '@cardstack/boxel-ui/surface';

import {
  BOXEL_SURFACE_PROTOCOL_VERSION,
  type SurfaceCapabilityRequest,
  type SurfaceCapabilityResponse,
  type SurfaceHandle,
  type SurfaceLayout,
  type SurfaceObservation,
  type SurfaceObservationNotification,
  type SurfacePresentation,
} from '@cardstack/runtime-common';

import type SurfaceService from '@cardstack/host/services/surface-service';

import type { SurfaceClient } from './surface-client';

interface PendingSurfaceRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

export const defaultSandboxSurfaceTimeoutMs = 10_000;

/** Child-side capability stub. It has no DOM or SurfaceService reference. */
export class SandboxSurfaceClient implements SurfaceClient {
  private nextRequest = 0;
  private pending = new Map<string, PendingSurfaceRequest>();
  private observers = new Set<(observation: SurfaceObservation) => void>();
  private closed = false;

  constructor(
    private readonly port: MessagePort,
    readonly handle: SurfaceHandle,
    private readonly timeoutMs = defaultSandboxSurfaceTimeoutMs,
  ) {
    port.addEventListener('message', this.receive);
    port.start();
  }

  present(presentation: SurfacePresentation): Promise<void> {
    return this.request({
      operation: 'present',
      presentation,
    });
  }

  layout(layout: SurfaceLayout): Promise<void> {
    return this.request({ operation: 'layout', layout });
  }

  observe(callback: (observation: SurfaceObservation) => void): () => void {
    let wasEmpty = this.observers.size === 0;
    this.observers.add(callback);
    if (wasEmpty) {
      void this.request({ operation: 'observe' }).catch((error) =>
        console.error('Sandbox Surface observation failed', error),
      );
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.observers.delete(callback);
      if (this.observers.size === 0 && !this.closed) {
        void this.request({ operation: 'unobserve' }).catch((error) =>
          console.error('Sandbox Surface observation cleanup failed', error),
        );
      }
    };
  }

  destroy(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.port.removeEventListener('message', this.receive);
    for (let pending of this.pending.values()) {
      if (pending.timeout !== undefined) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error('Sandbox Surface client was destroyed'));
    }
    this.pending.clear();
    this.observers.clear();
  }

  private request(
    body:
      | Pick<
          Extract<SurfaceCapabilityRequest, { operation: 'present' }>,
          'operation' | 'presentation'
        >
      | Pick<
          Extract<SurfaceCapabilityRequest, { operation: 'layout' }>,
          'operation' | 'layout'
        >
      | Pick<
          Extract<SurfaceCapabilityRequest, { operation: 'observe' }>,
          'operation'
        >
      | Pick<
          Extract<SurfaceCapabilityRequest, { operation: 'unobserve' }>,
          'operation'
        >,
  ): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Sandbox Surface client is closed'));
    }
    let requestId = `surface:${++this.nextRequest}`;
    let request = {
      kind: 'boxel-surface-request',
      protocolVersion: BOXEL_SURFACE_PROTOCOL_VERSION,
      requestId,
      surface: this.handle,
      ...body,
    } as SurfaceCapabilityRequest;
    return new Promise((resolve, reject) => {
      let timeout =
        this.timeoutMs > 0
          ? setTimeout(() => {
              if (!this.pending.delete(requestId)) {
                return;
              }
              reject(
                new Error(
                  `Sandbox Surface request timed out after ${this.timeoutMs}ms`,
                ),
              );
            }, this.timeoutMs)
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
    let message = event.data;
    if (isSurfaceResponse(message)) {
      let pending = this.pending.get(message.requestId);
      if (!pending) {
        return;
      }
      this.pending.delete(message.requestId);
      if (pending.timeout !== undefined) {
        clearTimeout(pending.timeout);
      }
      if (message.ok) {
        pending.resolve();
      } else {
        pending.reject(new Error(message.error ?? 'Surface request failed'));
      }
    } else if (
      isSurfaceObservation(message) &&
      message.surface === this.handle
    ) {
      for (let observer of this.observers) {
        observer(structuredClone(message.observation));
      }
    }
  };
}

/** Parent-side adapter that admits only the SurfaceHandle bound at bootstrap. */
export class SandboxSurfaceServer {
  private releaseObservation?: () => void;

  constructor(
    private readonly port: MessagePort,
    private readonly service: SurfaceService,
    readonly handle: SurfaceHandle,
  ) {
    port.addEventListener('message', this.receive);
    port.start();
  }

  destroy(): void {
    this.port.removeEventListener('message', this.receive);
    this.stopObserving();
  }

  private receive = (event: MessageEvent<unknown>) => {
    let request = event.data;
    if (!isSurfaceRequest(request)) {
      return;
    }
    let response: SurfaceCapabilityResponse = {
      kind: 'boxel-surface-response',
      protocolVersion: BOXEL_SURFACE_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: false,
    };
    try {
      if (request.surface !== this.handle) {
        throw new Error('Surface capability does not belong to this Sandbox');
      }
      if (request.operation === 'present') {
        this.service.present(this.handle, request.presentation);
      } else if (request.operation === 'layout') {
        this.service.layout(this.handle, request.layout);
      } else if (request.operation === 'observe') {
        this.startObserving();
      } else {
        this.stopObserving();
      }
      response.ok = true;
    } catch (error) {
      response.error = error instanceof Error ? error.message : String(error);
    }
    this.port.postMessage(response);
  };

  private startObserving(): void {
    if (this.releaseObservation) {
      return;
    }
    this.releaseObservation = this.service.observe(
      this.handle,
      (observation) => {
        let message: SurfaceObservationNotification = {
          kind: 'boxel-surface-observation',
          protocolVersion: BOXEL_SURFACE_PROTOCOL_VERSION,
          surface: this.handle,
          observation,
        };
        this.port.postMessage(message);
      },
    );
  }

  private stopObserving(): void {
    this.releaseObservation?.();
    this.releaseObservation = undefined;
  }
}

function isSurfaceRequest(value: unknown): value is SurfaceCapabilityRequest {
  if (!hasEnvelope(value, 'boxel-surface-request')) {
    return false;
  }
  return (
    typeof value.surface === 'string' &&
    (value.operation === 'present' ||
      value.operation === 'layout' ||
      value.operation === 'observe' ||
      value.operation === 'unobserve')
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isSurfaceResponse(value: unknown): value is SurfaceCapabilityResponse {
  return (
    hasEnvelope(value, 'boxel-surface-response') &&
    typeof value.ok === 'boolean'
  );
}

function isSurfaceObservation(
  value: unknown,
): value is SurfaceObservationNotification {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'boxel-surface-observation' &&
    'protocolVersion' in value &&
    value.protocolVersion === BOXEL_SURFACE_PROTOCOL_VERSION &&
    'surface' in value &&
    typeof value.surface === 'string' &&
    'observation' in value &&
    typeof value.observation === 'object' &&
    value.observation !== null
  );
}

function hasEnvelope(
  value: unknown,
  kind: string,
): value is Record<string, unknown> & {
  kind: string;
  protocolVersion: number;
  requestId: string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === kind &&
    'protocolVersion' in value &&
    value.protocolVersion === BOXEL_SURFACE_PROTOCOL_VERSION &&
    'requestId' in value &&
    typeof value.requestId === 'string'
  );
}

/**
 * Bind trusted `surface*` modifiers in the child document to the private
 * capability port. The authored component sees only the portable modifiers;
 * this adapter, not authored code, knows that rendering happens in an iframe.
 */
export function connectSandboxSurface(
  element: HTMLElement,
  client: SandboxSurfaceClient,
  onError: (error: Error) => void,
): () => void {
  let present = (event: Event) => {
    event.stopPropagation();
    void client
      .present((event as CustomEvent<SurfacePresentationIntent>).detail)
      .catch(onError);
  };
  let layout = (event: Event) => {
    event.stopPropagation();
    void client
      .layout((event as CustomEvent<SurfaceLayoutIntent>).detail)
      .catch(onError);
  };
  let observe = (event: Event) => {
    event.stopPropagation();
    let intent = (event as CustomEvent<SurfaceObserveIntent>).detail;
    intent.connected(client.observe(intent.callback));
  };
  element.addEventListener(surfacePresentationEvent, present);
  element.addEventListener(surfaceLayoutEvent, layout);
  element.addEventListener(surfaceObserveEvent, observe);
  return () => {
    element.removeEventListener(surfacePresentationEvent, present);
    element.removeEventListener(surfaceLayoutEvent, layout);
    element.removeEventListener(surfaceObserveEvent, observe);
  };
}
