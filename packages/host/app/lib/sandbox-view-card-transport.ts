import {
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  assertBoxelExecutionTransportVersion,
  type SandboxViewCardRequest,
  type SandboxViewCardResponse,
} from '@cardstack/runtime-common';

import { projectedError, reconstructedError } from './sandbox-render-transport';

interface PendingRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

const defaultTimeoutMs = 10_000;
const fieldTypes = new Set([
  'linksTo',
  'contains',
  'containsMany',
  'linksToMany',
]);

export interface SandboxViewCardOptions {
  fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany';
  fieldName?: string;
}

/** Child-side, capability-scoped sender for a user-initiated card open. */
export class SandboxViewCardClient {
  private nextRequest = 0;
  private pending = new Map<string, PendingRequest>();
  private closed = false;

  constructor(
    private readonly port: MessagePort,
    private readonly timeoutMs = defaultTimeoutMs,
  ) {
    port.addEventListener('message', this.receive);
    port.start();
  }

  viewCard(
    cardId: string,
    format: string,
    options?: SandboxViewCardOptions,
  ): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Sandbox view-card client is closed'));
    }
    let requestId = `view-card:${++this.nextRequest}`;
    let request: SandboxViewCardRequest = {
      kind: 'boxel-sandbox-view-card-request',
      transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
      requestId,
      cardId,
      format,
      ...(options?.fieldType ? { fieldType: options.fieldType } : {}),
      ...(options?.fieldName ? { fieldName: options.fieldName } : {}),
    };
    return new Promise((resolve, reject) => {
      let timeout =
        this.timeoutMs > 0
          ? setTimeout(() => {
              if (this.pending.delete(requestId)) {
                reject(
                  new Error(
                    `Sandbox view-card request timed out after ${this.timeoutMs}ms`,
                  ),
                );
              }
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

  destroy(reason = 'Sandbox view-card client was destroyed'): void {
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

  private receive = (event: MessageEvent<unknown>) => {
    let response = event.data;
    if (!isResponse(response)) {
      return;
    }
    try {
      assertBoxelExecutionTransportVersion(response.transportVersion);
    } catch (error) {
      this.destroy(asError(error).message);
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
      pending.reject(reconstructedError(response.error));
    }
  };
}

/** Parent-side endpoint. All authority remains in the supplied callback. */
export class SandboxViewCardServer {
  private closed = false;

  constructor(
    private readonly port: MessagePort,
    private readonly open: (
      cardId: string,
      format: string,
      options?: SandboxViewCardOptions,
    ) => void | Promise<void>,
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
    if (!isRequest(request)) {
      return;
    }
    void Promise.resolve()
      .then(() => {
        assertBoxelExecutionTransportVersion(request.transportVersion);
        return this.open(request.cardId, request.format, {
          ...(request.fieldType ? { fieldType: request.fieldType } : {}),
          ...(request.fieldName ? { fieldName: request.fieldName } : {}),
        });
      })
      .then(
        () => this.respond(request, { ok: true }),
        (error) =>
          this.respond(request, {
            ok: false,
            error: projectedError(error),
          }),
      );
  };

  private respond(
    request: SandboxViewCardRequest,
    result:
      | { ok: true }
      | { ok: false; error: ReturnType<typeof projectedError> },
  ): void {
    if (this.closed) {
      return;
    }
    this.port.postMessage({
      kind: 'boxel-sandbox-view-card-response',
      transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
      requestId: request.requestId,
      ...result,
    } satisfies SandboxViewCardResponse);
  }
}

function isRequest(value: unknown): value is SandboxViewCardRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'boxel-sandbox-view-card-request' &&
    'transportVersion' in value &&
    typeof value.transportVersion === 'number' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    value.requestId.length > 0 &&
    value.requestId.length <= 256 &&
    'cardId' in value &&
    typeof value.cardId === 'string' &&
    value.cardId.length > 0 &&
    value.cardId.length <= 4096 &&
    'format' in value &&
    typeof value.format === 'string' &&
    value.format.length > 0 &&
    value.format.length <= 64 &&
    (!('fieldType' in value) ||
      (typeof value.fieldType === 'string' &&
        fieldTypes.has(value.fieldType))) &&
    (!('fieldName' in value) ||
      (typeof value.fieldName === 'string' && value.fieldName.length <= 256))
  );
}

function isResponse(value: unknown): value is SandboxViewCardResponse {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('kind' in value) ||
    value.kind !== 'boxel-sandbox-view-card-response' ||
    !('transportVersion' in value) ||
    typeof value.transportVersion !== 'number' ||
    !('requestId' in value) ||
    typeof value.requestId !== 'string' ||
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
      typeof value.error.message === 'string')
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
