import {
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  assertBoxelExecutionTransportVersion,
  type LooseSingleCardDocument,
  type SandboxWriteRequest,
  type SandboxWriteResponse,
} from '@cardstack/runtime-common';

import { projectedError, reconstructedError } from './sandbox-render-transport';

interface PendingWriteRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

// Same rationale as the render transport's timeout (RP-15.3): silence after
// a write is posted is a protocol violation — a wedged parent must fail the
// child's awaiting sender instead of leaving it pending forever.
export const defaultSandboxWriteTimeoutMs = 10_000;

/**
 * Child-side sender for RP-20.6 instance writes — the reverse polarity of
 * `SandboxRenderClient` (there the parent requests and the child confirms;
 * here the child proposes and the parent confirms). One instance per
 * connection, multiplexed on the same private port as every other lane by
 * its own `kind` envelope.
 */
export class SandboxWriteClient {
  private nextRequest = 0;
  private nextSeq = 0;
  private pending = new Map<string, PendingWriteRequest>();
  private closed = false;
  private readonly writeTimeoutMs: number;

  constructor(
    private readonly port: MessagePort,
    writeTimeoutMs = defaultSandboxWriteTimeoutMs,
  ) {
    this.writeTimeoutMs = writeTimeoutMs;
    port.addEventListener('message', this.receive);
    port.start();
  }

  /**
   * Proposes `document` — the rendered instance's complete current state —
   * to the parent. Resolves once the parent has applied it (or rejects with
   * the parent's projected apply error). Seq numbering is issued here, at
   * send time, so callers that serialize their sends (the forwarder's
   * promise queue) get strictly increasing seqs on the wire for free.
   */
  write(document: LooseSingleCardDocument): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Sandbox write client is closed'));
    }
    let requestId = `write:${++this.nextRequest}`;
    let request: SandboxWriteRequest = {
      kind: 'boxel-sandbox-write-request',
      transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
      requestId,
      seq: ++this.nextSeq,
      document,
    };
    return new Promise((resolve, reject) => {
      let timeout =
        this.writeTimeoutMs > 0
          ? setTimeout(() => {
              if (!this.pending.delete(requestId)) {
                return;
              }
              reject(
                new Error(
                  `Sandbox write timed out after ${this.writeTimeoutMs}ms waiting for the parent to confirm`,
                ),
              );
            }, this.writeTimeoutMs)
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

  destroy(reason = 'Sandbox write client was destroyed'): void {
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
    if (!isSandboxWriteResponse(response)) {
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
    } else if (response.dropped) {
      // A drop means a newer write already carried this state — success from
      // the child's point of view, not an error to surface.
      pending.resolve();
    } else {
      pending.reject(reconstructedError(response.error));
    }
  };
}

/** Marks a write the parent chose not to apply because a newer seq already
 * had — distinct from a genuine apply failure so the response can flag
 * `dropped: true` (which the client resolves, not rejects). */
class SandboxWriteSuperseded extends Error {
  constructor(seq: number, latest: number) {
    super(`Sandbox write seq ${seq} was superseded by seq ${latest}`);
    this.name = 'SandboxWriteSuperseded';
  }
}

/**
 * Parent-side receiver for RP-20.6 instance writes. Applies serially (one
 * promise queue — a burst of writes lands in order, never interleaved) and
 * drops any request whose seq has already been passed. The `apply` callback
 * is where all authority lives: it validates the document's card identity
 * against the one canonical instance this connection is entitled to write,
 * applies it, and schedules persistence — see
 * `BoxelExecutionService.connectSandboxInstanceSync`.
 */
export class SandboxWriteServer {
  private closed = false;
  private queue = Promise.resolve();
  private latestSeqSeen = -1;

  constructor(
    private readonly port: MessagePort,
    private readonly apply: (
      document: LooseSingleCardDocument,
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
    if (!isSandboxWriteRequest(request)) {
      return;
    }
    if (request.seq > this.latestSeqSeen) {
      this.latestSeqSeen = request.seq;
    }
    this.queue = this.queue
      .then(() => this.dispatch(request))
      .then(
        () => this.respond(request, { ok: true }),
        (error) =>
          this.respond(request, {
            ok: false,
            error: projectedError(error),
            ...(error instanceof SandboxWriteSuperseded
              ? { dropped: true as const }
              : {}),
          }),
      );
  };

  private dispatch(request: SandboxWriteRequest): void | Promise<void> {
    assertBoxelExecutionTransportVersion(request.transportVersion);
    if (request.seq < this.latestSeqSeen) {
      throw new SandboxWriteSuperseded(request.seq, this.latestSeqSeen);
    }
    return this.apply(request.document);
  }

  private respond(
    request: SandboxWriteRequest,
    result:
      | Pick<Extract<SandboxWriteResponse, { ok: true }>, 'ok'>
      | Pick<
          Extract<SandboxWriteResponse, { ok: false }>,
          'ok' | 'error' | 'dropped'
        >,
  ): void {
    if (this.closed) {
      return;
    }
    this.port.postMessage({
      kind: 'boxel-sandbox-write-response',
      transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
      requestId: request.requestId,
      seq: request.seq,
      ...result,
    } satisfies SandboxWriteResponse);
  }
}

function isValidSeq(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

function isSandboxWriteRequest(value: unknown): value is SandboxWriteRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'boxel-sandbox-write-request' &&
    'transportVersion' in value &&
    typeof value.transportVersion === 'number' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    value.requestId.length > 0 &&
    value.requestId.length <= 256 &&
    'seq' in value &&
    isValidSeq(value.seq) &&
    'document' in value &&
    typeof value.document === 'object' &&
    value.document !== null &&
    'data' in value.document &&
    typeof value.document.data === 'object' &&
    value.document.data !== null
  );
}

function isSandboxWriteResponse(value: unknown): value is SandboxWriteResponse {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('kind' in value) ||
    value.kind !== 'boxel-sandbox-write-response' ||
    !('transportVersion' in value) ||
    typeof value.transportVersion !== 'number' ||
    !('requestId' in value) ||
    typeof value.requestId !== 'string' ||
    !('seq' in value) ||
    !isValidSeq(value.seq) ||
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

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
