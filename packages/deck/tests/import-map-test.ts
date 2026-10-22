import QUnit from 'qunit';
const { module, test } = QUnit;
import { TREE_ROOT, treePathFromMapValue } from '../src/import-map.ts';

module('import map: the tree-root token', function () {
  test('`$DECK/` is the spelling new trees write', function (assert) {
    assert.strictEqual(TREE_ROOT, '$DECK/');
    assert.strictEqual(treePathFromMapValue('$DECK/index.js'), 'index.js');
    assert.strictEqual(
      treePathFromMapValue('$DECK/src/deep/mod.js'),
      'src/deep/mod.js',
    );
  });

  test('rejects the removed `$REALM/` spelling', function (assert) {
    assert.strictEqual(treePathFromMapValue('$REALM/index.js'), undefined);
  });

  test('the other shapes are unchanged', function (assert) {
    assert.strictEqual(treePathFromMapValue('./a.js'), 'a.js');
    assert.strictEqual(treePathFromMapValue('a/b.js'), 'a/b.js');
    assert.strictEqual(
      treePathFromMapValue('$DECK/v.pack.zip!/x.js'),
      'v.pack.zip!/x.js',
      '`!` is legal as the mount separator',
    );
    for (let notATreePath of [
      'https://cdn.example.com/x.js',
      '/absolute.js',
      '$OTHER/x.js',
      '$DECK/../escape.js',
      '$DECK/a!b.js',
      '$DECK/',
    ]) {
      assert.strictEqual(
        treePathFromMapValue(notATreePath),
        undefined,
        `${notATreePath} is not a tree path`,
      );
    }
  });
});
