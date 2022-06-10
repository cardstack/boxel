import { assert } from '@ember/debug';

export interface ContextModel {
  element: Element;
}

export interface SpriteModel {
  element: Element;
}

type SpriteTreeModel = ContextModel | SpriteModel;

export enum SpriteTreeNodeType {
  Root,
  Context,
  Sprite,
}
export class SpriteTreeNode {
  model: SpriteTreeModel;
  parent: SpriteTreeNode | SpriteTree;
  children: Set<SpriteTreeNode> = new Set();
  freshlyRemovedChildren: Set<SpriteTreeNode> = new Set();
  nodeType: Set<SpriteTreeNodeType> = new Set();

  constructor(
    model: SpriteTreeModel,
    nodeType: SpriteTreeNodeType,
    parentNode: SpriteTreeNode | SpriteTree
  ) {
    this.model = model;
    this.nodeType.add(nodeType);
    this.parent = parentNode;
    parentNode.addChild(this);
  }

  get isRoot(): boolean {
    return this.parent instanceof SpriteTree;
  }

  get element(): Element {
    return this.model.element;
  }

  get ancestors(): SpriteTreeNode[] {
    let result: SpriteTreeNode[] = [];
    let node: SpriteTreeNode = this as SpriteTreeNode;
    while (node.parent) {
      if (node.parent instanceof SpriteTree) break;
      assert('if not the tree, it is a node', node instanceof SpriteTreeNode);
      result.push(node.parent);
      node = node.parent;
    }
    return result;
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
  freshlyRemovedDescendants(stopNode: SpriteTreeNode): SpriteTreeModel[] {
    let result: SpriteTreeModel[] = [];
    for (let childNode of this.freshlyRemovedChildren) {
      result.push(childNode.model);
    }
    let allChildren = [...this.children].concat([
      ...this.freshlyRemovedChildren,
    ]);
    for (let childNode of allChildren) {
      if (childNode === stopNode) continue;
      result = result.concat(childNode.freshlyRemovedDescendants(stopNode));
    }
    return result;
  }

  clearFreshlyRemovedChildren(): void {
    for (let rootNode of this.children) {
      rootNode.freshlyRemovedChildren.clear();
      rootNode.clearFreshlyRemovedChildren();
    }
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
  model = null;
  nodeType = new Set([SpriteTreeNodeType.Root]);

  nodesByElement = new WeakMap<Element, SpriteTreeNode>();
  rootNodes: Set<SpriteTreeNode> = new Set();
  addAnimationContext(context: ContextModel): SpriteTreeNode {
    let existingNode = this.nodesByElement.get(context.element);

    if (existingNode) {
      existingNode.nodeType.add(SpriteTreeNodeType.Context);
      return existingNode;
    } else {
      let parentNode = this.findParentNode(context.element);
      let node = new SpriteTreeNode(
        context,
        SpriteTreeNodeType.Context,
        parentNode || this
      );
      this.nodesByElement.set(context.element, node);
      return node;
    }
  }
  removeAnimationContext(context: ContextModel): void {
    let node = this.lookupNodeByElement(context.element);
    if (node) {
      node.parent?.removeChild(node);
      this.nodesByElement.delete(context.element);
    }
  }
  addSpriteModifier(spriteModifier: SpriteModel): SpriteTreeNode {
    let existingNode = this.nodesByElement.get(spriteModifier.element);

    if (existingNode) {
      existingNode.nodeType.add(SpriteTreeNodeType.Sprite);
      return existingNode;
    } else {
      let parentNode = this.findParentNode(spriteModifier.element);
      let node = new SpriteTreeNode(
        spriteModifier,
        SpriteTreeNodeType.Sprite,
        parentNode || this
      );
      this.nodesByElement.set(spriteModifier.element, node);
      return node;
    }
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
      if (rootNode === contextNode) continue;
      result = result.concat(rootNode.freshlyRemovedDescendants(contextNode));
    }
    return result;
  }

  getContextRunList(requestedContexts: Set<ContextModel>): ContextModel[] {
    let result: ContextModel[] = [];
    for (let context of requestedContexts) {
      if (result.indexOf(context) !== -1) continue;
      result.unshift(context);
      let node = this.lookupNodeByElement(context.element);
      let ancestor = node && node.parent;
      while (ancestor) {
        if (ancestor.nodeType.has(SpriteTreeNodeType.Context)) {
          if (result.indexOf(ancestor.model as ContextModel) === -1) {
            result.push(ancestor.model as ContextModel);
          }
        }
        ancestor = (ancestor as SpriteTreeNode).parent;
      }
    }
    return result;
  }

  clearFreshlyRemovedChildren(): void {
    for (let rootNode of this.rootNodes) {
      rootNode.freshlyRemovedChildren.clear();
      rootNode.clearFreshlyRemovedChildren();
    }
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
