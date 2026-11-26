/**
 * A loopback stand-in for the realm server's OpenRouter passthrough, for a
 * profile signed in with OAuth.
 *
 * opencode's provider sends a fixed `Authorization` header on every call and
 * never refreshes it. A Matrix profile hands it a 7-day realm-server session,
 * but an OAuth access token lasts only minutes, and boxel-cli gives an OAuth
 * profile's token to no one (`getServerToken()` refuses). So opencode is
 * pointed here instead: each call is checked against a bearer made for this
 * process alone, then sent on to the realm server's
 * `/_openrouter/chat/completions` through `forward`, which is boxel-cli's
 * authed fetch and refreshes the OAuth token as needed. The OAuth token never
 * leaves the factory process.
 */

import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

export const CHAT_COMPLETIONS_PATH = '/chat/completions';

// A chat request carries the whole conversation, tool results included, so
// the cap is generous; it only stops a runaway body.
const MAX_BODY_BYTES = 32 * 1024 * 1024;

// Sends a chat-completions body on to the realm server and answers with its
// response. `signal` aborts when opencode stops waiting.
export type ForwardChatCompletion = (
  body: string,
  signal: AbortSignal,
) => Promise<Response>;

export interface OpenRouterForwarder {
  // What opencode's provider takes as its `baseURL`: the AI SDK appends
  // `/chat/completions`.
  baseURL: string;
  // The `Authorization` header opencode must send.
  authorization: string;
  close(): Promise<void>;
}

export async function startOpenRouterForwarder(
  forward: ForwardChatCompletion,
  {
    describeError = (error: unknown) =>
      error instanceof Error ? error.message : String(error),
    statusFor = () => 502,
  }: {
    // How a failed forward is told to opencode. An error that says what the
    // user can do, such as signing in again, reaches the model's transcript
    // and the factory's log this way.
    describeError?: (error: unknown) => string;
    // The status a failed forward is answered with. opencode retries any
    // 5xx without end, so an error no retry can fix, such as a connection
    // that has ended, must be answered with a 4xx or the factory looks hung.
    statusFor?: (error: unknown) => number;
  } = {},
): Promise<OpenRouterForwarder> {
  let bearer = Buffer.from(
    `Bearer ${randomBytes(32).toString('base64url')}`,
    'utf8',
  );

  let server = createServer(async (req, res) => {
    let url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'POST' || url.pathname !== CHAT_COMPLETIONS_PATH) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not found' } }));
      req.resume();
      return;
    }
    if (!presents(req, bearer)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized' } }));
      req.resume();
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch (error) {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: describeError(error) } }));
      return;
    }

    let abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) {
        abort.abort();
      }
    });

    let upstream: Response;
    try {
      upstream = await forward(body, abort.signal);
    } catch (error) {
      if (abort.signal.aborted) {
        return;
      }
      res.writeHead(statusFor(error), { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: describeError(error) } }));
      return;
    }

    let headers: Record<string, string> = {};
    for (let name of ['content-type', 'cache-control']) {
      let value = upstream.headers.get(name);
      if (value) {
        headers[name] = value;
      }
    }
    res.writeHead(upstream.status, headers);
    if (!upstream.body) {
      res.end();
      return;
    }
    let stream = Readable.fromWeb(
      upstream.body as import('node:stream/web').ReadableStream,
    );
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  let { port } = server.address() as AddressInfo;

  return {
    baseURL: `http://127.0.0.1:${port}`,
    authorization: bearer.toString('utf8'),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function presents(req: IncomingMessage, bearer: Buffer): boolean {
  let header = req.headers['authorization'];
  if (typeof header !== 'string') {
    return false;
  }
  let given = Buffer.from(header, 'utf8');
  return given.length === bearer.length && timingSafeEqual(given, bearer);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let chunks: Buffer[] = [];
  let size = 0;
  for await (let chunk of req) {
    let buffer = Buffer.from(chunk as Buffer);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error(
        `The request body is over ${MAX_BODY_BYTES} bytes, the most the forwarder sends on.`,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
