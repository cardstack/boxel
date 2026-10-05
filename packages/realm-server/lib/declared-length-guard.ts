import { pipeline, Transform, type Readable } from 'node:stream';
import { logger } from '@cardstack/runtime-common';

const log = logger('realm:requests');

// The parts of a response this guard acts on: an HTTP/1 response is destroyed
// itself (which closes its socket), an HTTP/2 one through its stream (which
// resets that stream and leaves the connection's other streams alone).
export interface AbortableResponse {
  destroy?: (error?: Error) => unknown;
  stream?: { destroy: (error?: Error) => unknown };
}

// A response declares its body's length before the body is sent, and Node
// does not hold the body to it. When a streamed body ends short of its
// `Content-Length` the response still looks complete to the server, and the
// connection stays open, so the client waits for the missing bytes until its
// own timeout gives up. One that runs long corrupts the framing of whatever
// the connection carries next.
//
// This passes the body through unchanged while counting it, and when the count
// and the declared length disagree — at the end, or as soon as the body runs
// past it — or the body's source fails part-way, it destroys the response so
// the client sees a failed request at once and can retry. Koa cannot do this
// itself: once the headers are out, its error handler only reports the error.
// A mismatch is reported here, once, and ends the guarded stream without an
// error so that Koa does not report it a second time.
export function guardDeclaredLength({
  body,
  declaredLength,
  url,
  response,
}: {
  body: Readable;
  declaredLength: number;
  url: string;
  response: AbortableResponse;
}): Readable {
  let sent = 0;
  let failed = false;
  let fail = (reason: string) => {
    if (failed) {
      return;
    }
    failed = true;
    let error = new Error(reason);
    log.warn(`aborting response: ${reason}`);
    if (response.stream) {
      response.stream.destroy(error);
    } else {
      response.destroy?.(error);
    }
    guard.destroy();
  };
  let guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sent += chunk.length;
      if (sent > declaredLength) {
        fail(
          `body of ${url} ran past its declared Content-Length ${declaredLength} (at least ${sent} bytes)`,
        );
        callback();
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (sent !== declaredLength) {
        fail(
          `body of ${url} ended at ${sent} bytes, short of its declared Content-Length ${declaredLength}`,
        );
      }
      callback();
    },
  });
  // `pipeline` rather than `pipe` so that destroying either end destroys the
  // other: Koa destroys the body it was given when the client goes away, and
  // the source behind it (an open file) has to go with it.
  pipeline(body, guard, (error) => {
    if (
      !error ||
      (error as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE'
    ) {
      return;
    }
    fail(
      `body of ${url} failed after ${sent} of ${declaredLength} declared bytes: ${error.message}`,
    );
  });
  return guard;
}
