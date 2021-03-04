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
  children: Set<SpriteTreeNode> = new Set();
  freshlyRemovedChildren: Set<SpriteTreeNode> = new Set();

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

  getDescendantNodes(
    opts = { includeFreshlyRemoved: false }
  ): SpriteTreeNode[] {
    let result: SpriteTreeNode[] = [];
    let children = this.children;
    if (opts.includeFreshlyRemoved) {
      children = new Set([...children, ...this.freshlyRemovedChildren]);
    }
    for (let childNode of children) {
      result.push(childNode);
      result = result.concat(childNode.getDescendantNodes(opts));
    }
    return result;
  }
  freshlyRemovedDescendants(stopNode: SpriteTreeNode): SpriteModel[] {
    let result: SpriteModel[] = [];
    result = result.concat(
      [...this.freshlyRemovedChildren].map((n) => n.model)
    );
    for (let childNode of this.children) {
      if (childNode === stopNode) break;
      result = result.concat(childNode.freshlyRemovedDescendants(stopNode));
    }
    return result;
  }

  addChild(childNode: SpriteTreeNode): void {
    this.children.add(childNode);
  }
  removeChild(childNode: SpriteTreeNode): void {
    this.children.delete(childNode);
    this.freshlyRemovedChildren.add(childNode);
  }
}

export default class SpriteTree {
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
  descendantsOf(
    model: SpriteTreeModel,
    opts = { includeFreshlyRemoved: false }
  ): SpriteTreeModel[] {
    let node = this.lookupNodeByElement(model.element);
    if (node) {
      return node.getDescendantNodes(opts).map((n) => n.model);
    } else {
      return [];
    }
  }
  farMatchCandidatesFor(context: ContextModel): SpriteModel[] {
    // all freshlyRemovedChildren except those under given context node
    let result: SpriteModel[] = [];
    let contextNode = this.lookupNodeByElement(context.element);
    if (!contextNode) {
      return [];
    }
    for (let rootNode of this.rootNodes) {
      if (rootNode === contextNode) break;
      result = result.concat(rootNode.freshlyRemovedDescendants(contextNode));
    }
    return result;
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
