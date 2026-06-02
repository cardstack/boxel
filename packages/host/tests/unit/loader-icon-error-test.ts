import { module, test } from 'qunit';

import { Loader } from '@cardstack/runtime-common';
import { iconNotFoundMessage } from '@cardstack/runtime-common/error';

const ICON_BASE =
  'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons';
const LOCAL_ICON_BASE = 'http://localhost:4206/@cardstack/boxel-icons/v1/icons';
const EXPECTED_MESSAGE =
  'Icon "person-circle" was not found in @cardstack/boxel-icons. Check the import path against the available icons.';

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
      assert.strictEqual(err.message, EXPECTED_MESSAGE);
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
      assert.strictEqual(err.message, EXPECTED_MESSAGE);
    }
  });
});

module('Unit | loader | iconNotFoundMessage', function () {
  test('translates a 403 from the production icon CDN', function (assert) {
    assert.strictEqual(
      iconNotFoundMessage(`${ICON_BASE}/person-circle.js`, 403),
      EXPECTED_MESSAGE,
    );
  });

  test('translates a 404 from the local icons server', function (assert) {
    assert.strictEqual(
      iconNotFoundMessage(`${LOCAL_ICON_BASE}/person-circle.js`, 404),
      EXPECTED_MESSAGE,
    );
  });

  test('ignores statuses other than 403/404', function (assert) {
    assert.strictEqual(
      iconNotFoundMessage(`${ICON_BASE}/person-circle.js`, 500),
      undefined,
    );
  });

  test('ignores non-icon module URLs', function (assert) {
    assert.strictEqual(
      iconNotFoundMessage('https://example.com/some/module.js', 403),
      undefined,
    );
  });

  test('ignores icon-path requests that are not .js modules', function (assert) {
    // The meta manifest lives on the same CDN but is not an icon module.
    assert.strictEqual(
      iconNotFoundMessage(`${ICON_BASE}/../boxel-icons-meta.js`, 403),
      // normalized URL drops the icons/ segment, so no match
      undefined,
    );
    assert.strictEqual(
      iconNotFoundMessage(`${ICON_BASE}/person-circle`, 403),
      undefined,
    );
  });

  test('ignores an empty icon name', function (assert) {
    assert.strictEqual(iconNotFoundMessage(`${ICON_BASE}/.js`, 403), undefined);
  });

  test('ignores an unparseable URL', function (assert) {
    assert.strictEqual(iconNotFoundMessage('not a url', 403), undefined);
  });
});
