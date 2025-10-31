import type { ResponseWithNodeStream } from '@cardstack/runtime-common';
import { VirtualNetwork } from '@cardstack/runtime-common';
import { module, test } from 'qunit';
import { basename } from 'path';

module(basename(__filename), function () {
  module('virtual-network', function () {
    test('will respond with real (not virtual) url when handler makes a redirect', async function (assert) {
      let virtualNetwork = new VirtualNetwork();
      virtualNetwork.addURLMapping(
        new URL('https://cardstack.com/base/'),
        new URL('http://localhost:4201/base/'),
      );
      virtualNetwork.mount(async (_request: Request) => {
        // Normally there would be some redirection logic here, but for this test we just want to make sure that the redirect is handled correctly
        return new Response(null, {
          status: 302,
          headers: {
            Location: 'https://cardstack.com/base/__boxel/assets/', // This virtual url should be converted to a real url so that the client can follow the redirect
          },
        }) as ResponseWithNodeStream;
      });

      let response = await virtualNetwork.handle(
        new Request('http://localhost:4201/__boxel/assets/'),
      );

      assert.strictEqual(response.status, 302);
      assert.strictEqual(
        response.headers.get('Location'),
        'http://localhost:4201/base/__boxel/assets/',
      );
    });

    test('is able to follow redirects', async function (assert) {
      let virtualNetwork = new VirtualNetwork();

      virtualNetwork.mount(async (request: Request) => {
        // Normally there would be some redirection logic here, but for this test we just want to make sure that the redirect is handled correctly
        if (request.url == 'http://test-realm/test/person') {
          return new Response(null, {
            status: 302,
            headers: {
              Location: 'http://test-realm/test/person.gts',
            },
          }) as ResponseWithNodeStream;
        }

        return null;
      });

      virtualNetwork.mount(async (request: Request) => {
        if (request.url == 'http://test-realm/test/person.gts') {
          return new Response(null, { status: 200 });
        }
        return null;
      });

      let response = await virtualNetwork.fetch(
        `http://test-realm/test/person`,
      );
      assert.strictEqual(response.url, 'http://test-realm/test/person.gts');
      assert.true(response.redirected);
    });
  });
});
