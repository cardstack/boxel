import QUnit from 'qunit';
import { basename } from 'path';
import { mentionsPaths } from '@cardstack/runtime-common/query-engine/paths-guard';
import { unionPathRefusal } from '@cardstack/runtime-common/query-v2/search-entry-union';

const { module, test } = QUnit;

// A search with a path filter, or over a realm a path-narrowed grant scopes,
// stays on the general read: no store path and no one-statement union.
module(basename(import.meta.filename), function () {
  test('a paths node is found at any depth, and nothing else counts', function (assert) {
    assert.true(mentionsPaths({ paths: ['blog/'] }));
    assert.true(
      mentionsPaths({ any: [{ eq: { title: 'x' } }, { not: { paths: [] } }] }),
    );
    assert.false(
      mentionsPaths({ eq: { paths: 'blog/' } }),
      'a field named paths',
    );
    assert.false(mentionsPaths(undefined));
  });

  test('a merged search over a realm a path-narrowed grant scopes takes the merge', function (assert) {
    let realm = { sharesIndexWith: () => true } as never;
    let query = {
      federation: { results: 'merged' },
      itemQuery: { filter: { eq: { title: 'x' } } },
    } as never;
    let readable = { url: 'http://a/', realm, access: 'readable' as const };
    let scoped = (grants: unknown[]) => ({
      url: 'http://b/',
      realm,
      access: 'scoped' as const,
      grants: grants as never,
    });
    assert.strictEqual(
      unionPathRefusal(query, [
        readable,
        scoped([{ type: { module: 'm', name: 'T' } }]),
      ]),
      undefined,
      'a grant with no paths may take the union',
    );
    assert.strictEqual(
      unionPathRefusal(query, [
        readable,
        scoped([
          {
            every: [{ type: { module: 'm', name: 'T' } }, { paths: ['blog/'] }],
          },
        ]),
      ]),
      'a path filter or a path-narrowed grant',
    );
    assert.strictEqual(
      unionPathRefusal(
        {
          federation: { results: 'merged' },
          itemQuery: { filter: { paths: ['blog/'] } },
        } as never,
        [readable],
      ),
      'a path filter or a path-narrowed grant',
      "a caller's own path filter",
    );
  });
});
