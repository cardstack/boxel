import { assert } from '@ember/debug';
import AnimationContextComponent from 'animations-experiment/components/animation-context';
import SpriteModifier from 'animations-experiment/modifiers/sprite';
import { formatTreeString, TreeNode } from '../utils/format-tree';
import AnimationContext from 'animations-experiment/components/animation-context';
export interface ContextModel {
  element: Element;
}

export interface SpriteModel {
  element: Element;
}

export interface GetDescendantNodesOptions {
  includeFreshlyRemoved: boolean;
  filter?(childNode: SpriteTreeNode): boolean;
}

type SpriteTreeModel = ContextModel | SpriteModel;

export enum SpriteTreeNodeType {
  Root,
  Context,
  Sprite,
}

export class SpriteTreeNode {
  contextModel: ContextModel | undefined;
  spriteModel: SpriteModel | undefined;

  parent: SpriteTreeNode | SpriteTree;
  children: Set<SpriteTreeNode> = new Set();
  freshlyRemovedChildren: Set<SpriteTreeNode> = new Set();

  get isContext() {
    return Boolean(this.contextModel);
  }

  get isSprite() {
    return Boolean(this.spriteModel);
  }

  get isAnchor() {
    return Boolean(
      ((this.contextModel as AnimationContext)?.isStable &&
        (this.contextModel as AnimationContext)?.isAnchor) ||
        (this.spriteModel as SpriteModifier)?.isAnchor
    );
  }

  constructor(
    model: SpriteTreeModel,
    nodeType: SpriteTreeNodeType,
    parentNode: SpriteTreeNode | SpriteTree
  ) {
    if (nodeType === SpriteTreeNodeType.Context) {
      this.contextModel = model;
    } else if (nodeType === SpriteTreeNodeType.Sprite) {
      this.spriteModel = model;
    } else {
      throw new Error('Passed model is not a context or sprite');
    }

    this.parent = parentNode;
    parentNode.addChild(this);
  }

  get isRoot(): boolean {
    return this.parent instanceof SpriteTree;
  }

  get element(): Element {
    return (this.spriteModel?.element ?? this.contextModel?.element) as Element;
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

  allChildSprites({ includeFreshlyRemoved = false }) {
    let result: SpriteModel[] = [];

    for (let child of this.children) {
      if (child.isSprite) {
        result.push(child.spriteModel as SpriteModel);
      }

      if (
        (child.isSprite ||
          (child.isContext &&
            !(child.contextModel as AnimationContextComponent).isStable)) &&
        child.children?.size
      ) {
        child
          .allChildSprites({ includeFreshlyRemoved })
          .forEach((c) => result.push(c));
      }
    }

    return result;
  }

  getDescendantNodes(
    opts: GetDescendantNodesOptions = {
      includeFreshlyRemoved: false,
      filter: (_childNode: SpriteTreeNode) => true,
    }
  ): SpriteTreeNode[] {
    if (!opts.filter) opts.filter = () => true;
    let result: SpriteTreeNode[] = [];
    let children = this.children;
    if (opts.includeFreshlyRemoved) {
      children = new Set([...children, ...this.freshlyRemovedChildren]);
    }
    for (let childNode of children) {
      result.push(childNode);
      if (!opts.filter(childNode)) continue;
      result = result.concat(childNode.getDescendantNodes(opts));
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

  toLoggableForm(isRemoved?: boolean): TreeNode {
    let text = '';
    if (this.isContext) {
      let contextId = (
        this.contextModel as unknown as AnimationContextComponent
      ).id;
      text += `🥡${contextId ? ` ${contextId}` : ''} `;
    }
    if (this.isSprite) {
      let spriteId = (this.spriteModel as unknown as SpriteModifier).id;
      text += `🥠${spriteId ? ` ${spriteId}` : ''}`;
    }
    let extra = isRemoved ? '❌' : undefined;
    return {
      text,
      extra,
      children: Array.from(this.children)
        .map((v) => v.toLoggableForm(isRemoved))
        .concat(
          Array.from(this.freshlyRemovedChildren).map((v) =>
            v.toLoggableForm(true)
          )
        ),
    };
  }
}

export default class SpriteTree {
  contextModel = undefined;
  spriteModel = undefined;
  isContext = false;
  isSprite = false;

  nodesByElement = new WeakMap<Element, SpriteTreeNode>();
  rootNodes: Set<SpriteTreeNode> = new Set();
  _pendingAdditions: (
    | { item: ContextModel; type: 'CONTEXT' }
    | { item: SpriteModel; type: 'SPRITE' }
  )[] = [];
  freshlyRemovedToNode: WeakMap<SpriteModifier, SpriteTreeNode> = new WeakMap();

  addPendingAnimationContext(item: ContextModel) {
    this._pendingAdditions.push({ item, type: 'CONTEXT' });
  }

  addPendingSpriteModifier(item: SpriteModel) {
    this._pendingAdditions.push({ item, type: 'SPRITE' });
  }

  flushPendingAdditions() {
    // sort by document position because parents must always be added before children
    this._pendingAdditions.sort((a, b) => {
      let bitmask = a.item.element.compareDocumentPosition(b.item.element);

      assert(
        'Document position is not implementation-specific or disconnected',
        !(
          bitmask & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC ||
          bitmask & Node.DOCUMENT_POSITION_DISCONNECTED
        )
      );

      return bitmask & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    for (let { item, type } of this._pendingAdditions) {
      if (type === 'CONTEXT') {
        this.addAnimationContext(item);
      } else if (type === 'SPRITE') {
        this.addSpriteModifier(item);
      } else {
        throw new Error('unexpected pending addition');
      }
    }

    this._pendingAdditions = [];
  }

  addAnimationContext(context: ContextModel): SpriteTreeNode {
    let existingNode = this.lookupNodeByElement(context.element);

    if (existingNode) {
      assert(
        'Cannot add an AnimationContext which was already added',
        !existingNode.isContext
      );

      existingNode.contextModel = context;
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
      if (node.isSprite) {
        // TODO: we might need to do some cleanup? This is currently a WeakMap but..
        // situation where this matters is SpriteModifier hanging around when it should be removed
        this.freshlyRemovedToNode.set(node.spriteModel as SpriteModifier, node);
      }
      this.nodesByElement.delete(context.element);
    }
  }
  addSpriteModifier(spriteModifier: SpriteModel): SpriteTreeNode {
    let resultNode: SpriteTreeNode;
    let existingNode = this.lookupNodeByElement(spriteModifier.element);
    if (existingNode) {
      assert(
        'Cannot add a SpriteModifier which was already added',
        !existingNode.isSprite
      );

      existingNode.spriteModel = spriteModifier;
      resultNode = existingNode;
    } else {
      let parentNode = this.findParentNode(spriteModifier.element);
      let node = new SpriteTreeNode(
        spriteModifier,
        SpriteTreeNodeType.Sprite,
        parentNode || this
      );
      this.nodesByElement.set(spriteModifier.element, node);
      resultNode = node;
    }

    if (!resultNode.parent.isContext) {
      console.error(
        `Sprite "${
          (spriteModifier as SpriteModifier).id
        }" cannot have another Sprite as a direct parent. An extra AnimationContext will need to be added.`
      );
    }

    return resultNode;
  }
  removeSpriteModifier(spriteModifer: SpriteModel): void {
    let node = this.lookupNodeByElement(spriteModifer.element);
    if (node) {
      node.parent?.removeChild(node);
      if (node.isSprite) {
        // TODO: we might need to do some cleanup? This is currently a WeakMap but..
        // situation where this matters is SpriteModifier hanging around when it should be removed
        this.freshlyRemovedToNode.set(node.spriteModel as SpriteModifier, node);
      }
      this.nodesByElement.delete(spriteModifer.element);
    }
  }
  lookupNodeByElement(element: Element): SpriteTreeNode | undefined {
    return this.nodesByElement.get(element);
  }
  closestAnchor(modifier: SpriteModifier):
    | {
        currentBounds?: DOMRect;
        lastBounds?: DOMRect;
      }
    | undefined {
    let node = this.lookupNodeByElement(modifier.element);
    let parent = node?.parent;
    while (parent) {
      if (parent === this) {
        break;
      }
      if (parent && (parent as SpriteTreeNode).isAnchor) {
        let model = (parent.contextModel ?? parent.spriteModel) as
          | SpriteModifier
          | AnimationContext;
        console.log('closest anchor', model);
        return {
          currentBounds: model?.currentBounds,
          lastBounds: model?.lastBounds,
        };
      }
      parent = (parent as SpriteTreeNode).parent;
    }
  }
  descendantsOf(
    model: SpriteTreeModel,
    opts: GetDescendantNodesOptions = { includeFreshlyRemoved: false }
  ): SpriteTreeModel[] {
    let node = this.lookupNodeByElement(model.element);
    if (node) {
      return node.getDescendantNodes(opts).reduce((result, n) => {
        if (n.contextModel) {
          result.push(n.contextModel);
        }
        if (n.spriteModel) {
          result.push(n.spriteModel);
        }
        return result;
      }, [] as SpriteTreeModel[]);
    } else {
      return [];
    }
  }

  getContextRunList(requestedContexts: Set<ContextModel>): ContextModel[] {
    let result: ContextModel[] = [];
    for (let context of requestedContexts) {
      if (result.indexOf(context) !== -1) continue;
      result.unshift(context);
      let node = this.lookupNodeByElement(context.element);
      let ancestor = node && node.parent;
      while (ancestor) {
        if (ancestor.isContext) {
          if (result.indexOf(ancestor.contextModel as ContextModel) === -1) {
            result.push(ancestor.contextModel as ContextModel);
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

  findStableSharedAncestor(spriteA: SpriteModifier, spriteB: SpriteModifier) {
    let ancestorsOfKeptSprite = this.nodesByElement
      .get(spriteA.element)
      ?.ancestors.filter((v) => (v.contextModel as AnimationContext)?.isStable);
    let ancestorsOfCounterpartSprite = this.freshlyRemovedToNode
      .get(spriteB)
      ?.ancestors.filter((v) => (v.contextModel as AnimationContext)?.isStable);

    return ancestorsOfKeptSprite?.find((v) =>
      ancestorsOfCounterpartSprite?.includes(v)
    )?.contextModel;
  }

  log() {
    console.log(
      formatTreeString({
        text: 'ROOT',
        children: Array.from(this.rootNodes).map((v) => v.toLoggableForm()),
      })
    );
  }
}
