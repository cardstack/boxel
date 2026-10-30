import { module, test } from 'qunit';

import { credentialFieldsURL } from '@cardstack/host/lib/credential-fields';

// The frame is told its form and the page's origin in the URL fragment. A
// filter in front of a deployed secure origin refuses a query string naming a
// loopback origin, so a page on this machine passes them in the fragment
// alone; a page anywhere else passes them in the query as well.
module('Unit | credential-fields-url', function () {
  function parts(href: string) {
    let url = new URL(href);
    return {
      path: `${url.origin}${url.pathname}`,
      query: Object.fromEntries(url.searchParams),
      fragment: Object.fromEntries(new URLSearchParams(url.hash.slice(1))),
    };
  }

  test('a page on this machine passes its origin in the fragment alone', function (assert) {
    for (let origin of [
      'https://localhost:4200',
      'http://localhost:7357',
      'http://127.0.0.1:4200',
      'https://host.my-branch.localhost',
      'http://[::1]:4200',
    ]) {
      let { path, query, fragment } = parts(
        credentialFieldsURL(
          'https://secure.stack.cards/',
          'change-password',
          origin,
        ),
      );
      assert.strictEqual(
        path,
        'https://secure.stack.cards/credentials',
        origin,
      );
      assert.deepEqual(query, {}, `${origin}: no query`);
      assert.deepEqual(
        fragment,
        { form: 'change-password', origin },
        `${origin}: the fragment`,
      );
    }
  });

  test('a page anywhere else passes them in the query as well', function (assert) {
    let origin = 'https://realms-staging.stack.cards';
    let { query, fragment } = parts(
      credentialFieldsURL(
        'https://secure.stack.cards/',
        'confirm-password',
        origin,
      ),
    );
    assert.deepEqual(query, { form: 'confirm-password', origin }, 'the query');
    assert.deepEqual(
      fragment,
      { form: 'confirm-password', origin },
      'the fragment',
    );
  });

  test('the frame is beneath the secure origin path, with or without a trailing slash', function (assert) {
    for (let secureOriginURL of [
      'https://localhost:4208/secure',
      'https://localhost:4208/secure/',
    ]) {
      assert.strictEqual(
        parts(
          credentialFieldsURL(
            secureOriginURL,
            'change-password',
            'https://localhost:4200',
          ),
        ).path,
        'https://localhost:4208/secure/credentials',
        secureOriginURL,
      );
    }
  });
});
