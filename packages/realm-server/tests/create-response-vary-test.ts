import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  createResponse,
  X_BOXEL_LINK_SHAPE_HEADER,
  type RequestContext,
  type Realm,
} from '@cardstack/runtime-common';

// What a realm response declares its representation varies on.
//
// Two independent inputs decide it, and they are answers to the same question
// pulling in opposite directions: `varyOnAccept` takes `Accept` out for a route
// whose body is a pure function of its URL, and `varyOn` puts further headers
// in for a route whose body turns on one. A caching bug in either direction is
// invisible in a response read on its own — an absent member lets a shared
// cache serve one representation for another, and a spurious one costs a
// content-addressed route its cache entry on every differing request — so the
// combinations are pinned here rather than inferred from the two call sites
// that happen to exist.

// `createResponse` reads exactly two members off the context, and only to
// stamp the realm-url / public-readable headers. Nothing here exercises a
// realm, so a stub with those two members is the whole dependency.
function requestContext(publicReadable = true): RequestContext {
  return {
    realm: { url: 'http://localhost:4201/test/' } as Realm,
    permissions: publicReadable ? { '*': ['read'] } : {},
  };
}

function varyOf(response: Response): string | null {
  return response.headers.get('vary');
}

module(basename(import.meta.filename), function () {
  module('the vary a realm response declares', function () {
    test('a content-negotiating route varies on Accept', function (assert) {
      let response = createResponse({
        body: null,
        requestContext: requestContext(),
      });
      assert.strictEqual(varyOf(response), 'Accept');
    });

    test('a route whose body turns on another header names it too', function (assert) {
      let response = createResponse({
        body: null,
        requestContext: requestContext(),
        varyOn: [X_BOXEL_LINK_SHAPE_HEADER],
      });
      assert.strictEqual(
        varyOf(response),
        `Accept, ${X_BOXEL_LINK_SHAPE_HEADER}`,
        'both members, in a single comma-separated list',
      );
    });

    test('a URL-pure route declares no vary at all', function (assert) {
      let response = createResponse({
        body: null,
        requestContext: requestContext(),
        varyOnAccept: false,
      });
      assert.strictEqual(
        varyOf(response),
        null,
        'the header is absent rather than empty — a content-addressed URL varies on nothing, and declaring a vary it does not honor costs it its cache entry',
      );
    });

    // The combination no call site uses today, and the one a future caller
    // would most plausibly reach for: a route that ignores `Accept` but honors
    // something else. Opting out of `Accept` has to stay an opt-out even when
    // another member is present, or the narrower list silently readmits it.
    test('opting out of Accept holds when another member is named', function (assert) {
      let response = createResponse({
        body: null,
        requestContext: requestContext(),
        varyOnAccept: false,
        varyOn: [X_BOXEL_LINK_SHAPE_HEADER],
      });
      assert.strictEqual(
        varyOf(response),
        X_BOXEL_LINK_SHAPE_HEADER,
        'the named member alone, with Accept still excluded',
      );
    });

    test('an empty list is the same as naming nothing', function (assert) {
      let response = createResponse({
        body: null,
        requestContext: requestContext(),
        varyOnAccept: false,
        varyOn: [],
      });
      assert.strictEqual(varyOf(response), null);
    });
  });
});
