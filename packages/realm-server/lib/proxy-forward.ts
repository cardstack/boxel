import type Koa from 'koa';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';
import {
  OutboundRefusedError,
  OutboundTimeoutError,
  outboundFetch,
  outboundSettings,
} from './outbound/client.ts';
import { TopLevelJsonFieldScanner } from './top-level-json-fields.ts';

const log = logger('proxy-forward');

const KEEP_ALIVE_INTERVAL_MS = 15000;

// The usage a stream reported, in the shape of a non-streaming response body,
// so a credit strategy prices both the same way.
export interface StreamUsage {
  id: string | undefined;
  usage: { cost: number | undefined };
}

/**
 * A signal that fires when this request's client goes away before it was
 * answered — a caller enforcing its own deadline, a closed tab, a dropped
 * connection. Proxy handlers pass it into the upstream `fetch` so abandoning
 * the wait also cancels the call.
 *
 * The disconnect is observable on the response, not the request. Node
 * destroys the request stream as soon as its body has been read, so `req`
 * emits 'close' on every request — served or abandoned — and its deprecated
 * 'aborted' event never fires once the body has arrived in full. `res` closes
 * with `writableEnded` still false only when the socket went away before the
 * response was finished, which is exactly the case worth cancelling.
 */
export function clientDisconnectSignal(ctxt: Koa.Context): AbortSignal {
  let controller = new AbortController();
  ctxt.res.once('close', () => {
    // A reset the server made itself (see `resetResponse`) is not the client
    // leaving.
    if (!ctxt.res.writableEnded && !ctxt.state[SERVER_RESET]) {
      controller.abort(
        new Error('Client disconnected before the response was finished'),
      );
    }
  });
  return controller.signal;
}

// How long a forward waits on a client that has stopped reading its response
// before giving up on it.
const CLIENT_STALL_MS = 30_000;

// The `ctxt.state` key `resetResponse` sets.
const SERVER_RESET = 'serverResetResponse';

// Resets a response whose body has started, so the client sees it fail rather
// than end. The reset carries an error: over HTTP/2, a reset without one ends
// the stream as a normal close, and the client would take the partial body as
// whole. It is marked as the server's own so `clientDisconnectSignal` does
// not report it as the client leaving.
function resetResponse(ctxt: Koa.Context, error: Error): void {
  ctxt.state[SERVER_RESET] = true;
  ctxt.res.destroy(error);
}

/**
 * A signal that follows `clientGone` only until the upstream answers.
 *
 * Cancelling the upstream call is the whole point while it is still running:
 * it gives the user's in-flight slot back instead of holding it for a response
 * nobody will read. Once the upstream has answered, the calculus inverts. The
 * provider has generated the tokens and billed us for them, so what is left —
 * reading the body and recording the usage cost — is how that charge gets
 * attributed. Cancelling there does not save anything; it discards the record
 * of something already paid for.
 *
 * The window is not academic. A chat completion's body is a few KB, but this
 * endpoint is also the route for image generation, whose base64 payload runs
 * to megabytes: seconds of reading during which a closed tab would lose the
 * charge for the most expensive call the proxy serves.
 *
 * `release()` is called once the response is in hand. Streaming callers must
 * not use this — there the body *is* the generation, so the signal has to stay
 * live for the whole read.
 */
export function upstreamCallSignal(clientGone: AbortSignal): {
  signal: AbortSignal;
  release: () => void;
} {
  let controller = new AbortController();
  let mirror = () => controller.abort(clientGone.reason);
  if (clientGone.aborted) {
    mirror();
  } else {
    clientGone.addEventListener('abort', mirror, { once: true });
  }
  return {
    signal: controller.signal,
    release: () => clientGone.removeEventListener('abort', mirror),
  };
}

// A `cause` chain is walked rather than inspected one level deep because
// `fetch` surfaces an abort reason wrapped rather than rethrown. The bound
// stops a malformed or self-referential chain from spinning.
const MAX_CAUSE_DEPTH = 8;

/**
 * Whether `error` is the cancellation `signal` asked for, as opposed to a
 * failure that merely happened while the signal was aborted.
 *
 * `signal.aborted` alone cannot answer this. Work that runs *after* the
 * upstream call — saving the usage cost — never receives the signal, so it
 * runs to completion or failure regardless of whether the client is still
 * there. A caller that treats every post-abort exception as a cancellation
 * therefore swallows a genuine billing failure whenever the client happens to
 * leave during that write, which is precisely when nobody is watching.
 *
 * Identity against `signal.reason` is exact: `clientDisconnectSignal` aborts
 * with a specific `Error` instance. The `AbortError` name is accepted too, for
 * an abort that a lower layer reports in its own terms.
 */
export function isClientDisconnectError(
  error: unknown,
  signal: AbortSignal,
): boolean {
  if (!signal.aborted) {
    return false;
  }
  let cursor: unknown = error;
  for (let depth = 0; cursor != null && depth < MAX_CAUSE_DEPTH; depth++) {
    if (cursor === signal.reason) {
      return true;
    }
    if ((cursor as { name?: unknown }).name === 'AbortError') {
      return true;
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

// How a proxy answers its caller when the outbound guard stops a call: a
// forbidden forwarded header is the caller's mistake, any other refusal is a
// destination the proxy will not reach, and a timeout is an upstream that did
// not answer. Anything else is not the guard's, and gets undefined.
export function outboundFailureResponse(
  error: unknown,
): { status: number; statusText: string; message: string } | undefined {
  if (error instanceof OutboundRefusedError) {
    return error.reason === 'forbidden-header'
      ? { status: 400, statusText: 'Bad Request', message: error.message }
      : {
          status: 502,
          statusText: 'Bad Gateway',
          message: `Destination refused: ${error.message}`,
        };
  }
  if (error instanceof OutboundTimeoutError) {
    return {
      status: 504,
      statusText: 'Gateway Timeout',
      message: error.message,
    };
  }
  return undefined;
}

// The first byte of a JSON document that is a bare string, number or literal
// rather than an object or array.
const JSON_SCALAR_START = new Set(
  Array.from('"-0123456789tfn', (c) => c.charCodeAt(0)),
);
const OPEN_BRACE = 0x7b;
const OPEN_BRACKET = 0x5b;

// The most of a billing field's value kept while scanning a body for it.
// `usage` is a handful of numbers; this is far above it.
const MAX_BILLING_FIELD_BYTES = 64 * 1024;

/**
 * Forward a non-streamed upstream JSON response to the client as it arrives,
 * and read the billing fields (`id`, `usage`) from it on the way past.
 *
 * The body is never held whole: each chunk is scanned and written on, so the
 * memory a forward uses does not grow with the size of what it forwards. The
 * caller receives the upstream's status and its body bytes as sent, under an
 * `application/json` content type.
 *
 * Resolves with `{ id, usage }` in the shape of a response body, for the
 * credit strategy to price, once the whole body has been read; or undefined
 * when there is nothing to charge for: `chargesForUsage` is false, or the body
 * failed or turned out not to be a complete JSON document before its
 * generation id was read. A charged body that fails
 * after its generation id has been read resolves with just the id, which the
 * credit strategy prices by looking the generation up.
 *
 * A body that is plainly not JSON is refused before anything is sent, with
 * the `SyntaxError` the handler answers with a 500, as it does for any
 * unreadable upstream answer. A body that opens like JSON is committed to the
 * client from its first chunk, so a fault found later — a document that
 * ends early or whose brackets or strings do not close, or the upstream
 * failing mid-body — cannot change the status: the response is reset
 * instead, so the client cannot mistake a partial body for a whole one. The
 * scan checks structure, not grammar, so a balanced body with an invalid
 * token in it is passed on whole, as the upstream sent it; the billing fields
 * are parsed strictly on their own either way.
 *
 * `signal` fires when the client goes away. When the call is charged for,
 * the rest of the body is still read, and dropped, because the cost it
 * reports comes at the end and the provider has already billed for it. When
 * it is not, the upstream body is cancelled, including a read waiting on an
 * upstream that has paused mid-body. A client that keeps its connection open
 * but stops reading is treated the same way once it has taken nothing for
 * `CLIENT_STALL_MS` (or the outbound timeout, if shorter): its response is
 * reset and it counts as gone.
 */
export async function forwardJsonResponse(
  ctxt: Koa.Context,
  externalResponse: Response,
  {
    chargesForUsage,
    signal,
  }: { chargesForUsage: boolean; signal: AbortSignal },
): Promise<StreamUsage | undefined> {
  const reader = externalResponse.body?.getReader();
  if (!reader) {
    throw new SyntaxError('The upstream response has no body');
  }

  // Hold the opening chunks until the first byte that is not whitespace,
  // which says whether this is a document worth streaming.
  let held: Uint8Array[] = [];
  let firstByte: number | undefined;
  while (firstByte === undefined) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    held.push(value);
    firstByte = value.find(
      (byte) =>
        byte !== 0x20 && byte !== 0x0a && byte !== 0x0d && byte !== 0x09,
    );
  }

  if (firstByte !== OPEN_BRACE && firstByte !== OPEN_BRACKET) {
    if (firstByte === undefined || !JSON_SCALAR_START.has(firstByte)) {
      await reader.cancel().catch(() => undefined);
      throw new SyntaxError('The upstream response is not JSON');
    }
    // A bare string, number or literal: small in practice, and the one shape
    // whose validity needs the whole document, so it is read whole.
    return await forwardJsonScalar(ctxt, externalResponse, reader, held);
  }

  let scanner = new TopLevelJsonFieldScanner(
    chargesForUsage ? ['id', 'usage'] : [],
    { maxValueBytes: MAX_BILLING_FIELD_BYTES },
  );
  for (let chunk of held) {
    scanner.feed(chunk);
  }
  if (scanner.error) {
    await reader.cancel().catch(() => undefined);
    throw new SyntaxError(
      `The upstream response is not JSON: ${scanner.error}`,
    );
  }

  // The body is written straight to the socket. An explicit null body tells
  // Koa there is nothing more to send, so once the handler returns — after
  // the call's cost is recorded — Koa only ends the response. A client that
  // sees its response complete can therefore rely on the charge and the
  // in-flight slot having been settled.
  ctxt.body = null;
  ctxt.status = externalResponse.status;
  ctxt.message = externalResponse.statusText;
  ctxt.set('Content-Type', SupportedMimeType.JSON);
  if (ctxt.req.httpVersionMajor < 2) {
    // Koa's null body removes Transfer-Encoding, which turns Node's HTTP/1.1
    // response into one delimited by the connection closing, where a cut
    // looks like a normal end. Chunked framing keeps a cut detectable.
    // HTTP/2 frames the body itself and forbids the header.
    ctxt.set('Transfer-Encoding', 'chunked');
  }
  let res = ctxt.res;
  // Set once the server gives up on the client itself. An HTTP/2 response
  // has no `destroyed` to say so.
  let abandoned = false;
  let clientGone = () => signal.aborted || res.destroyed || abandoned;
  // An uncharged body has no reason to be read once its client is gone, so
  // the client leaving cancels it, even while a read is waiting on the
  // upstream.
  let cancelUncharged = () => {
    reader.cancel().catch(() => undefined);
  };
  if (!chargesForUsage) {
    signal.addEventListener('abort', cancelUncharged, { once: true });
  }

  // A client that keeps its connection open but stops reading is given up on
  // after this long. Waiting on it would hold up the upstream read, which
  // the outbound timeout then fails, so a charged call would lose the usage
  // that prices it; giving up lets the rest of the body be read for the
  // charge, or an uncharged body be cancelled.
  let stallMs = Math.min(CLIENT_STALL_MS, outboundSettings().totalTimeoutMs);
  let send = async (chunk: Uint8Array) => {
    if (clientGone()) {
      return;
    }
    if ((await writeChunk(res, chunk, signal, stallMs)) === 'stalled') {
      log.warn(
        `Client stopped reading a forwarded response for ${stallMs}ms; resetting it`,
      );
      abandoned = true;
      resetResponse(ctxt, new Error('The client stopped reading the response'));
    }
  };

  try {
    for (let chunk of held) {
      await send(chunk);
    }
    held = [];
    for (;;) {
      if (clientGone() && !chargesForUsage) {
        cancelUncharged();
        return undefined;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      scanner.feed(value);
      await send(value);
    }
  } catch (error) {
    if (clientGone() && !chargesForUsage) {
      return undefined;
    }
    resetResponse(
      ctxt,
      error instanceof Error ? error : new Error('The upstream body failed'),
    );
    let generation = chargedGeneration(scanner, chargesForUsage);
    if (generation) {
      log.warn(
        `Forwarded upstream body failed after generation ${generation.id} began; charging for the generation`,
        error,
      );
      return generation;
    }
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelUncharged);
  }

  if (clientGone() && !chargesForUsage) {
    // The read ended because the client's leaving cancelled it.
    return undefined;
  }
  scanner.finish();
  if (scanner.error) {
    resetResponse(
      ctxt,
      new Error(
        `The upstream body was not a complete document: ${scanner.error}`,
      ),
    );
    let generation = chargedGeneration(scanner, chargesForUsage);
    log.warn(
      `Forwarded upstream response was not a complete JSON document (${scanner.error}); ${
        generation
          ? `charging for generation ${generation.id}`
          : 'nothing is charged for it'
      }`,
    );
    return generation;
  }
  if (!chargesForUsage) {
    return undefined;
  }
  return {
    id: scanner.values.get('id') as string | undefined,
    usage: scanner.values.get('usage') as { cost: number | undefined },
  };
}

// What a charged call whose body failed partway is priced from. The
// generation id leads an OpenRouter body, so once it has been read the
// provider has started, and billed for, that generation: the credit strategy
// prices it from the id even though the usage at the end never arrived. This
// holds whatever cut the body short — the upstream failing, or the outbound
// timeout ending a read held up by a client that stopped reading.
function chargedGeneration(
  scanner: TopLevelJsonFieldScanner,
  chargesForUsage: boolean,
): StreamUsage | undefined {
  let id = scanner.values.get('id');
  if (!chargesForUsage || typeof id !== 'string' || id === '') {
    return undefined;
  }
  return { id, usage: { cost: undefined } };
}

async function forwardJsonScalar(
  ctxt: Koa.Context,
  externalResponse: Response,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  held: Uint8Array[],
): Promise<StreamUsage | undefined> {
  let decoder = new TextDecoder();
  let text = held
    .map((chunk) => decoder.decode(chunk, { stream: true }))
    .join('');
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  // Throws the SyntaxError a body that is not JSON is refused with.
  let parsed = JSON.parse(text);
  ctxt.status = externalResponse.status;
  ctxt.message = externalResponse.statusText;
  ctxt.set('Content-Type', SupportedMimeType.JSON);
  ctxt.body = JSON.stringify(parsed);
  // A scalar carries no billing fields.
  return undefined;
}

// Writes one chunk to the client, waiting out backpressure for at most
// `stallMs`. Returns early, without writing, once the client has gone, and
// returns 'stalled' when the client took no more of the response in that
// time.
async function writeChunk(
  res: Koa.Context['res'],
  chunk: Uint8Array,
  signal: AbortSignal,
  stallMs: number,
): Promise<'written' | 'stalled'> {
  if (signal.aborted || res.destroyed) {
    return 'written';
  }
  if (res.write(chunk)) {
    return 'written';
  }
  return await new Promise<'written' | 'stalled'>((resolve) => {
    let finish = (outcome: 'written' | 'stalled') => {
      clearTimeout(timer);
      res.off('drain', done);
      res.off('close', done);
      signal.removeEventListener('abort', done);
      resolve(outcome);
    };
    let done = () => finish('written');
    let timer = setTimeout(() => finish('stalled'), stallMs);
    res.once('drain', done);
    res.once('close', done);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Stream the upstream `text/event-stream` response back to the client, parsing
 * each `data:` line to capture the OpenRouter generation id / inline cost.
 *
 * Resolves with what the stream reported about its usage once `[DONE]`
 * arrives, for the caller to charge for, or undefined when there is nothing to
 * charge: the upstream failed, the stream ended without `[DONE]`, or it
 * carried neither a generation id nor a cost.
 *
 * `signal` fires when the client that asked for the stream goes away. It
 * cancels the upstream call and, with it, the body stream this function is
 * reading, so a generation nobody is receiving stops running. A stream cut
 * short never reaches `[DONE]`, so nothing is charged for it.
 */
export async function handleStreamingRequest(
  ctxt: Koa.Context,
  url: string,
  method: string,
  headers: Record<string, string>,
  requestBody: BodyInit | undefined,
  matrixUserId: string,
  signal: AbortSignal,
  credentialHeaders: string[] = [],
): Promise<StreamUsage | undefined> {
  let usage: StreamUsage | undefined;
  try {
    setupSSEHeaders(ctxt);

    const externalResponse = await outboundFetch({
      url,
      method,
      headers,
      body: requestBody,
      signal,
      sizePath: 'system-key',
      credentialHeaders,
    });

    if (!externalResponse.ok) {
      const errorData = await externalResponse.text();
      log.error(
        `Streaming request failed: ${externalResponse.status} - ${errorData}`,
      );
      ctxt.status = externalResponse.status;
      ctxt.res.write(`data: ${JSON.stringify({ error: errorData })}\n\n`);
      ctxt.res.write('data: [DONE]\n\n');
      return undefined;
    }

    // First write commits headers + status to the wire, so do this
    // only after the upstream-OK check above has had a chance to
    // override the status.
    ctxt.res.write(': connected\n\n');

    const reader = externalResponse.body?.getReader();
    if (!reader) throw new Error('No readable stream available');

    let generationId: string | undefined;
    let costInUsd: number | undefined;
    let lastPing = Date.now();

    await proxySSE(
      reader,
      async (data) => {
        if (data === '[DONE]') {
          ctxt.res.write(`data: [DONE]\n\n`);
          if (
            generationId != null ||
            (typeof costInUsd === 'number' &&
              Number.isFinite(costInUsd) &&
              costInUsd > 0)
          ) {
            usage = { id: generationId, usage: { cost: costInUsd } };
          } else {
            log.warn(
              `Streaming response for user ${matrixUserId} contained no generation ID or usage cost, skipping credit deduction`,
            );
          }
          return 'stop';
        }

        try {
          const dataObj = JSON.parse(data);
          if (!generationId && dataObj.id) {
            generationId = dataObj.id;
          }
          if (dataObj.usage?.cost != null) {
            costInUsd = dataObj.usage.cost;
          }
        } catch {
          log.warn('Invalid JSON in streaming response:', data);
        }

        ctxt.res.write(`data: ${data}\n\n`);
        return;
      },
      () => {
        const now = Date.now();
        if (now - lastPing > KEEP_ALIVE_INTERVAL_MS) {
          ctxt.res.write(': ping\n\n');
          lastPing = now;
        }
      },
    );
    return usage;
  } catch (error) {
    if (isClientDisconnectError(error, signal)) {
      // The read failed because the client hung up and we cancelled the
      // upstream call ourselves. There is no socket left to write the error
      // frames to and no fault to page anyone about.
      log.info(
        `Client disconnected during streaming request for user ${matrixUserId}; upstream call cancelled`,
      );
      return undefined;
    }
    let failure = outboundFailureResponse(error);
    if (failure) {
      log.warn(
        `Streaming request stopped by the outbound guard: ${failure.message}`,
      );
      if (!ctxt.res.headersSent) {
        ctxt.status = failure.status;
      }
      ctxt.res.write(`data: ${JSON.stringify({ error: failure.message })}\n\n`);
      ctxt.res.write('data: [DONE]\n\n');
      return undefined;
    }
    log.error('Error in streaming request:', error);
    Sentry.captureException(error);
    ctxt.res.write(
      `data: ${JSON.stringify({ error: 'Streaming error occurred' })}\n\n`,
    );
    ctxt.res.write('data: [DONE]\n\n');
    return undefined;
  }
}

function setupSSEHeaders(ctx: Koa.Context) {
  // Headers and status are set here but NOT flushed — `flushHeaders`
  // commits the wire status, which would mask any later
  // `ctx.status = upstream.status` on upstream failure. Caller flushes
  // (implicitly, via the first `ctx.res.write`) only after confirming
  // the upstream response was OK.
  ctx.set('Content-Type', 'text/event-stream');
  ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  ctx.set('Connection', 'keep-alive');
  ctx.set('Access-Control-Allow-Origin', '*');
  ctx.set('Access-Control-Allow-Headers', 'Cache-Control');
  ctx.set('X-Accel-Buffering', 'no'); // Disable nginx buffering
  ctx.set('Transfer-Encoding', 'chunked');
  ctx.body = null;
  ctx.status = 200;
}

async function proxySSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onData: (data: string) => Promise<void | 'stop'>,
  onTick?: () => void,
) {
  let buffer = '';
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += new TextDecoder().decode(value);
      if (onTick) onTick();

      // Split on `\n`, keep the trailing incomplete fragment in
      // `buffer`, dispatch every complete line. The previous
      // implementation called a helper that locally reassigned
      // its `buffer` parameter — the caller's buffer never got
      // trimmed, so every new read re-emitted every prior line.
      // For SSE that means the receiver got each delta multiple
      // times and concatenated them ("foofoo barfoo bar baz...").
      let parts = buffer.split('\n');
      buffer = parts.pop() ?? '';

      for (let raw of parts) {
        let line = raw.trim();
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          const result = await onData(data);
          if (result === 'stop') return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
