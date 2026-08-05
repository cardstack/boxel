import {
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  assertBoxelExecutionTransportVersion,
  type BoxelInstanceHandle,
  type SandboxRenderRequest,
  type SandboxRenderResponse,
} from '@cardstack/runtime-common';

export interface SandboxRenderTarget {
  render(card: BoxelInstanceHandle, format: string): void | Promise<void>;
  clear(): void | Promise<void>;
}

interface PendingRenderRequest {
  resolve: () => void;
  reject: (error: Error) => void;
}

/** Parent-side controller for the DOM that remains owned by the child. */
export class SandboxRenderClient {
  private nextRequest = 0;
  private pending = new Map<string, PendingRenderRequest>();
  private closed = false;

  constructor(private readonly port: MessagePort) {
    port.addEventListener('message', this.receive);
    port.start();
  }

  render(card: BoxelInstanceHandle, format: string): Promise<void> {
    return this.request({ operation: 'render', card, format });
  }

  clear(): Promise<void> {
    return this.request({ operation: 'clear' });
  }

  destroy(reason = 'Sandbox render client was destroyed'): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.port.removeEventListener('message', this.receive);
    for (let pending of this.pending.values()) {
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private request(
    body:
      | Pick<
          Extract<SandboxRenderRequest, { operation: 'render' }>,
          'operation' | 'card' | 'format'
        >
      | Pick<
          Extract<SandboxRenderRequest, { operation: 'clear' }>,
          'operation'
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
      this.pending.set(requestId, { resolve, reject });
      try {
        this.port.postMessage(request);
      } catch (error) {
        this.pending.delete(requestId);
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
      pending.reject(error);
    }
    this.pending.clear();
  }
}

/** Child-side serial dispatcher for one persistent rendered island. */
export class SandboxRenderServer {
  private closed = false;
  private queue = Promise.resolve();

  constructor(
    private readonly port: MessagePort,
    private readonly target: SandboxRenderTarget,
  ) {
    port.addEventListener('message', this.receive);
    port.start();
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
          }),
      );
  };

  private dispatch(request: SandboxRenderRequest): void | Promise<void> {
    assertBoxelExecutionTransportVersion(request.transportVersion);
    return request.operation === 'render'
      ? this.target.render(request.card, request.format)
      : this.target.clear();
  }

  private respond(
    request: SandboxRenderRequest,
    result:
      | Pick<Extract<SandboxRenderResponse, { ok: true }>, 'ok'>
      | Pick<Extract<SandboxRenderResponse, { ok: false }>, 'ok' | 'error'>,
  ): void {
    if (this.closed) {
      return;
    }
    this.port.postMessage({
      kind: 'boxel-sandbox-render-response',
      transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
      requestId: request.requestId,
      ...result,
    } satisfies SandboxRenderResponse);
  }
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
      value.format.length <= 128)
  );
}

function isSandboxRenderResponse(
  value: unknown,
): value is SandboxRenderResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'boxel-sandbox-render-response' &&
    'transportVersion' in value &&
    typeof value.transportVersion === 'number' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    'ok' in value &&
    typeof value.ok === 'boolean' &&
    (value.ok ||
      ('error' in value &&
        typeof value.error === 'object' &&
        value.error !== null &&
        'name' in value.error &&
        typeof value.error.name === 'string' &&
        'message' in value.error &&
        typeof value.error.message === 'string'))
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
