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

  // `resolveImport` is an import map (ADR 010 §1.2): the longest matching
  // prefix wins, and a remainder cannot escape the target it was matched to.
  module('virtual-network prefix matching', function () {
    const OUTER = 'http://realm.example/outer/';
    const NESTED = 'http://realm.example/outer/nested/';

    // Both registration orders, so the assertions hold because of the
    // prefixes' lengths and not because of which was registered first.
    function eachOrder(
      register: (vn: VirtualNetwork) => void,
      registerOther: (vn: VirtualNetwork) => void,
    ): [string, VirtualNetwork][] {
      let shortFirst = new VirtualNetwork();
      register(shortFirst);
      registerOther(shortFirst);
      let longFirst = new VirtualNetwork();
      registerOther(longFirst);
      register(longFirst);
      return [
        ['shorter prefix registered first', shortFirst],
        ['longer prefix registered first', longFirst],
      ];
    }

    test('resolveImport: the longest matching prefix wins, whatever the registration order', function (assert) {
      for (let [order, vn] of eachOrder(
        (vn) => vn.addRealmMapping('@scope/realm/', OUTER),
        (vn) => vn.addRealmMapping('@scope/realm/nested/', NESTED),
      )) {
        assert.strictEqual(
          vn.resolveImport('@scope/realm/nested/card'),
          `${NESTED}card`,
          `${order}: a specifier under the nested prefix maps to the nested target`,
        );
        assert.strictEqual(
          vn.resolveImport('@scope/realm/card'),
          `${OUTER}card`,
          `${order}: a specifier under only the outer prefix maps to the outer target`,
        );
        assert.strictEqual(
          vn.toURL('@scope/realm/nested/card').href,
          `${NESTED}card`,
          `${order}: toURL applies the same rule`,
        );
      }
    });

    test('unresolveURL: the deepest matching target wins, whatever the registration order', function (assert) {
      for (let [order, vn] of eachOrder(
        (vn) => vn.addRealmMapping('@scope/root/', 'http://realm.example/'),
        (vn) =>
          vn.addRealmMapping('@scope/base/', 'http://realm.example/base/'),
      )) {
        assert.strictEqual(
          vn.unresolveURL('http://realm.example/base/card-api'),
          '@scope/base/card-api',
          `${order}: a URL under the nested target gets the nested prefix`,
        );
        assert.strictEqual(
          vn.unresolveURL('http://realm.example/other/card'),
          '@scope/root/other/card',
          `${order}: a URL under only the root target gets the root prefix`,
        );
        assert.strictEqual(
          vn.resolveURL('$REALM/x', 'http://realm.example/base/card-api').href,
          'http://realm.example/base/x',
          `${order}: $REALM/ resolves against the deepest realm holding the base`,
        );
      }
    });

    test('mapURL: the deepest matching URL mapping wins, whatever the registration order', function (assert) {
      for (let [order, vn] of eachOrder(
        (vn) =>
          vn.addURLMapping(
            new URL('https://alias.example/'),
            new URL('http://real.example/root/'),
          ),
        (vn) =>
          vn.addURLMapping(
            new URL('https://alias.example/base/'),
            new URL('http://real.example/base/'),
          ),
      )) {
        assert.strictEqual(
          vn.mapURL('https://alias.example/base/card-api', 'virtual-to-real')
            ?.href,
          'http://real.example/base/card-api',
          `${order}: virtual-to-real takes the deeper mapping`,
        );
        assert.strictEqual(
          vn.mapURL('https://alias.example/other/card', 'virtual-to-real')
            ?.href,
          'http://real.example/root/other/card',
          `${order}: a URL under only the root mapping takes that one`,
        );
        assert.strictEqual(
          vn.mapURL('http://real.example/base/card-api', 'real-to-virtual')
            ?.href,
          'https://alias.example/base/card-api',
          `${order}: real-to-virtual takes the deeper mapping too`,
        );
      }
    });

    test('resolveImport: a plain remainder resolves under the target', function (assert) {
      let vn = new VirtualNetwork();
      vn.addRealmMapping('@scope/realm/', OUTER);
      assert.strictEqual(
        vn.resolveImport('@scope/realm/cards/person.gts'),
        `${OUTER}cards/person.gts`,
      );
      assert.strictEqual(
        vn.resolveImport('@scope/realm/'),
        OUTER,
        'the prefix alone resolves to the target itself',
      );
      assert.strictEqual(
        vn.resolveImport('@scope/realm/cards/./person'),
        `${OUTER}cards/person`,
        'a dot segment that stays inside the target is folded, not refused',
      );
    });

    test('resolveImport: a remainder cannot escape its target', function (assert) {
      let vn = new VirtualNetwork();
      // Two realms on one origin: the escape must not land in the other one.
      vn.addRealmMapping('@scope/realm/', 'http://realm.example/realm/');
      vn.addRealmMapping('@scope/other/', 'http://realm.example/other/');
      assert.throws(
        () => vn.resolveImport('@scope/realm/../other/secret'),
        TypeError,
        'a ../ remainder is a TypeError, as under an import map',
      );
      assert.throws(
        () => vn.toURL('@scope/realm/../other/secret'),
        TypeError,
        'toURL refuses the same remainder',
      );
      assert.throws(
        () => vn.resolveURL('./x', '@scope/realm/../other/secret'),
        TypeError,
        'a base outside its realm is refused as well',
      );
      assert.strictEqual(
        vn.resolveImport('@scope/realm//other/secret'),
        'http://realm.example/realm//other/secret',
        'a remainder that starts with / is appended to the target, not resolved from the origin',
      );
    });
  });
});
