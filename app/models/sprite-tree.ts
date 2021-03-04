export interface ContextModel {
  element: Element;
}

export interface SpriteModel {
  element: Element;
}

type SpriteTreeModel = ContextModel | SpriteModel;
export class SpriteTreeNode {
  model: SpriteTreeModel;
  parent: SpriteTreeNode | null;
  isRoot: boolean;
  childNodes: Set<SpriteTreeNode> = new Set();
  constructor(
    model: SpriteTreeModel,
    parentNode: SpriteTreeNode | null = null
  ) {
    this.model = model;
    this.parent = parentNode;
    this.isRoot = !parentNode;
    if (parentNode) {
      parentNode.addChild(this);
    }
  }
  addChild(childNode: SpriteTreeNode): void {
    this.childNodes.add(childNode);
  }
  removeChild(childNode: SpriteTreeNode): void {
    this.childNodes.delete(childNode);
  }
}

export default class SpriteTree {
  nodesByElement = new WeakMap<Element, SpriteTreeNode>();
  addAnimationContext(context: ContextModel): SpriteTreeNode {
    let parentNode = this.findParentNode(context.element);
    let node = new SpriteTreeNode(context, parentNode);
    this.nodesByElement.set(context.element, node);
    return node;
  }
  addSpriteModifier(spriteModifier: SpriteModel): SpriteTreeNode {
    let parentNode = this.findParentNode(spriteModifier.element);
    let node = new SpriteTreeNode(spriteModifier, parentNode);
    this.nodesByElement.set(spriteModifier.element, node);
    return node;
  }
  removeSpriteModifier(spriteModifer: SpriteModel): void {
    let node = this.lookupNodeByElement(spriteModifer.element);
    if (node) {
      node.parent?.removeChild(node);
      this.nodesByElement.delete(spriteModifer.element);
    }
  }
  lookupNodeByElement(element: Element): SpriteTreeNode | undefined {
    return this.nodesByElement.get(element);
  }
  private findParentNode(element: Element) {
    while (element.parentElement) {
      let node = this.lookupNodeByElement(element.parentElement);
      if (node) {
        return node;
      }
      element = element.parentElement;
    }
    return null;
  }
}
