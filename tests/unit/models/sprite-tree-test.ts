import SpriteTree, {
  ContextModel,
  SpriteModel,
  SpriteTreeNode,
} from 'animations/models/sprite-tree';
import { module, test } from 'qunit';

class MockAnimationContext implements ContextModel {
  element: Element;
  constructor(parentEl: Element | null = null) {
    this.element = document.createElement('div');
    if (parentEl) {
      parentEl.appendChild(this.element);
    }
  }
}

class MockSpriteModifier implements SpriteModel {
  element: Element;
  farMatch = false;
  id = 'Mock';
  constructor(parentEl: Element | null = null) {
    this.element = document.createElement('div');
    if (parentEl) {
      parentEl.appendChild(this.element);
    }
  }
}

module('Unit | Models | SpriteTree', function (hooks) {
  let subject: SpriteTree;
  hooks.beforeEach(function () {
    subject = new SpriteTree();
  });
  module('empty', function () {
    test('constructing an empty tree', function (assert) {
      assert.ok(subject);
      assert.equal(
        subject.rootNodes.size,
        0,
        'tree has no rootNodes initially'
      );
    });
    test('adding a root animation context node', function (assert) {
      let context = new MockAnimationContext();
      let node = subject.addAnimationContext(context);
      assert.ok(node, 'addAnimationContext returns a node');
      assert.equal(
        node,
        subject.lookupNodeByElement(context.element),
        'can lookup node after adding it'
      );
      assert.equal(node.isRoot, true, 'context node with none above it isRoot');
      assert.equal(node.children.size, 0, 'context node has no children yet');
      assert.equal(subject.rootNodes.size, 1, 'tree has one rootNode');
      assert.equal(
        Array.from(subject.rootNodes)[0],
        node,
        'tree has context node has root node'
      );
    });
    test('adding a sprite modifier and then its parent animation context node', function (assert) {
      let context = new MockAnimationContext();
      let spriteModifier = new MockSpriteModifier(context.element);
      let spriteModifierNode = subject.addSpriteModifier(spriteModifier);
      let contextNode = subject.addAnimationContext(context);
      assert.equal(
        contextNode.isRoot,
        true,
        'context node with none above it isRoot'
      );
      assert.equal(
        spriteModifierNode.isRoot,
        false,
        'spriteModifier node under context is not isRoot'
      );
      assert.equal(
        spriteModifierNode.children.size,
        0,
        'spriteModifierNode node has no children yet'
      );
      assert.equal(
        contextNode.children.size,
        1,
        'context node has one childNode'
      );
      assert.equal(subject.rootNodes.size, 1, 'tree has one rootNode');
      assert.equal(
        Array.from(subject.rootNodes)[0],
        contextNode,
        'tree has context node as root node'
      );
      assert.equal(
        Array.from(contextNode.children)[0],
        spriteModifierNode,
        'context node has one has sprite node as child'
      );
    });
  });
  module('with a context node', function (hooks) {
    let context: MockAnimationContext, contextNode: SpriteTreeNode;
    hooks.beforeEach(function () {
      context = new MockAnimationContext();
      contextNode = subject.addAnimationContext(context);
    });
    test('adding a sprite modifier directly under context', function (assert) {
      let spriteModifer = new MockSpriteModifier(context.element);
      let spriteNode = subject.addSpriteModifier(spriteModifer);
      assert.ok(spriteNode, 'addSpriteModifier returns a node');
      assert.equal(
        spriteNode,
        subject.lookupNodeByElement(spriteModifer.element),
        'can lookup node after adding it'
      );
      assert.equal(
        spriteNode.isRoot,
        false,
        'sprite node nested under a context has isRoot false'
      );
      assert.equal(
        spriteNode.parent,
        contextNode,
        'sprite node has its parent set correctly'
      );
      assert.equal(
        contextNode.children.size,
        1,
        'context node has one childNode'
      );
      assert.equal(
        Array.from(contextNode.children)[0],
        spriteNode,
        'context node has sprite node as child'
      );
    });
    test('adding a sprite modifier under context with other elements in between', function (assert) {
      let context = new MockAnimationContext();
      let contextNode = subject.addAnimationContext(context);
      let elementBetweenContextAndSprite = document.createElement('div');
      context.element.appendChild(elementBetweenContextAndSprite);
      let elementBetweenContextAndSprite2 = document.createElement('div');
      elementBetweenContextAndSprite.appendChild(
        elementBetweenContextAndSprite2
      );
      let spriteModifer = new MockSpriteModifier(
        elementBetweenContextAndSprite2
      );
      let spriteNode = subject.addSpriteModifier(spriteModifer);
      assert.ok(spriteNode, 'addSpriteModifier returns a node');
      assert.equal(
        spriteNode,
        subject.lookupNodeByElement(spriteModifer.element),
        'can lookup node after adding it'
      );
      assert.equal(
        spriteNode.isRoot,
        false,
        'sprite node nested under a context has isRoot false'
      );
      assert.equal(
        spriteNode.parent,
        contextNode,
        'sprite node has its parent set correctly'
      );
    });
    test('adding a context nested under another context', function (assert) {
      let nestedContext = new MockAnimationContext(context.element);
      let nestedContextNode = subject.addAnimationContext(nestedContext);
      assert.equal(
        nestedContextNode.isRoot,
        false,
        'context node nested under a context has isRoot false'
      );
      assert.equal(
        nestedContextNode.parent,
        contextNode,
        'nested context node has its parent set correctly'
      );
    });
    test('remove an animation context', function (assert) {
      subject.removeAnimationContext(context);
      assert.equal(
        subject.lookupNodeByElement(context.element),
        null,
        'can no longer lookup node after removing it'
      );
      assert.equal(subject.rootNodes.size, 0, 'tree has no rootNodes left');
    });
  });
  module('with a context node and nested sprite modifier', function (hooks) {
    let context: MockAnimationContext,
      contextNode: SpriteTreeNode,
      spriteModifer: MockSpriteModifier,
      spriteNode: SpriteTreeNode;
    hooks.beforeEach(function () {
      context = new MockAnimationContext();
      contextNode = subject.addAnimationContext(context);
      spriteModifer = new MockSpriteModifier(context.element);
      spriteNode = subject.addSpriteModifier(spriteModifer);
    });
    test('adding a sprite modifier under another sprite modifier', function (assert) {
      let nestedSpriteModifer = new MockSpriteModifier(spriteModifer.element);
      let nestedSpriteNode = subject.addSpriteModifier(nestedSpriteModifer);
      assert.equal(
        nestedSpriteNode.isRoot,
        false,
        'sprite node nested under a sprite has isRoot false'
      );
      assert.equal(
        nestedSpriteNode.parent,
        spriteNode,
        'nested sprite node has its parent set correctly'
      );
      let descendants = subject.descendantsOf(context);
      assert.equal(descendants.length, 2, 'the context has two descendants');
      assert.equal(
        descendants[0],
        spriteModifer,
        'the first descendant is the spriteModifier'
      );
      assert.equal(
        descendants[1],
        nestedSpriteModifer,
        'the second descendant is the nested spriteModifier'
      );
    });

    test('remove a sprite modifier', function (assert) {
      subject.removeSpriteModifier(spriteModifer);
      assert.equal(
        subject.lookupNodeByElement(spriteModifer.element),
        null,
        'can no longer lookup node after removing it'
      );
      assert.equal(
        contextNode.children.size,
        0,
        'context node has no children yet'
      );
      assert.equal(
        contextNode.freshlyRemovedChildren.size,
        1,
        'context node has no freshlyRemovedChildren yet'
      );
      assert.equal(
        Array.from(contextNode.freshlyRemovedChildren)[0],
        spriteNode,
        'context node has removed spriteNode in freshlyRemovedChildren'
      );
      let descendants = subject.descendantsOf(context);
      assert.equal(descendants.length, 0, 'the context has no descendants');
      let descendantsWithFreshRemovals = subject.descendantsOf(context, {
        includeFreshlyRemoved: true,
      });
      assert.equal(
        descendantsWithFreshRemovals.length,
        1,
        'descendants includes freshly removed when flag is passed'
      );
      assert.equal(
        descendantsWithFreshRemovals[0],
        spriteModifer,
        'the returned descendant is the removed spriteModifier'
      );
    });
  });
  module('with two context nodes, each with a sprite', function (hooks) {
    let context1: ContextModel,
      context2: ContextModel,
      sprite1: SpriteModel,
      sprite2: SpriteModel;
    hooks.beforeEach(function () {
      context1 = new MockAnimationContext();
      context2 = new MockAnimationContext();
      sprite1 = new MockSpriteModifier(context1.element);
      sprite2 = new MockSpriteModifier(context2.element);
      subject.addAnimationContext(context1);
      subject.addAnimationContext(context2);
      subject.addSpriteModifier(sprite1);
      subject.addSpriteModifier(sprite2);
    });

    test('if a sprite is removed from one context, it is eligible for farmatching to another', function (assert) {
      subject.removeSpriteModifier(sprite1);
      assert.equal(subject.farMatchCandidatesFor(context2).length, 1);
      assert.equal(subject.farMatchCandidatesFor(context2)[0], sprite1);
      assert.equal(subject.farMatchCandidatesFor(context1).length, 0);

      subject.clearFreshlyRemovedChildren();
      assert.equal(subject.farMatchCandidatesFor(context2).length, 0);
      assert.equal(subject.farMatchCandidatesFor(context1).length, 0);
    });
  });
  module(
    'with a sprite modifier nested under another sprite modifier',
    function (hooks) {
      let context: MockAnimationContext,
        spriteModifer: MockSpriteModifier,
        spriteNode: SpriteTreeNode,
        nestedSpriteModifer: MockSpriteModifier,
        nestedSpriteNode: SpriteTreeNode;
      hooks.beforeEach(function () {
        context = new MockAnimationContext();
        subject.addAnimationContext(context);
        spriteModifer = new MockSpriteModifier(context.element);
        spriteNode = subject.addSpriteModifier(spriteModifer);
        nestedSpriteModifer = new MockSpriteModifier(spriteModifer.element);
        nestedSpriteNode = subject.addSpriteModifier(nestedSpriteModifer);
      });
      test('removing nested modifiers results in both being freshlyRemoved', function (assert) {
        let otherContext = new MockAnimationContext();
        subject.addAnimationContext(otherContext);
        subject.removeSpriteModifier(nestedSpriteModifer);
        subject.removeSpriteModifier(spriteModifer);
        assert.equal(
          nestedSpriteNode.parent,
          spriteNode,
          'nested sprite node has its parent set correctly'
        );
        let farMatchCandidates = subject.farMatchCandidatesFor(otherContext);
        assert.equal(
          farMatchCandidates.length,
          2,
          'farMatchCandidates include both removed sprites'
        );
        assert.equal(farMatchCandidates[0], spriteModifer);
        assert.equal(farMatchCandidates[1], nestedSpriteModifer);
      });
    }
  );
});
