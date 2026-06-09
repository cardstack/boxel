import Koa from 'koa';
import cors from '@koa/cors';
import http from 'http';
import http2 from 'http2';
import net from 'net';
import { readFileSync } from 'fs';
import type { DefinitionLookup, Realm } from '@cardstack/runtime-common';
import {
  logger,
  SupportedMimeType,
  type VirtualNetwork,
  type DBAdapter,
  type QueuePublisher,
  DEFAULT_CARD_SIZE_LIMIT_BYTES,
  DEFAULT_FILE_SIZE_LIMIT_BYTES,
} from '@cardstack/runtime-common';
import { ensureDirSync } from 'fs-extra';
import {
  httpLogging,
  ecsMetadata,
  methodOverrideSupport,
  proxyAsset,
} from './middleware';
import convertAcceptHeaderQueryParam from './middleware/convert-accept-header-qp';

import { extractSupportedMimeType } from '@cardstack/runtime-common/router';
import * as Sentry from '@sentry/node';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { createRoutes } from './routes';
import { JobScopedSearchCache } from './job-scoped-search-cache';
import { createSendEvent } from './handlers/send-event';
import { createServeFromRealm } from './handlers/serve-from-realm';
import { createServeIndex } from './handlers/serve-index';
import { findOrMountRealm } from './lib/realm-routing';
import type { Prerenderer } from '@cardstack/runtime-common';
import type { RealmRegistryReconciler } from './lib/realm-registry-reconciler';

const TLS_CERT_FILE_ENV = 'REALM_SERVER_TLS_CERT_FILE';
const TLS_KEY_FILE_ENV = 'REALM_SERVER_TLS_KEY_FILE';

// Opt-in HTTP/2 stall diagnostics (see installHttp2Diagnostics). Off by
// default; set in the host-test CI job so an intermittent "request accepted
// but never answered" h2 stall dumps its full session/stream state instead of
// surfacing only as an opaque 60s host-test timeout. The h2 path is taken only
// when a TLS cert/key is provided (see createListener): local dev and CI
// provision an mkcert leaf, so they run h2, while staging/prod set no cert and
// so fall into the no-cert branch and serve plain HTTP/1.1 (TLS terminates at
// the proxy in front). BOXEL_ENVIRONMENT is the local Traefik-in-front mode,
// not the production mechanism.
const HTTP2_DIAGNOSTICS_ENV = 'REALM_SERVER_HTTP2_DIAGNOSTICS';

export type RealmHttpServer =
  | http.Server
  | http2.Http2SecureServer
  | net.Server;

// Node's HTTP/2 compat layer reports Http2Stream.writable === false on
// server-side streams whose request method is HEAD (the protocol forbids a
// body, so the stream is marked non-writable up front). Koa's
// `ctx.writable` getter delegates to `res.socket.writable`, so for HEAD
// over h2 it sees `false` and `respond()` bails silently — the response
// headers never get sent and the client hangs until its timeout.
// Patching the prototype getter to recognise HEAD-over-h2 streams as
// writable (when they are otherwise healthy) restores normal HEAD
// semantics over h2 without disturbing GET/POST or HTTP/1.1. Exported so
// tests that build their own Koa app pick up the same fix.
let koaResponsePatchedForH2 = false;
export function patchKoaResponseForH2Head() {
  if (koaResponsePatchedForH2) return;
  // Construct a throwaway Koa instance just to find the prototype — Koa's
  // response prototype isn't exported directly.
  let proto = Object.getPrototypeOf(new Koa().response) as object;
  let descriptor = Object.getOwnPropertyDescriptor(proto, 'writable');
  let origWritable = descriptor?.get;
  if (!origWritable) return;
  Object.defineProperty(proto, 'writable', {
    configurable: true,
    get(this: Koa.Response) {
      let res = this.res as unknown as {
        writableEnded?: boolean;
        req?: { method?: string };
        stream?: { destroyed?: boolean; closed?: boolean };
      };
      if (res?.writableEnded) return false;
      let stream = res?.stream;
      if (
        res?.req?.method === 'HEAD' &&
        stream &&
        !stream.destroyed &&
        !stream.closed
      ) {
        return true;
      }
      return origWritable!.call(this);
    },
  });
  koaResponsePatchedForH2 = true;
}

// In TLS mode the realm-server binds a single net.Server that peeks each
// connection's first byte and routes TLS handshakes (0x16) to the HTTP/2
// secure server and plain-text HTTP to a tiny 308-redirect server. This
// gives http://localhost:4201 → https://localhost:4201 the same-port
// redirect UX without running two listeners on different ports.
// Exported for tests in `tests/listener-dispatcher-test.ts` — the
// production caller is `RealmServer.listen()` below.
export function createListener(
  log: ReturnType<typeof logger>,
  app: { callback: Koa['callback'] },
): { server: RealmHttpServer; proto: 'http' | 'https/h2' } {
  // Env mode (Traefik in front): force plain HTTP regardless of
  // whether the TLS env vars are set. They may have leaked in from a
  // parent shell that ran env-vars.sh in standard mode before
  // BOXEL_ENVIRONMENT was exported, which would otherwise make us
  // terminate TLS while Traefik plain-HTTP-proxies to us — every
  // request then fails with "HTTP/0.9 when not allowed" → 502.
  if (process.env.BOXEL_ENVIRONMENT) {
    return { server: http.createServer(app.callback()), proto: 'http' };
  }
  let certFile = process.env[TLS_CERT_FILE_ENV];
  let keyFile = process.env[TLS_KEY_FILE_ENV];
  if (!certFile || !keyFile) {
    return { server: http.createServer(app.callback()), proto: 'http' };
  }
  // We only need the patch on the h2 path — but it's idempotent and
  // cheap, so we apply it unconditionally once cert/key are present.
  patchKoaResponseForH2Head();
  let cert: Buffer;
  let key: Buffer;
  try {
    cert = readFileSync(certFile);
    key = readFileSync(keyFile);
  } catch (e) {
    log.warn(
      `Unable to read TLS cert/key (%s, %s): %s — falling back to HTTP/1.1`,
      certFile,
      keyFile,
      (e as Error).message,
    );
    return { server: http.createServer(app.callback()), proto: 'http' };
  }
  let tlsServer: http2.Http2SecureServer;
  try {
    tlsServer = http2.createSecureServer(
      { cert, key, allowHTTP1: true },
      app.callback(),
    );
  } catch (e) {
    log.warn(
      `Unable to construct HTTPS/h2 server (malformed cert?): %s — falling back to HTTP/1.1`,
      (e as Error).message,
    );
    return { server: http.createServer(app.callback()), proto: 'http' };
  }
  if (process.env[HTTP2_DIAGNOSTICS_ENV]) {
    installHttp2Diagnostics(tlsServer, log);
  }
  let redirectServer = http.createServer(redirectToHttps);
  // Track every accepted socket so shutdown can force-close them. Without
  // this, `dispatcher.close()` waits for active HTTP/2 sessions and
  // keep-alive HTTP/1 connections to end on their own — a single open
  // browser tab can keep the realm-server from ever shutting down. Mirror
  // the API surface (`closeAllConnections`) so main.ts's existing typeof
  // guard picks this up without a special-case branch.
  let activeSockets = new Set<net.Socket>();
  let dispatcher = net.createServer({ pauseOnConnect: true }, (socket) => {
    activeSockets.add(socket);
    socket.once('close', () => activeSockets.delete(socket));
    // Attach a per-socket error listener BEFORE doing any I/O. A peer that
    // RSTs the connection mid-handshake (or in the half-open window before
    // we route it) emits `'error'` on this raw socket; without a listener
    // Node escalates that to an uncaught exception and the realm-server
    // would crash. Logging + best-effort destroy is sufficient — the
    // dispatcher is the realm-server's single inbound listener and must
    // survive hostile or unlucky clients.
    socket.on('error', (e) => {
      log.warn(`dispatcher socket error: %s`, e.message);
      socket.destroy();
    });
    socket.once('readable', () => {
      let firstByte: Buffer | null;
      try {
        firstByte = socket.read(1);
      } catch {
        socket.destroy();
        return;
      }
      if (firstByte == null) {
        // Connection opened then closed without data — release the socket
        // promptly instead of letting it idle in CLOSE_WAIT until the OS
        // reaps it. Cheap defense against half-open-connection accumulators
        // (port scanners, eager load balancers, etc.).
        socket.destroy();
        return;
      }
      socket.unshift(firstByte);
      // 0x16 is the TLS ClientHello record type. Anything else is treated
      // as plain HTTP (ASCII verb byte) and gets the redirect path.
      if (firstByte[0] === 0x16) {
        tlsServer.emit('connection', socket);
      } else {
        redirectServer.emit('connection', socket);
      }
      socket.resume();
    });
  });
  // Server-level errors (e.g. `EADDRINUSE` at `listen()` time). Per-socket
  // errors are handled inside the connection callback above.
  dispatcher.on('error', (e) => {
    log.warn(`dispatcher server error: %s`, e.message);
  });
  // Mirror http.Server's `closeAllConnections()` so shutdown can force-
  // close in-flight TLS / HTTP/2 / keep-alive sockets without waiting for
  // peers to close them. main.ts feature-detects this method.
  (
    dispatcher as net.Server & { closeAllConnections: () => void }
  ).closeAllConnections = () => {
    for (let s of activeSockets) {
      try {
        s.destroy();
      } catch {
        // best-effort
      }
    }
    activeSockets.clear();
  };
  return { server: dispatcher, proto: 'https/h2' };
}

// Instrument the HTTP/2 secure server so an intermittent stall — a stream that
// is accepted but whose response never reaches the browser — is observable
// instead of surfacing only as a downstream 60s host-test timeout. The flake
// has been isolated to "something in the Chrome ↔ Node http2 path" (the h1
// toggle made it vanish and the byte-peek dispatcher was exonerated), but the
// mechanism is still unknown. This narrows it down by answering, for any
// long-open stream:
//   - did the app ever produce a response? (sawRequest / res.writableEnded /
//     headersSent) — distinguishes an app-side hang from an h2 transport stall
//   - is the stream flow-control-blocked? (stream localWindowSize, session
//     effectiveLocalWindowSize / remoteWindowSize / outboundQueueSize)
//   - is the connection over its stream budget? (local/remote
//     maxConcurrentStreams vs. live open-stream count)
//   - how did it finally end? (rstCode / aborted on close)
// Read-only: it attaches observer listeners and reads getters, never consuming
// the stream body or writing a response, so it cannot perturb the path it
// watches. Periodic so a single stuck stream is dumped repeatedly and its
// window/queue evolution is visible.
//
// The per-stream sweep above only fires once a server-side stream has been
// open >8s. A captured hang showed it completely clean, which is itself the
// clue: the wedge is somewhere that never becomes a long-open server stream.
// So each sweep ALSO emits a session-level snapshot to cover what the
// per-stream view is blind to:
//   - did the server receive the hung request at all? (the roll-up's
//     `openStreams` count + the per-session `inFlight=[…]` path list — a client
//     hang with `openStreams=0` means it never arrived)
//   - is the session at its concurrent-stream ceiling, so the browser is
//     queueing requests it never sends? (live/peak vs maxConcurrentStreams)
//   - is the connection flow-control-deadlocked? (session windows + outbound
//     queue, sampled continuously rather than only per stalled stream)
//   - is the transport even alive during the hang? (a passive PING round-trip
//     per session — observe only, never tear anything down)
function installHttp2Diagnostics(
  tlsServer: http2.Http2SecureServer,
  log: ReturnType<typeof logger>,
) {
  const STALL_THRESHOLD_MS = 8000;
  const SWEEP_INTERVAL_MS = 5000;

  interface TrackedStream {
    id: number;
    method: string;
    path: string;
    startedAt: number;
    sawRequest: boolean;
    res?: http2.Http2ServerResponse;
    everStalled: boolean;
  }

  interface SessionRec {
    id: number;
    peakStreams: number;
    lastPingAt?: number;
    lastPongAt?: number;
    lastRttMs?: number;
    pingInFlight: boolean;
  }

  let nextId = 0;
  let nextSessionId = 0;
  let sessions = new Map<http2.ServerHttp2Session, SessionRec>();
  let open = new Map<http2.ServerHttp2Stream, TrackedStream>();

  tlsServer.on('session', (session) => {
    let srec: SessionRec = {
      id: nextSessionId++,
      peakStreams: 0,
      pingInFlight: false,
    };
    sessions.set(session, srec);
    log.info(
      `[h2-diag] session #${srec.id} opened (live sessions=${sessions.size})`,
    );
    probeSession(session, srec);
    session.on('close', () => {
      sessions.delete(session);
      log.info(
        `[h2-diag] session #${srec.id} closed (live sessions=${sessions.size})`,
      );
    });
    session.on('error', (e) =>
      log.warn(`[h2-diag] session #${srec.id} error: ${e.message}`),
    );
    session.on('frameError', (type, code, id) =>
      log.warn(
        `[h2-diag] session #${srec.id} frameError type=${type} code=${code} streamId=${id}`,
      ),
    );
    session.on('goaway', (code, lastStreamID) =>
      log.warn(
        `[h2-diag] session #${srec.id} goaway errorCode=${code} lastStreamID=${lastStreamID}`,
      ),
    );
    session.on('timeout', () =>
      log.warn(`[h2-diag] session #${srec.id} timeout`),
    );
  });

  // Get-or-create the per-stream record. Both the `stream` and `request`
  // events populate it, and either may fire first: the compat `request`
  // listener that `createSecureServer(..., app.callback())` registers runs
  // before this function's `stream` listener and emits `request`
  // synchronously, so for a normal request the record is created from the
  // `request` side; a stream that stalls before the app ever dispatches is
  // created from the `stream` side with `sawRequest` left false. (Creating it
  // only from `stream` would always report `sawRequest=false`, defeating the
  // app-hang-vs-transport-stall distinction.)
  function trackStream(
    stream: http2.ServerHttp2Stream,
    method: string,
    path: string,
  ): TrackedStream {
    let rec = open.get(stream);
    if (!rec) {
      rec = {
        id: nextId++,
        method,
        path,
        startedAt: Date.now(),
        sawRequest: false,
        everStalled: false,
      };
      open.set(stream, rec);
    }
    return rec;
  }

  tlsServer.on('stream', (stream, headers) => {
    trackStream(
      stream,
      String(headers[':method'] ?? '?'),
      String(headers[':path'] ?? '?'),
    );
    // The `stream` event always fires for an h2 stream, so attach the close
    // cleanup here exactly once regardless of which event created the record.
    stream.once('close', () => {
      let rec = open.get(stream);
      open.delete(stream);
      if (rec && rec.everStalled) {
        log.warn(
          `[h2-diag] stream #${rec.id} ${rec.method} ${rec.path} CLOSED after ` +
            `${Date.now() - rec.startedAt}ms rstCode=${stream.rstCode} ` +
            `aborted=${stream.aborted} sawRequest=${rec.sawRequest} ` +
            `resWritableEnded=${rec.res?.writableEnded ?? 'n/a'}`,
        );
      }
    });
  });

  tlsServer.on('request', (req, res) => {
    // h1 requests (allowHTTP1) have no backing h2 stream; only h2 is in scope.
    let stream = req.stream as http2.ServerHttp2Stream | undefined;
    if (stream == null) {
      return;
    }
    let rec = trackStream(stream, req.method ?? '?', req.url ?? '?');
    rec.sawRequest = true;
    rec.res = res;
  });

  // Passive liveness probe — send one PING and record its round-trip. Observe
  // only; never tears the session down (that distinguishes this from a
  // keepalive). Run once on session open so the first sweep already has a
  // reading, then again each sweep.
  function probeSession(
    session: http2.ServerHttp2Session,
    srec: SessionRec,
  ): void {
    if (srec.pingInFlight || session.destroyed || session.closed) {
      return;
    }
    srec.pingInFlight = true;
    srec.lastPingAt = Date.now();
    let sent = false;
    try {
      sent =
        session.ping((err: Error | null, duration: number) => {
          srec.pingInFlight = false;
          if (!err) {
            srec.lastPongAt = Date.now();
            srec.lastRttMs = Math.round(duration);
          }
        }) !== false;
    } catch {
      srec.pingInFlight = false;
    }
    if (!sent) {
      srec.pingInFlight = false;
    }
  }

  let timer = setInterval(() => {
    let now = Date.now();
    for (let [stream, rec] of open) {
      let age = now - rec.startedAt;
      if (age < STALL_THRESHOLD_MS) {
        continue;
      }
      rec.everStalled = true;
      // `stream.session` can be undefined once a stalled stream's session has
      // gone away — keep the optional chaining rather than assuming it's live.
      let session = stream.session;
      let ss = session?.state;
      let st = stream.state;
      // maxConcurrentStreams is negotiated per-session, so the budget signal
      // must compare against this session's own live stream count, not the
      // process-wide total (which spans every browser session).
      let liveThisSession = 0;
      if (session) {
        for (let other of open.keys()) {
          if (other.session === session) {
            liveThisSession++;
          }
        }
      }
      log.warn(
        `[h2-diag] STALLED stream #${rec.id} ${rec.method} ${rec.path} age=${age}ms ` +
          `sawRequest=${rec.sawRequest} ` +
          `res(headersSent=${rec.res?.headersSent ?? 'n/a'} ` +
          `writableEnded=${rec.res?.writableEnded ?? 'n/a'}) ` +
          `stream(closed=${stream.closed} destroyed=${stream.destroyed} ` +
          `aborted=${stream.aborted} ` +
          `localClose=${st?.localClose} remoteClose=${st?.remoteClose} ` +
          `localWindow=${st?.localWindowSize}) ` +
          `session(closed=${session?.closed} destroyed=${session?.destroyed} ` +
          `outboundQueueSize=${ss?.outboundQueueSize} ` +
          `effectiveLocalWindow=${ss?.effectiveLocalWindowSize} ` +
          `effectiveRecvData=${ss?.effectiveRecvDataLength} ` +
          `remoteWindow=${ss?.remoteWindowSize} ` +
          `liveStreamsThisSession=${liveThisSession} liveStreamsTotal=${open.size}) ` +
          `maxConcurrentStreams(local=${session?.localSettings?.maxConcurrentStreams} ` +
          `remote=${session?.remoteSettings?.maxConcurrentStreams})`,
      );
    }

    // Session-level snapshot — see the function comment. Covers the wedges the
    // per-stream sweep above is structurally blind to (request queued before a
    // server stream exists, connection-level flow-control stall, dead transport).
    let healthyPongs = 0;
    for (let [session, srec] of sessions) {
      let inFlight: { rec: TrackedStream; age: number }[] = [];
      for (let [stream, rec] of open) {
        if (stream.session === session) {
          inFlight.push({ rec, age: now - rec.startedAt });
        }
      }
      if (inFlight.length > srec.peakStreams) {
        srec.peakStreams = inFlight.length;
      }
      let pongAge = srec.lastPongAt != null ? now - srec.lastPongAt : undefined;
      let pongHealthy = pongAge != null && pongAge < SWEEP_INTERVAL_MS * 2;
      if (pongHealthy) {
        healthyPongs++;
      }
      // Log a per-session line only when it's doing work or its last ping went
      // unanswered; idle, healthy sessions are covered by the roll-up below.
      let pongOverdue = srec.lastPingAt != null && !pongHealthy;
      if (inFlight.length > 0 || pongOverdue) {
        let ss = session.state;
        let shown = inFlight.slice(0, 12);
        let list = shown
          .map((e) => `${e.rec.method} ${e.rec.path} ${e.age}ms`)
          .join(', ');
        let more =
          inFlight.length > shown.length
            ? ` +${inFlight.length - shown.length} more`
            : '';
        log.warn(
          `[h2-diag] session #${srec.id} ` +
            `streams=${inFlight.length}/peak=${srec.peakStreams}/` +
            `max(local=${session.localSettings?.maxConcurrentStreams} ` +
            `remote=${session.remoteSettings?.maxConcurrentStreams}) ` +
            `win(localEff=${ss?.effectiveLocalWindowSize} ` +
            `remote=${ss?.remoteWindowSize} ` +
            `recvData=${ss?.effectiveRecvDataLength} ` +
            `outQ=${ss?.outboundQueueSize}) ` +
            `ping(rtt=${srec.lastRttMs ?? 'n/a'}ms ` +
            `pongAge=${pongAge != null ? `${pongAge}ms` : 'never'}) ` +
            `inFlight=[${list}${more}]`,
        );
      }
      probeSession(session, srec);
    }
    // Greppable roll-up: a client hang showing `openStreams=0 pingHealthy=N/N`
    // means the request never reached the server (it's wedged client-side or in
    // transit); `openStreams>0` with the hung path in a session's inFlight list
    // means the server received it and the response is what's stuck.
    log.info(
      `[h2-diag] sweep liveSessions=${sessions.size} ` +
        `openStreams=${open.size} pingHealthy=${healthyPongs}/${sessions.size}`,
    );
  }, SWEEP_INTERVAL_MS);
  // Don't let the sweep timer hold the process open during shutdown.
  timer.unref?.();
}

// Same-port 308 redirect for plain-text HTTP requests that land on the
// HTTPS port. The dispatcher binds a single port so the inbound and
// target ports agree; we just rewrite the scheme. Parses via URL so
// bracketed IPv6 authorities (`[::1]:4201`) round-trip cleanly instead
// of being mangled by string-level regex.
//
// 308 (vs 301): preserves the request method and body across the
// redirect. Local scripts that POST to `http://localhost:4201/...`
// (matrix registration/setup writes `/_server-session`, `/_user`,
// webhook endpoints) need that — a 301 makes fetch downgrade the
// follow-up to GET and drops the body, breaking those calls. 308 is
// also semantically correct: this redirect is a permanent property of
// the wire protocol, not a temporary handler decision.
function redirectToHttps(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  let hostHeader = typeof req.headers.host === 'string' ? req.headers.host : '';
  let path = req.url ?? '/';
  let authority: string;
  try {
    let parsed = new URL(`http://${hostHeader || hostFromSocket(req)}`);
    // `url.host` preserves brackets around IPv6 literals and the port if
    // present, which is exactly the form we want in the redirect target.
    authority = parsed.host;
  } catch {
    authority = hostFromSocket(req);
  }
  let location = `https://${authority}${path}`;
  res.writeHead(308, {
    Location: location,
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(`Redirecting to ${location}\n`);
}

// Best-effort fallback when the inbound request has no Host header
// (HTTP/1.0 client). Uses the dispatcher's bound `localAddress:localPort`
// so the redirect goes to the actual listener instead of guessing port
// 443. Brackets IPv6 literals to match URL `host` formatting.
function hostFromSocket(req: http.IncomingMessage): string {
  let addr = req.socket.localAddress ?? 'localhost';
  let port = req.socket.localPort;
  let bracketed = addr.includes(':') ? `[${addr}]` : addr;
  return port ? `${bracketed}:${port}` : bracketed;
}

export class RealmServer {
  private log = logger('realm-server');
  private realms: Realm[];
  private virtualNetwork: VirtualNetwork;
  private matrixClient: MatrixClient;
  private realmServerSecretSeed: string;
  private realmSecretSeed: string;
  private grafanaSecret: string;

  private realmsRootPath: string;
  private dbAdapter: DBAdapter;
  private queue: QueuePublisher;
  private definitionLookup: DefinitionLookup;
  private assetsURL: URL;
  private getIndexHTML: () => Promise<string>;
  private serverURL: URL;
  private matrixRegistrationSecret: string | undefined;
  private matrixAdminUsername: string | undefined;
  private matrixAdminPassword: string | undefined;
  private getRegistrationSecret:
    | (() => Promise<string | undefined>)
    | undefined;
  private cardSizeLimitBytes: number;
  private fileSizeLimitBytes: number;
  private domainsForPublishedRealms:
    | {
        boxelSpace?: string;
        boxelSite?: string;
      }
    | undefined;
  private prerenderer: Prerenderer | undefined;
  private reconciler: RealmRegistryReconciler;
  private searchCache: JobScopedSearchCache;
  private cachedApp: ReturnType<RealmServer['buildApp']> | undefined;

  constructor({
    serverURL,
    realms,
    reconciler,
    virtualNetwork,
    matrixClient,
    realmServerSecretSeed,
    realmSecretSeed,
    grafanaSecret,
    realmsRootPath,
    dbAdapter,
    queue,
    definitionLookup,
    assetsURL,
    getIndexHTML,
    matrixRegistrationSecret,
    matrixAdminUsername,
    matrixAdminPassword,
    getRegistrationSecret,
    domainsForPublishedRealms,
    prerenderer,
    searchCache,
  }: {
    serverURL: URL;
    realms: Realm[];
    reconciler: RealmRegistryReconciler;
    virtualNetwork: VirtualNetwork;
    matrixClient: MatrixClient;
    realmServerSecretSeed: string;
    realmSecretSeed: string;
    grafanaSecret: string;
    realmsRootPath: string;
    dbAdapter: DBAdapter;
    queue: QueuePublisher;
    definitionLookup: DefinitionLookup;
    assetsURL: URL;
    getIndexHTML: () => Promise<string>;
    matrixRegistrationSecret?: string;
    matrixAdminUsername?: string;
    matrixAdminPassword?: string;
    getRegistrationSecret?: () => Promise<string | undefined>;
    enableFileWatcher?: boolean;
    domainsForPublishedRealms?: {
      boxelSpace?: string;
      boxelSite?: string;
    };
    prerenderer?: Prerenderer;
    // Optional so test harnesses that construct a RealmServer directly get a
    // private cache for free. main.ts passes a shared instance so the
    // JobsFinishedListener can evict the same cache the handlers populate.
    searchCache?: JobScopedSearchCache;
  }) {
    if (!matrixRegistrationSecret && !getRegistrationSecret) {
      throw new Error(
        `'matrixRegistrationSecret' or 'getRegistrationSecret' must be specified`,
      );
    }
    detectRealmCollision(realms);
    ensureDirSync(realmsRootPath);

    this.serverURL = serverURL;
    this.cardSizeLimitBytes = Number(
      process.env.CARD_SIZE_LIMIT_BYTES ?? DEFAULT_CARD_SIZE_LIMIT_BYTES,
    );
    this.fileSizeLimitBytes = Number(
      process.env.FILE_SIZE_LIMIT_BYTES ?? DEFAULT_FILE_SIZE_LIMIT_BYTES,
    );
    this.virtualNetwork = virtualNetwork;
    this.matrixClient = matrixClient;

    this.realmSecretSeed = realmSecretSeed;
    this.realmServerSecretSeed = realmServerSecretSeed;
    this.grafanaSecret = grafanaSecret;
    this.realmsRootPath = realmsRootPath;
    this.dbAdapter = dbAdapter;
    this.queue = queue;
    this.definitionLookup = definitionLookup;
    this.assetsURL = assetsURL;
    this.getIndexHTML = getIndexHTML;
    this.matrixRegistrationSecret = matrixRegistrationSecret;
    this.matrixAdminUsername = matrixAdminUsername;
    this.matrixAdminPassword = matrixAdminPassword;
    this.getRegistrationSecret = getRegistrationSecret;
    this.domainsForPublishedRealms = domainsForPublishedRealms;
    // Pass-by-reference: handlers and the reconciler both mutate this
    // array. Copying it would create two divergent views of mounted
    // realms — a bug under multi-instance Phase 3 semantics. The legacy
    // `[...realms]` copy is gone with that constraint.
    this.realms = realms;
    this.reconciler = reconciler;
    this.prerenderer = prerenderer;
    this.searchCache = searchCache ?? new JobScopedSearchCache(dbAdapter);
  }

  get app() {
    return (this.cachedApp ??= this.buildApp());
  }

  private buildApp() {
    let { serveIndex, serveHostApp } = createServeIndex({
      serverURL: this.serverURL,
      assetsURL: this.assetsURL,
      realms: this.realms,
      reconciler: this.reconciler,
      dbAdapter: this.dbAdapter,
      matrixClient: this.matrixClient,
      getIndexHTML: this.getIndexHTML,
      cardSizeLimitBytes: this.cardSizeLimitBytes,
      fileSizeLimitBytes: this.fileSizeLimitBytes,
    });
    let serveFromRealm = createServeFromRealm({
      realms: this.realms,
      reconciler: this.reconciler,
      dbAdapter: this.dbAdapter,
      virtualNetwork: this.virtualNetwork,
    });
    let sendEvent = createSendEvent({
      matrixClient: this.matrixClient,
      dbAdapter: this.dbAdapter,
    });

    let app = new Koa<Koa.DefaultState, Koa.Context>()
      .use(httpLogging)
      .use(ecsMetadata)
      .use(
        cors({
          origin: '*',
          allowHeaders:
            'Authorization, Content-Type, If-Match, If-None-Match, X-Requested-With, X-Boxel-Client-Request-Id, X-Boxel-Assume-User, X-HTTP-Method-Override, X-Boxel-Disable-Module-Cache, X-Filename, X-Boxel-During-Prerender, X-Boxel-Consuming-Realm, X-Boxel-Job-Id, X-Boxel-Job-Priority, X-Boxel-Logging-Correlation-Id, X-Grafana-Device-Id, X-Grafana-Action',
          // Without an explicit expose list, @koa/cors only emits the
          // CORS-safelisted response headers (cache-control, content-*,
          // expires, last-modified, pragma). ETag is not on that list,
          // so cross-origin browser callers (the host SPA inside a
          // prerender tab, or any in-DevTools fetch) get a response
          // whose `headers.get('ETag')` is `null` even though the
          // server emitted one — making the entire revalidation
          // protocol invisible to JS.
          exposeHeaders: 'ETag',
          allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS,QUERY',
          // Cache the preflight response for 24 h. Without this @koa/cors
          // omits Access-Control-Max-Age and Chrome falls back to its
          // ~5 s default, which forces a fresh OPTIONS round-trip in front
          // of nearly every cross-origin QUERY the host fires during a
          // long indexing run. The doubled HTTP-arrival count translates
          // directly to wall-clock since each preflight is a serial RTT
          // blocking the QUERY behind it.
          maxAge: 86400,
        }),
      )
      .use(async (ctx, next) => {
        // Disable browser cache for all data requests to the realm server. The condition captures our supported mime types but not others,
        // such as assets, which we probably want to cache.
        let mimeType = extractSupportedMimeType(
          ctx.header.accept as unknown as null | string | [string],
        );

        if (
          Object.values(SupportedMimeType)
            // Actually, we want to use HTTP caching for executable modules which
            // are requested with the "*/*" accept header
            .filter((m) => m !== '*/*')
            .includes(mimeType as any)
        ) {
          ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        }

        await next();
      })
      .use(convertAcceptHeaderQueryParam)
      .use(methodOverrideSupport)
      .use(
        createRoutes({
          dbAdapter: this.dbAdapter,
          definitionLookup: this.definitionLookup,
          serverURL: this.serverURL.href,
          matrixClient: this.matrixClient,
          realmServerSecretSeed: this.realmServerSecretSeed,
          realmSecretSeed: this.realmSecretSeed,
          grafanaSecret: this.grafanaSecret,
          virtualNetwork: this.virtualNetwork,
          serveHostApp,
          serveIndex,
          serveFromRealm,
          sendEvent,
          queue: this.queue,
          realms: this.realms,
          assetsURL: this.assetsURL,
          realmsRootPath: this.realmsRootPath,
          getMatrixRegistrationSecret: this.getMatrixRegistrationSecret,
          matrixAdminUsername: this.matrixAdminUsername,
          matrixAdminPassword: this.matrixAdminPassword,
          domainsForPublishedRealms: this.domainsForPublishedRealms,
          prerenderer: this.prerenderer,
          reconciler: this.reconciler,
          searchCache: this.searchCache,
        }),
      )
      .use(
        proxyAsset('/auth-service-worker.js', this.assetsURL, {
          requestHeaders: {
            'accept-encoding': 'identity',
          },
        }),
      )
      .use(serveIndex)
      .use(serveFromRealm);

    app.on('error', (err, ctx) => {
      console.error(`Unhandled server error`, err);
      Sentry.withScope((scope) => {
        scope.setSDKProcessingMetadata({ request: ctx.request });
        Sentry.captureException(err);
      });
    });

    return app;
  }

  listen(port: number): RealmHttpServer {
    let { server: instance, proto } = createListener(this.log, this.app);
    instance.listen(port);
    instance.on('listening', () => {
      let actualPort =
        (instance.address() as import('net').AddressInfo | null)?.port ?? port;
      this.log.info(
        `Realm server listening on port %s (%s)\n`,
        actualPort,
        proto,
      );
    });
    return instance;
  }

  async start() {
    // Phase 3: two paths converge here.
    //
    // 1. Constructor-supplied realms — test helpers and any legacy boot
    //    code path push realms directly into `this.realms` before
    //    server.start() runs and expect this method to call
    //    realm.start() on them (it used to do this implicitly via
    //    loadRealms()). They are not in reconciler.knownByUrl, so the
    //    reconcile pass below would skip them. Iterate first, in
    //    insertion order — realms[] is empty in production main.ts, so
    //    this is a no-op there.
    // 2. Reconciler-driven boot — reconciler.reconcile() reads
    //    realm_registry into knownByUrl and eager-mounts every pinned
    //    row via mountFromRow (the main.ts factory), which constructs
    //    a Realm, publishes into realms[] + virtualNetwork, then
    //    awaits realm.start() so each pinned realm is fully indexed
    //    before this method returns. Non-pinned rows are deferred to
    //    findOrMountRealm() on first request.
    //
    // The reconciler's background poll loop (LISTEN realm_registry +
    // 30s safety poll) starts in main.ts after this method returns.
    for (let realm of this.realms) {
      await realm.start();
    }
    await this.reconciler.reconcile();
  }

  get testingOnlyRealms() {
    return [...this.realms];
  }

  // Test-only accessor for the on-disk root that source/published realm
  // disk_ids resolve under. Exposed so download-realm tests can stage a
  // source realm at <realmsRootPath>/<disk_id> + matching realm_registry
  // row to exercise the post-restart code path (CS-11270) without
  // spinning up a full RealmServer for a second realm.
  get testingOnlyRealmsRootPath() {
    return this.realmsRootPath;
  }

  // Test-only accessor for the reconciler. Exposed so realm-auth-test
  // can inspect knownByUrl / mounted as preconditions and assert that
  // _realm-auth does not cold-mount during request handling.
  get testingOnlyReconciler() {
    return this.reconciler;
  }

  testingOnlyUnmountRealms() {
    for (let realm of this.realms) {
      this.virtualNetwork.unmount(realm.handle);
    }
  }

  // Drop a realm from this process's in-memory view to simulate a
  // post-restart state, without tearing down its disk mount, indexer,
  // or matrix client. Two regression-test shapes need different
  // amounts of eviction:
  //
  //   - Default (keepMounted: false) — remove from BOTH `realms[]` and
  //     `reconciler.mounted`, leaving only the realm_registry row /
  //     `knownByUrl` entry. This is the true post-restart state for a
  //     non-pinned realm: a handler that wants the realm must resolve
  //     it from the registry (and would cold-mount via lookupOrMount
  //     if it actually needs a started Realm). realm-auth-test uses
  //     this to prove `_realm-auth` issues a JWT from registry
  //     presence alone, without mounting.
  //
  //   - keepMounted: true — remove from `realms[]` only, leaving the
  //     realm in `reconciler.mounted`. Use this for handlers that DO
  //     route through `reconciler.lookupOrMount` (e.g. the
  //     `_grafana-reindex` path): the test proves the handler consults
  //     the reconciler rather than iterating `realms[]`, while the
  //     mounted fast-path keeps `lookupOrMount` from constructing a
  //     second `Realm` against the already-mounted disk (which would
  //     race on workers / matrix / queue subscribers). The genuine
  //     cold-mount path is covered against the reconciler directly in
  //     lazy-mount-test.ts.
  testingOnlyEvictRealmFromRealmsList(
    url: string,
    opts?: { keepMounted?: boolean },
  ): void {
    let idx = this.realms.findIndex((r) => r.url === url);
    if (idx !== -1) {
      this.realms.splice(idx, 1);
    }
    if (!opts?.keepMounted) {
      this.reconciler.mounted.delete(url);
    }
  }

  // Test-only accessor for the request-path realm resolver. Exposed so
  // lazy-mount integration tests can drive findOrMountRealm directly
  // without spinning up an HTTP listener + mocked Koa context.
  testingOnlyFindOrMountRealm(requestURL: URL): Promise<Realm | undefined> {
    return findOrMountRealm(requestURL, {
      realms: this.realms,
      reconciler: this.reconciler,
      dbAdapter: this.dbAdapter,
    });
  }

  // Test-only synchronous reconcile pass. The production reconciler
  // wakes on NOTIFY realm_registry, but tests need a deterministic
  // way to drive the post-DELETE unmount path without polling.
  testingOnlyReconcile(): Promise<void> {
    return this.reconciler.reconcile();
  }

  // we use a function to get the matrix registration secret because matrix
  // client tests leverage a synapse instance that changes multiple times per
  // realm lifespan, and each new synapse instance has a unique registration
  // secret
  private getMatrixRegistrationSecret = async () => {
    if (this.getRegistrationSecret) {
      let secret = await this.getRegistrationSecret();
      if (!secret) {
        throw new Error(
          `the getRegistrationSecret() function returned no secret`,
        );
      }
      return secret;
    }

    if (this.matrixRegistrationSecret) {
      return this.matrixRegistrationSecret;
    }

    throw new Error(`Can not determine the matrix registration secret`);
  };
}

function detectRealmCollision(realms: Realm[]): void {
  let collisions: string[] = [];
  let realmsURLs = realms.map(({ url }) => ({
    url,
    path: new URL(url).pathname,
  }));
  for (let realmA of realmsURLs) {
    for (let realmB of realmsURLs) {
      if (realmA.path.length > realmB.path.length) {
        if (realmA.path.startsWith(realmB.path)) {
          collisions.push(`${realmA.url} collides with ${realmB.url}`);
        }
      }
    }
  }
  if (collisions.length > 0) {
    throw new Error(
      `Cannot start realm server--realm route collisions detected: ${JSON.stringify(
        collisions,
      )}`,
    );
  }
}
