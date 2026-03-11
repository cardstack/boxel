import { createServer } from 'http';
import { describe, expect, it } from 'vitest';
import { VirtualNetwork } from '@cardstack/runtime-common';

describe('virtual-network-binary-test.ts', function () {
  describe('VirtualNetwork body remapping', function () {
    it('preserves binary request bodies when fetch remaps virtual urls to real urls', async function () {
      let receivedUrl: string | undefined;
      let receivedBody: Uint8Array | undefined;
      let server = createServer((request, response) => {
        receivedUrl = `http://${request.headers.host}${request.url}`;
        let chunks: Buffer[] = [];
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        request.on('end', () => {
          receivedBody = new Uint8Array(Buffer.concat(chunks));
          response.statusCode = 204;
          response.end();
        });
      });

      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      let address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Could not determine virtual network test server port');
      }

      try {
        let virtualNetwork = new VirtualNetwork();
        virtualNetwork.addURLMapping(
          new URL('http://test-realm/test/'),
          new URL(`http://127.0.0.1:${address.port}/test/`),
        );

        let body = new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe,
        ]);
        let response = await virtualNetwork.fetch(
          'http://test-realm/test/upload.bin',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
            },
            body,
          },
        );

        expect(response.status).toBe(204);
        expect(receivedUrl).toBe(
          `http://127.0.0.1:${address.port}/test/upload.bin`,
        );
        expect(receivedBody).toEqual(body);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });

    it('preserves binary request bodies when handle remaps real urls to virtual urls', async function () {
      let receivedUrl: string | undefined;
      let receivedBody: Uint8Array | undefined;
      let virtualNetwork = new VirtualNetwork();
      virtualNetwork.mount(async (request) => {
        receivedUrl = request.url;
        receivedBody = new Uint8Array(await request.arrayBuffer());
        return new Response(null, { status: 204 });
      });

      virtualNetwork.addURLMapping(
        new URL('http://test-realm/test/'),
        new URL('http://127.0.0.1:4444/test/'),
      );

      let body = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe,
      ]);
      let response = await virtualNetwork.handle(
        new Request('http://127.0.0.1:4444/test/upload.bin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
          },
          body,
        }),
      );

      expect(response.status).toBe(204);
      expect(receivedUrl).toBe('http://test-realm/test/upload.bin');
      expect(receivedBody).toEqual(body);
    });
  });
});
