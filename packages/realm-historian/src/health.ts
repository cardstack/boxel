// The health endpoint. `GET /health` answers 200 while the main loop has
// beaten the heartbeat within `staleAfterMs`, whether the task holds a lease
// or is waiting for one, and 503 once the loop has stalled. A standby task
// must report healthy, or ECS would never let it replace the old one.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export class Heartbeat {
  #now: () => number;
  #lastBeatAt: number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
    this.#lastBeatAt = now();
  }

  beat(): void {
    this.#lastBeatAt = this.#now();
  }

  ageMs(): number {
    return this.#now() - this.#lastBeatAt;
  }
}

export interface HealthServerOptions {
  port: number;
  heartbeat: Heartbeat;
  staleAfterMs: number;
}

export interface HealthServer {
  port: number;
  close(): Promise<void>;
}

export async function startHealthServer({
  port,
  heartbeat,
  staleAfterMs,
}: HealthServerOptions): Promise<HealthServer> {
  let server: Server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    let ageMs = heartbeat.ageMs();
    if (ageMs <= staleAfterMs) {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    } else {
      response
        .writeHead(503, { 'content-type': 'text/plain' })
        .end(`the loop has not run for ${ageMs}ms`);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
