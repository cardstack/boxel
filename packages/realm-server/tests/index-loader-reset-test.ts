import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { passInvalidatesExecutables } from '@cardstack/runtime-common/index-runner';

const realmURL = 'https://realm.example/catalog/';
let urls = (...paths: string[]) => paths.map((path) => `${realmURL}${path}`);

// The predicate that decides whether an index pass asks the prerender tab it
// lands on to drop its loader. The tab caches every module it has evaluated,
// and re-fetching and re-evaluating that graph is the dominant cost of the
// first card a pass renders — so the answer has to be driven by whether the
// pass could have made the graph wrong, not by the pass being new.
module(basename(import.meta.filename), function () {
  module('passInvalidatesExecutables', function () {
    test('a pass over instances alone leaves the graph alone', function (assert) {
      assert.false(
        passInvalidatesExecutables(
          urls('Pet/ringo.json', 'Person/hassan.json', 'index.json'),
        ),
        'no instance can make an evaluated module describe something else',
      );
    });

    test('a pass that carries an executable asks for the drop', function (assert) {
      assert.true(
        passInvalidatesExecutables(urls('Pet/ringo.json', 'pet.gts')),
        'a .gts anywhere in the set is enough',
      );
      assert.true(
        passInvalidatesExecutables(urls('helpers.ts')),
        'and so is a .ts',
      );
    });

    test('a type declaration is not an executable', function (assert) {
      assert.false(
        passInvalidatesExecutables(urls('shims.d.ts')),
        'nothing evaluates a .d.ts, so its bytes cannot stale the graph',
      );
    });

    test('an empty pass asks for nothing', function (assert) {
      assert.false(
        passInvalidatesExecutables([]),
        'a pass with no invalidations has no reason to reach the tab at all',
      );
    });

    test('the extension is read at the end of the path, not anywhere in it', function (assert) {
      assert.false(
        passInvalidatesExecutables(urls('schema/pet.gts.json')),
        'an instance whose name embeds a module name is still an instance',
      );
      assert.false(
        passInvalidatesExecutables(urls('gts/notes.json')),
        'and so is one under a directory named for the extension',
      );
    });
  });
});
