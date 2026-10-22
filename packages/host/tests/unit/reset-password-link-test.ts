import { module, test } from 'qunit';

import { resetPasswordParamsFrom } from '@cardstack/host/lib/reset-password-link';

// A reset email's link carries the client secret in its query string and the
// email address in its fragment, and the Matrix server appends `sid` to the
// end of the link, so it lands wherever the link ends.
module('Unit | reset-password-link', function () {
  test('reads a link whose fragment carries the email address and sid', function (assert) {
    assert.deepEqual(
      resetPasswordParamsFrom(
        { clientSecret: 'secret-1', port: '53412' },
        '#email=user%40example.test&sid=sid-1',
      ),
      {
        params: {
          sid: 'sid-1',
          clientSecret: 'secret-1',
          email: 'user@example.test',
        },
        inFragment: true,
      },
    );
  });

  test('reads a link with no fragment, which names no account', function (assert) {
    assert.deepEqual(
      resetPasswordParamsFrom({ clientSecret: 'secret-1', sid: 'sid-1' }, ''),
      {
        params: { sid: 'sid-1', clientSecret: 'secret-1', email: undefined },
        inFragment: false,
      },
    );
  });

  test('is no reset without both the sid and the client secret', function (assert) {
    assert.strictEqual(
      resetPasswordParamsFrom({ clientSecret: 'secret-1' }, '#email=a%40b.test')
        .params,
      undefined,
      'no sid',
    );
    assert.strictEqual(
      resetPasswordParamsFrom({}, '#email=a%40b.test&sid=sid-1').params,
      undefined,
      'no client secret',
    );
    assert.strictEqual(
      resetPasswordParamsFrom({ clientSecret: null, sid: null }, '').params,
      undefined,
      'unset query params',
    );
  });
});
