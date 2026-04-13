import { module, test } from 'qunit';

import { createBoxelRealmFetch } from '../src/realm-auth';

// Note: most of the original realm-auth tests covered features that no
// longer exist after CS-10642 — explicit `authorization` overrides, profile
// injection, env-var fallback, prime-realm-URL, and strict profile-file
// parsing. Auth is now owned by `@cardstack/boxel-cli`'s ProfileManager
// singleton; createBoxelRealmFetch is a one-line wrapper that delegates to
// `createRealmFetch` when the resource URL shares an origin with the active
// profile's realm-server URL, and falls back to plain fetch otherwise.
//
// The single behavior worth asserting at this layer is that a non-matching
// origin (or no profile) returns the unchanged fetch implementation —
// preserving the "public URLs go through plain fetch" semantic the factory
// relies on for cross-server brief loading.

module('realm-auth', function () {
  test('createBoxelRealmFetch returns the supplied fetch when no profile is active', function (assert) {
    let stubFetch = (async () => new Response('ok')) as typeof globalThis.fetch;

    // No profile is active in this test process; createBoxelRealmFetch
    // should return the supplied fetch unchanged rather than throw.
    let returned = createBoxelRealmFetch(
      'http://127.0.0.1:4011/private/Wiki/brief-card',
      { fetch: stubFetch },
    );

    assert.strictEqual(returned, stubFetch);
  });
});
