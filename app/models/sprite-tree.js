class SpriteTreeNode {
  model;
  constructor(model) {
    this.model = model;
  }
}
export default class SpriteTree {
  nodesByElement = new WeakMap();
  addAnimationContext(context) {
    let node = new SpriteTreeNode(context);
    this.nodesByElement[context.element] = node;
    return node;
  }
  lookupNodeByElement(element) {
    return this.nodesByElement[element];
  }
}
