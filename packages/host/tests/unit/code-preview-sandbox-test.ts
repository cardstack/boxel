import { module, test } from 'qunit';

import CodePreviewSandbox from '@cardstack/host/lib/code-preview-sandbox';

module('Unit | code preview sandbox', function () {
  test('tracks one independent in-memory source revision per mounted preview', function (assert) {
    let first = new CodePreviewSandbox();
    let second = new CodePreviewSandbox();

    assert.notStrictEqual(first.id, second.id, 'preview identities are unique');

    first.update('https://realm.example/article.gts', 'first source');
    assert.strictEqual(first.revision, 1);
    assert.strictEqual(first.source, 'first source');
    assert.strictEqual(second.revision, 0, 'another preview is unaffected');

    first.update('https://realm.example/article.gts', 'first source');
    assert.strictEqual(
      first.revision,
      1,
      'an identical Monaco buffer is a no-op',
    );

    first.update('https://realm.example/article.gts', 'reverted source');
    assert.strictEqual(
      first.revision,
      2,
      'reverting is still a new preview revision',
    );

    first.update('https://realm.example/recipe.gts', 'recipe source');
    assert.strictEqual(
      first.revision,
      3,
      'switching files replaces the exact draft URL',
    );
    assert.strictEqual(first.sourceURL, 'https://realm.example/recipe.gts');

    first.deactivate();
    assert.false(first.active, 'teardown revokes the preview source');
  });
});
