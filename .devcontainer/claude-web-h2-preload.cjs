// Preload (via NODE_OPTIONS --require) for Boxel dev servers in "Claude Code
// on the web": make HTTP/2 responses end with END_STREAM on their final DATA
// frame instead of node's trailers mechanism.
//
// Why: node's http2 compat layer always responds with waitForTrailers:true
// and later emits the (empty) trailers HEADERS frame — the frame that carries
// END_STREAM — from a setImmediate (see finishSendTrailers in
// lib/internal/http2/core.js, present in node 22 and 24 alike). When many
// streams finish in one event-loop batch, streams can be destroyed before
// that setImmediate runs; finishSendTrailers then silently drops the
// trailers and the stream terminates as RST_STREAM(NO_ERROR) with a
// truncated body. Chromium hangs module-script loads forever on such
// responses (no error, no retry), so the host app's /_standby page — a
// ~1400-module vite dev graph — never fires DOMContentLoaded, the
// prerender's page pool can't grow, and indexing/render requests queue until
// their clients abort. On this VM the burst reliably happens whenever two or
// more standby loads overlap; over HTTP/1.1 (6 requests at a time) it never
// does, which is why the same stack works there.
//
// Nothing in this repo sends HTTP trailers, so forcing waitForTrailers off
// is behavior-preserving: the last DATA frame simply carries END_STREAM
// itself, eliminating the droppable-trailers window while keeping HTTP/2.
'use strict';
const http2 = require('http2');

const RESPOND_PATCHED = Symbol.for('boxel.http2.respond.patched');

function patchServer(server) {
  server.on('stream', (stream) => {
    const proto = Object.getPrototypeOf(stream);
    if (proto[RESPOND_PATCHED]) return;
    proto[RESPOND_PATCHED] = true;

    const origRespond = proto.respond;
    proto.respond = function (headers, options) {
      if (options && options.waitForTrailers) {
        options = { ...options, waitForTrailers: false };
      }
      return origRespond.call(this, headers, options);
    };
  });
  return server;
}

for (const name of ['createSecureServer', 'createServer']) {
  const orig = http2[name];
  http2[name] = function (...args) {
    return patchServer(orig.apply(this, args));
  };
}
