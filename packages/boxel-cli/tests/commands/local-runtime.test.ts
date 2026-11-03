import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { BoxelRuntimeClient } from '../../src/lib/boxel-runtime-client.ts';

describe('native runtime client', () => {
  it('uses the native lifecycle protocol and rejects incompatible status', async () => {
    let calls: string[] = [];
    let protocolVersion = 1;
    let server = createServer((request, response) => {
      calls.push(`${request.method} ${request.url}`);
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          ok: true,
          status: {
            protocolVersion,
            stack: 'default',
            mode: 'local',
            state: request.url?.endsWith('down') ? 'stopped' : 'ready',
            url: 'http://app.default.boxel.localhost:4242',
            dataDir: '/native/private',
            services: {
              worker: {
                name: 'worker',
                state: 'ready',
                managed: true,
                pid: 123,
                lastError: null,
                logPath: '/native/private/log',
              },
            },
          },
          result: {
            ok: true,
            stack: 'default',
            checks: [{ name: 'manifest', ok: true, detail: 'parsed' }],
          },
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    let address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP listener');
    try {
      let client = new BoxelRuntimeClient(`http://127.0.0.1:${address.port}`);
      expect((await client.up()).services.worker.pid).toBe(123);
      expect(JSON.stringify(await client.status())).not.toContain(
        '/native/private',
      );
      expect((await client.doctor()).ok).toBe(true);
      expect((await client.down()).state).toBe('stopped');
      expect(calls).toEqual([
        'POST /v1/stacks/default/up',
        'GET /v1/stacks/default/status',
        'GET /v1/stacks/default/doctor',
        'POST /v1/stacks/default/down',
      ]);
      protocolVersion = 2;
      await expect(client.status()).rejects.toThrow('incompatible');
      await expect(client.up('../other')).rejects.toThrow(
        'Invalid local stack',
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('does not send native authority to remote or credential-bearing endpoints', () => {
    for (let url of [
      'https://example.com',
      'http://localhost',
      'http://127.0.0.1/path',
      'http://secret@127.0.0.1',
      'http://127.0.0.1/?secret=x',
    ])
      expect(() => new BoxelRuntimeClient(url)).toThrow();
  });
});
