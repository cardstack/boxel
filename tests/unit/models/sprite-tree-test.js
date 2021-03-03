import SpriteTree from 'animations/models/sprite-tree';
import { module, test } from 'qunit';

module('Unit | Models | SpriteTree', function () {
  test('constructing an empty tree', function (assert) {
    let tree = new SpriteTree();
    assert.ok(tree);
  });
  test('adding an animation context node', function (assert) {
    let tree = new SpriteTree();
    let el = document.createElement('div');
    let context = { element: el };
    let node = tree.addAnimationContext(context);
    assert.ok(node, 'addAnimationContext returns a node');
    assert.equal(
      node,
      tree.lookupNodeByElement(el),
      'can lookup node after adding it'
    );
  });
});
