import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { Loader } from '@cardstack/runtime-common';

// A class is identified by the module it CAME FROM, not by the address
// somebody used to ask for it.
//
// Those differ whenever the server answers with a redirect, and the versioned
// package space redirects on purpose: `greeter@^2.0.0` is served as a 302 to
// `greeter@2.2.0`. `deck-the-range-is-on-disk.md` says an instance may pin a
// range so a compatible release moves it forward without rewriting a file, and
// that the type which runs is whatever the resolver picked — so a key built
// from the range contradicts the ruling it is supposed to implement.
//
// This was not theoretical. Three instances of one Greeter indexed under three
// type keys: `greeter@%5E1.0.0/index/Greeter`, `greeter@%5E2.0.0/index/Greeter`
// and `greeter@2.2.0/index/Greeter`. A search for any one of them found none
// of the others, and two instances running the identical class were different
// types to the index.

const EXACT = 'https://ex.test/demo/_packages/acme/greeter@2.2.0/index.js';
const RANGE = 'https://ex.test/demo/_packages/acme/greeter@%5E2.0.0/index.js';
const SOURCE = 'export class Greeter {}\n';

/** A fetch that answers the range spelling with the exact module's bytes and
 *  reports the exact URL as the response's, which is what a followed 302
 *  produces. */
function redirectingFetch(seen: string[]) {
  return async (urlOrRequest: any) => {
    let href =
      typeof urlOrRequest === 'string'
        ? urlOrRequest
        : (urlOrRequest.url ?? String(urlOrRequest));
    seen.push(href);
    let response = new Response(SOURCE, {
      status: 200,
      headers: { 'content-type': 'application/javascript' },
    });
    // `Response.url` is empty on a hand-built response; a real followed
    // redirect sets it to where the bytes came from. Shadow the getter so the
    // loader reads what it would read in production.
    Object.defineProperty(response, 'url', { value: EXACT });
    return response as any;
  };
}

module(basename(import.meta.filename), function () {
  module('the range is an address, not a name', function () {
    test('a redirected module is identified by where it came from', async function (assert) {
      let seen: string[] = [];
      let loader = new Loader(redirectingFetch(seen));
      let mod = await loader.import<{ Greeter: Function }>(RANGE);
      let identity = Loader.identify(mod.Greeter);

      assert.deepEqual(
        identity,
        // No `.js`: identities are recorded extension-trimmed, as code refs
        // are persisted.
        {
          module: 'https://ex.test/demo/_packages/acme/greeter@2.2.0/index',
          name: 'Greeter',
        },
        'the exact Version answers, so the exact Version is the identity',
      );
      assert.strictEqual(
        seen[0],
        RANGE,
        'the range is still what was REQUESTED — it stays on disk',
      );
    });

    test('both spellings land on one identity', async function (assert) {
      let loader = new Loader(redirectingFetch([]));
      let viaRange = await loader.import<{ Greeter: Function }>(RANGE);
      let viaExact = await loader.import<{ Greeter: Function }>(EXACT);

      assert.deepEqual(
        Loader.identify(viaRange.Greeter),
        Loader.identify(viaExact.Greeter),
        'one Version, one type key, however it was addressed',
      );
    });

    // ONE CLASS, not merely one key. A matching identity string with two
    // class objects behind it is the worse bug of the two: the index looks
    // consistent while `instanceof` and polymorphic field checks disagree.
    // `moduleCacheKey` collapses every spelling it can see unaided for this
    // reason; a redirect is the one it cannot, because the answer does not
    // exist until the server gives it.
    test('a redirect collapses to one evaluation, in either order', async function (assert) {
      let seenA: string[] = [];
      let rangeFirst = new Loader(redirectingFetch(seenA));
      let a = await rangeFirst.import<{ Greeter: Function }>(RANGE);
      let b = await rangeFirst.import<{ Greeter: Function }>(EXACT);
      assert.strictEqual(a.Greeter, b.Greeter, 'range then exact: one class');
      assert.strictEqual(seenA.length, 1, 'and the exact spelling reuses it');

      let seenB: string[] = [];
      let exactFirst = new Loader(redirectingFetch(seenB));
      let c = await exactFirst.import<{ Greeter: Function }>(EXACT);
      let d = await exactFirst.import<{ Greeter: Function }>(RANGE);
      assert.strictEqual(c.Greeter, d.Greeter, 'exact then range: one class');
      // The range still has to ASK — nothing knows what it resolves to until
      // the server says — but the answer is adopted rather than re-evaluated.
      assert.strictEqual(
        seenB.length,
        2,
        'the range costs a request, not a class',
      );
    });

    test('an extension redirect does not change the identity', async function (assert) {
      // The realm resolves an extensionless request the same way, through
      // `X-Boxel-Canonical-Path`. That case has to stay a no-op: the canonical
      // URL carries the extension, and identities are trimmed, so nothing
      // moves. Guarding it because this is the path every ordinary card module
      // in every realm takes.
      let loader = new Loader(async () => {
        let response = new Response('export class Person {}\n', {
          status: 200,
          headers: {
            'content-type': 'application/javascript',
            'X-Boxel-Canonical-Path': 'https://ex.test/realm/person.gts',
          },
        });
        return response as any;
      });
      let mod = await loader.import<{ Person: Function }>(
        'https://ex.test/realm/person',
      );
      assert.deepEqual(Loader.identify(mod.Person), {
        module: 'https://ex.test/realm/person',
        name: 'Person',
      });
    });
  });
});
