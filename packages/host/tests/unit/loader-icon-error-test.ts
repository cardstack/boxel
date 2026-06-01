import { module, test } from 'qunit';

import { Loader } from '@cardstack/runtime-common';

const ICON_BASE =
  'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons';

// Builds a bare Loader (no middleware) wrapping a fetch that returns the given
// status. The host's loader-service has an icon-fallback middleware that
// rewrites failed icon fetches to a 404 placeholder module, so a missing icon
// never errors there. The indexing worker's loader has no such middleware,
// which is the path this test stands in for: a missing icon must surface a
// user-actionable CardError rather than the raw S3 AccessDenied XML.
function loaderReturning(status: number, body: string) {
  let fetch = (async () =>
    new Response(body, {
      status,
      statusText: status === 403 ? 'Forbidden' : 'Not Found',
    })) as unknown as typeof globalThis.fetch;
  return new Loader(fetch);
}

const ACCESS_DENIED_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>';

module('Unit | loader | missing boxel icon', function () {
  test('403 for a missing icon throws a user-actionable error, not the S3 XML', async function (assert) {
    let loader = loaderReturning(403, ACCESS_DENIED_XML);
    try {
      await loader.import(`${ICON_BASE}/person-circle.js`);
      assert.ok(false, 'expected the import to reject');
    } catch (err: any) {
      assert.strictEqual(
        err.message,
        'Icon "person-circle" was not found in @cardstack/boxel-icons. Check the import path against the available icons.',
      );
      assert.notOk(
        /AccessDenied/.test(err.message),
        'raw S3 XML does not leak into the message',
      );
    }
  });

  test('404 for a missing icon (local icons server) throws the same message', async function (assert) {
    let loader = loaderReturning(404, 'Not Found');
    try {
      await loader.import(`${ICON_BASE}/person-circle.js`);
      assert.ok(false, 'expected the import to reject');
    } catch (err: any) {
      assert.strictEqual(
        err.message,
        'Icon "person-circle" was not found in @cardstack/boxel-icons. Check the import path against the available icons.',
      );
    }
  });
});
