import { pipeline, Transform, type Readable } from 'node:stream';

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
//
// Reporting is Koa's. A response destroyed with an error reaches the app's
// error handler, which logs it and sends it to error tracking, so a mismatch
// is handed over that way and named in the error's message. A source that
// fails has already been reported through the guarded stream's own error, so
// its response is destroyed without one. (On HTTP/2 Koa also reports the reset
// stream, so a failing source there is reported twice.)
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
  let aborted = false;
  let abort = (error?: Error) => {
    if (aborted) {
      return;
    }
    aborted = true;
    if (response.stream) {
      response.stream.destroy(error);
    } else {
      response.destroy?.(error);
    }
  };
  let mismatch = (reason: string) => {
    abort(new Error(reason));
    guard.destroy();
  };
  let guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sent += chunk.length;
      if (sent > declaredLength) {
        mismatch(
          `aborted the response: body of ${url} ran past its declared Content-Length ${declaredLength} (at least ${sent} bytes)`,
        );
        callback();
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (sent !== declaredLength) {
        mismatch(
          `aborted the response: body of ${url} ended at ${sent} bytes, short of its declared Content-Length ${declaredLength}`,
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
    abort();
  });
  return guard;
}
