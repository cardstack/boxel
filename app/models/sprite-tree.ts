import AnimationContext from 'animations/components/animation-context';
import SpriteModifier from 'animations/modifiers/sprite';

class SpriteTreeNode {
  model;
  constructor(model: AnimationContext | SpriteModifier) {
    this.model = model;
  }
}
export default class SpriteTree {
  nodesByElement = new WeakMap();
  addAnimationContext(context: AnimationContext): SpriteTreeNode {
    let node = new SpriteTreeNode(context);
    this.nodesByElement[context.element] = node;
    return node;
  }
  lookupNodeByElement(element: HTMLElement): SpriteTreeNode | null {
    return this.nodesByElement[element];
  }
}
