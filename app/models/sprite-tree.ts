export interface ContextModel {
  element: Element;
}

export interface SpriteModel {
  element: Element;
}

type SpriteTreeModel = ContextModel | SpriteModel;
export class SpriteTreeNode {
  model: SpriteTreeModel;
  parent: SpriteTreeNode | SpriteTree;
  childNodes: Set<SpriteTreeNode> = new Set();

  constructor(model: SpriteTreeModel, parentNode: SpriteTreeNode | SpriteTree) {
    this.model = model;
    this.parent = parentNode;
    parentNode.addChild(this);
  }

  get isRoot(): boolean {
    return this.parent instanceof SpriteTree;
  }

  get element(): Element {
    return this.model.element;
  }

  get descendantNodes(): SpriteTreeNode[] {
    let result: SpriteTreeNode[] = [];
    for (let childNode of this.childNodes) {
      result.push(childNode);
      result = result.concat(childNode.descendantNodes);
    }
    return result;
  }

  addChild(childNode: SpriteTreeNode): void {
    this.childNodes.add(childNode);
  }
  removeChild(childNode: SpriteTreeNode): void {
    this.childNodes.delete(childNode);
  }
}

export default class SpriteTree {
  descendantsOf(model: SpriteTreeModel): SpriteTreeModel[] {
    let node = this.lookupNodeByElement(model.element);
    if (node) {
      return node.descendantNodes.map((n) => n.model);
    } else {
      return [];
    }
  }
  nodesByElement = new WeakMap<Element, SpriteTreeNode>();
  rootNodes: Set<SpriteTreeNode> = new Set();
  addAnimationContext(context: ContextModel): SpriteTreeNode {
    let parentNode = this.findParentNode(context.element);
    let node = new SpriteTreeNode(context, parentNode || this);
    this.nodesByElement.set(context.element, node);
    return node;
  }
  removeAnimationContext(context: ContextModel): void {
    let node = this.lookupNodeByElement(context.element);
    if (node) {
      node.parent?.removeChild(node);
      this.nodesByElement.delete(context.element);
    }
  }
  addSpriteModifier(spriteModifier: SpriteModel): SpriteTreeNode {
    let parentNode = this.findParentNode(spriteModifier.element);
    let node = new SpriteTreeNode(spriteModifier, parentNode || this);
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
  addChild(rootNode: SpriteTreeNode): void {
    for (let existingRootNode of this.rootNodes) {
      if (rootNode.element.contains(existingRootNode.element)) {
        this.removeChild(existingRootNode);
        existingRootNode.parent = rootNode;
        rootNode.addChild(existingRootNode);
      }
    }
    this.rootNodes.add(rootNode);
  }
  removeChild(rootNode: SpriteTreeNode): void {
    this.rootNodes.delete(rootNode);
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
