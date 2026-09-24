import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  MAX_STASHED_CARD_SOURCE_LENGTH,
  cardSourceForVisit,
} from '@cardstack/runtime-common';

// `cardSourceForVisit` is the one rule deciding whether a visit carries the
// card's stored bytes, shared by both indexing visit sites so they cannot
// disagree. Everything it declines falls back to the render fetching the
// source for itself, which is the behavior the stash optimizes away — so a
// wrong answer here is a silent loss of the optimization, never a wrong render.
module(basename(import.meta.filename), function () {
  const source = '{"data":{"attributes":{"name":"Sequoia"}}}';
  const realmURL = 'https://example.com/realm/';

  test('a card instance carries its source, with the values the card branch reads off a response', function (assert) {
    let args = cardSourceForVisit({
      source,
      realmURL,
      lastModified: 1767322445,
      isCardInstance: true,
    });

    assert.deepEqual(args, {
      source,
      realmURL,
      // Seconds in, milliseconds out: `Reader#readFile` parses the
      // `last-modified` header into whole seconds, while the card branch
      // computes `new Date(header).getTime()`. The two have to agree, or the
      // document's stamped modified time moves depending on which arm ran.
      lastModified: 1767322445000,
    });
  });

  test('a file that is not a card instance carries nothing', function (assert) {
    // A module, an image, a `.json` that is not a card resource: none of them
    // reach the render route's card branch, so a stash would be bytes on the
    // wire that no consumer reads.
    assert.strictEqual(
      cardSourceForVisit({
        source,
        realmURL,
        lastModified: 1767322445,
        isCardInstance: false,
      }),
      undefined,
    );
  });

  test('a source over the cap carries nothing', function (assert) {
    // The bytes ride the prerender-visit POST and then a CDP message. Both are
    // internal and both replace a balancer round-trip, but a pathological
    // instance should not grow either without bound — it takes the fetch path
    // instead, exactly as it did before the stash existed.
    assert.strictEqual(
      cardSourceForVisit({
        source: 'x'.repeat(MAX_STASHED_CARD_SOURCE_LENGTH + 1),
        realmURL,
        lastModified: 1767322445,
        isCardInstance: true,
      }),
      undefined,
      'over the cap',
    );

    assert.ok(
      cardSourceForVisit({
        source: 'x'.repeat(MAX_STASHED_CARD_SOURCE_LENGTH),
        realmURL,
        lastModified: 1767322445,
        isCardInstance: true,
      }),
      'exactly at the cap still travels — the bound is inclusive',
    );
  });
});
