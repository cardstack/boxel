import type { ResponseWithNodeStream } from '@cardstack/runtime-common';
import { VirtualNetwork } from '@cardstack/runtime-common';
import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import '../setup-logger.ts';

module(basename(import.meta.filename), function () {
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

    test('can resolve mapped URLs in both directions', function (assert) {
      let virtualNetwork = new VirtualNetwork();
      virtualNetwork.addURLMapping(
        new URL('http://localhost:4205/test/'),
        new URL('http://localhost:45123/test/'),
      );

      assert.strictEqual(
        virtualNetwork.mapURL(
          'http://localhost:4205/test/hassan/personal/_readiness-check',
          'virtual-to-real',
        )?.href,
        'http://localhost:45123/test/hassan/personal/_readiness-check',
      );
      assert.strictEqual(
        virtualNetwork.mapURL(
          'http://localhost:45123/test/hassan/personal/_readiness-check',
          'real-to-virtual',
        )?.href,
        'http://localhost:4205/test/hassan/personal/_readiness-check',
      );
    });

    test('toURLHref resolves like toURL and tracks mapping changes', function (assert) {
      let virtualNetwork = new VirtualNetwork();
      virtualNetwork.addRealmMapping(
        '@cardstack/skills/',
        'https://localhost:4201/skills/',
      );
      assert.strictEqual(
        virtualNetwork.toURLHref('@cardstack/skills/Skill/foo'),
        virtualNetwork.toURL('@cardstack/skills/Skill/foo').href,
        'prefix-form resolves identically to toURL().href',
      );
      assert.strictEqual(
        virtualNetwork.toURLHref('https://example.com/a?b=c#d'),
        'https://example.com/a?b=c#d',
        'URL-form normalizes identically to toURL().href',
      );
      // Cached entries must not outlive the mappings they were derived from.
      virtualNetwork.removeRealmMapping('@cardstack/skills/');
      assert.throws(
        () => virtualNetwork.toURLHref('@cardstack/skills/Skill/foo'),
        'a cached resolution is dropped when its mapping is removed',
      );
      // A failed resolution must not be negatively cached.
      virtualNetwork.addRealmMapping(
        '@cardstack/skills/',
        'https://localhost:4201/skills/',
      );
      assert.strictEqual(
        virtualNetwork.toURLHref('@cardstack/skills/Skill/foo'),
        'https://localhost:4201/skills/Skill/foo',
        'resolution recovers after the mapping is re-registered',
      );
    });

    test('unresolveURL memo is invalidated when a realm mapping is added', function (assert) {
      let virtualNetwork = new VirtualNetwork();
      let url = 'https://localhost:4201/skills/Skill/foo';
      // No matching prefix yet: the url is returned unchanged, and that
      // passthrough is memoized.
      assert.strictEqual(
        virtualNetwork.unresolveURL(url),
        url,
        'with no matching prefix the url is returned as-is',
      );
      virtualNetwork.addRealmMapping(
        '@cardstack/skills/',
        'https://localhost:4201/skills/',
      );
      assert.strictEqual(
        virtualNetwork.unresolveURL(url),
        '@cardstack/skills/Skill/foo',
        'the newly-added prefix takes effect instead of the cached passthrough',
      );
    });

    test('unresolveURL memo is invalidated when a realm mapping is removed', function (assert) {
      let virtualNetwork = new VirtualNetwork();
      virtualNetwork.addRealmMapping(
        '@cardstack/skills/',
        'https://localhost:4201/skills/',
      );
      let url = 'https://localhost:4201/skills/Skill/foo';
      assert.strictEqual(
        virtualNetwork.unresolveURL(url),
        '@cardstack/skills/Skill/foo',
        'a mapped url unresolves to its RRI form',
      );
      virtualNetwork.removeRealmMapping('@cardstack/skills/');
      assert.strictEqual(
        virtualNetwork.unresolveURL(url),
        url,
        'removing the prefix drops the cached RRI and returns the url as-is',
      );
    });

    test('unresolveURL memo is invalidated when a URL mapping is added', function (assert) {
      let virtualNetwork = new VirtualNetwork();
      virtualNetwork.addRealmMapping(
        '@cardstack/base/',
        'http://localhost:4201/base/',
      );
      let virtualURL = 'https://cardstack.com/base/card-api';
      // The real target is registered, but the virtual alias has no URL
      // mapping yet, so it cannot be chased to the real form and passes
      // through unchanged (and is memoized as such).
      assert.strictEqual(
        virtualNetwork.unresolveURL(virtualURL),
        virtualURL,
        'without a URL mapping the virtual alias is returned as-is',
      );
      virtualNetwork.addURLMapping(
        new URL('https://cardstack.com/base/'),
        new URL('http://localhost:4201/base/'),
      );
      // unresolveURL chases urlMappings, so the new mapping must invalidate
      // the memo and let the virtual alias resolve to its RRI form.
      assert.strictEqual(
        virtualNetwork.unresolveURL(virtualURL),
        '@cardstack/base/card-api',
        'the virtual alias now chases through the URL mapping to its RRI form',
      );
    });

    test('resolveURL: root-relative ref joins against the mapped URL of a prefix-form base', function (assert) {
      let virtualNetwork = new VirtualNetwork();
      virtualNetwork.addRealmMapping(
        '@cardstack/skills/',
        'https://localhost:4201/skills/',
      );
      // URL-form base: plain URL-join.
      assert.strictEqual(
        virtualNetwork.resolveURL(
          '/bar',
          'https://localhost:4201/skills/Skill/foo',
        ).href,
        'https://localhost:4201/bar',
      );
      // Prefix-form base: resolve to the mapped URL first, then join.
      assert.strictEqual(
        virtualNetwork.resolveURL('/bar', '@cardstack/skills/Skill/foo').href,
        'https://localhost:4201/bar',
      );
    });
  });
});
