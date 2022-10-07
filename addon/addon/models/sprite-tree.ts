import { assert } from '@ember/debug';
import { CopiedCSS } from '../utils/measurement';
import { formatTreeString, TreeNode } from '../utils/format-tree';
import Sprite, { SpriteIdentifier, SpriteType } from './sprite';
import { Changeset } from './changeset';
import { AnimationDefinition } from 'animations-experiment/models/transition-runner';

export interface Rule {
  match(unallocatedItems: Sprite[]): {
    remaining: Sprite[];
    claimed: AnimationDefinition[];
  };
}

export interface IContext {
  id: string | undefined;
  element: Element;
  currentBounds?: DOMRect;
  lastBounds?: DOMRect;
  isInitialRenderCompleted: boolean;
  isStable: boolean;
  orphans: Map<string, HTMLElement>;
  captureSnapshot(opts?: {
    withAnimations: boolean;
    playAnimations: boolean;
  }): void;
  shouldAnimate(): boolean;
  hasOrphan(spriteOrElement: Sprite): boolean;
  removeOrphan(spriteOrElement: Sprite): void;
  appendOrphan(spriteOrElement: Sprite): void;
  clearOrphans(): void;
  args: {
    use?:
      | ((changeset: Changeset) => Promise<void | AnimationDefinition>)
      | undefined;
    id?: string;
    rules?: Rule[] | undefined;
  };
}

export interface ISpriteModifier {
  id: string | null;
  role: string | null;
  element: Element;
  currentBounds?: DOMRect;
  lastBounds?: DOMRect;
  captureSnapshot(opts?: {
    withAnimations: boolean;
    playAnimations: boolean;
  }): void;
  lastComputedStyle: CopiedCSS | undefined;
  currentComputedStyle: CopiedCSS | undefined;
}

export interface GetDescendantNodesOptions {
  includeFreshlyRemoved: boolean;
  filter?(childNode: SpriteTreeNode): boolean;
}

type SpriteTreeModel = IContext | ISpriteModifier;

export enum SpriteTreeNodeType {
  Root,
  Context,
  Sprite,
}

export class SpriteTreeNode {
  contextModel: IContext | undefined;
  spriteModel: ISpriteModifier | undefined;

  parent: SpriteTreeNode | SpriteTree;
  children: Set<SpriteTreeNode> = new Set();
  freshlyRemovedChildren: Set<SpriteTreeNode> = new Set();

  isContext(): this is { contextModel: IContext } {
    return Boolean(this.contextModel);
  }

  isSprite(): this is { spriteModel: ISpriteModifier } {
    return Boolean(this.spriteModel);
  }

  constructor(
    model: IContext,
    nodeType: SpriteTreeNodeType.Context,
    parentNode: SpriteTreeNode | SpriteTree
  );
  constructor(
    model: ISpriteModifier,
    nodeType: SpriteTreeNodeType.Sprite,
    parentNode: SpriteTreeNode | SpriteTree
  );
  constructor(
    model: any,
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

  getSpriteDescendants(
    opts: {
      deep: boolean;
    } = { deep: false }
  ): {
    isRemoved: boolean;
    spriteModifier: ISpriteModifier;
    node: SpriteTreeNode;
  }[] {
    let result: {
      isRemoved: boolean;
      spriteModifier: ISpriteModifier;
      node: SpriteTreeNode;
    }[] = [];

    for (let child of this.children) {
      if (child.isSprite()) {
        result.push({
          node: child,
          isRemoved: false,
          spriteModifier: child.spriteModel,
        });

        if (!child.isContext()) {
          child
            .getSpriteDescendants({ deep: opts.deep })
            .forEach((c) => result.push(c));
        }
      } else if (child.isContext()) {
        if (opts.deep && !child.contextModel.isStable) {
          child
            .getSpriteDescendants({ deep: opts.deep })
            .forEach((c) => result.push(c));
        }
      } else {
        throw new Error(
          'Sprite tree node that is not child or context encountered'
        );
      }
    }

    for (let child of this.freshlyRemovedChildren) {
      if (child.isSprite()) {
        result.push({
          node: child,
          isRemoved: true,
          spriteModifier: child.spriteModel,
        });

        if (!child.isContext()) {
          child
            .getSpriteDescendants({ deep: opts.deep })
            .forEach((c) => result.push(c));
        }
      } else if (child.isContext()) {
        if (opts.deep && !child.contextModel.isStable) {
          child
            .getSpriteDescendants({ deep: opts.deep })
            .forEach((c) => result.push(c));
        }
      } else {
        throw new Error(
          'Sprite tree node that is not child or context encountered'
        );
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

  /**
   * Deletes the node from its parent's freshlyRemovedChildren set
   */
  delete() {
    assert(
      'May have called delete on a root node of the sprite tree',
      this.parent instanceof SpriteTreeNode
    );
    this.parent.freshlyRemovedChildren.delete(this);
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
    if (this.isContext()) {
      let contextId = this.contextModel.id;
      text += `🥡${contextId ? ` ${contextId}` : ''} `;
    }
    if (this.isSprite()) {
      let spriteId = this.spriteModel.id;
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
  freshlyAdded: Set<ISpriteModifier> = new Set();
  freshlyRemoved: Set<ISpriteModifier> = new Set();
  interruptedRemoved: Set<ISpriteModifier> = new Set();
  isContext() {
    return false;
  }
  isSprite() {
    return false;
  }

  nodesByElement = new WeakMap<Element, SpriteTreeNode>();
  rootNodes: Set<SpriteTreeNode> = new Set();
  _pendingAdditions: (
    | { item: IContext; type: 'CONTEXT' }
    | { item: ISpriteModifier; type: 'SPRITE' }
  )[] = [];
  freshlyRemovedElementsToNode: WeakMap<Element, SpriteTreeNode> =
    new WeakMap();

  addPendingAnimationContext(item: IContext) {
    this._pendingAdditions.push({ item, type: 'CONTEXT' });
  }

  addPendingSpriteModifier(item: ISpriteModifier) {
    this._pendingAdditions.push({ item, type: 'SPRITE' });
  }

  flushPendingAdditions() {
    // sort by document position because parents must always be added before children
    this._pendingAdditions.sort((a, b) => {
      let bitmask = a.item.element.compareDocumentPosition(b.item.element);

      assert(
        'Sorting sprite tree additions - Document position of two compared nodes is implementation-specific or disconnected',
        !(
          bitmask & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC ||
          bitmask & Node.DOCUMENT_POSITION_DISCONNECTED
        )
      );

      return bitmask & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    for (let v of this._pendingAdditions) {
      if (v.type === 'CONTEXT') {
        this.addAnimationContext(v.item);
      } else if (v.type === 'SPRITE') {
        this.addSpriteModifier(v.item);
      } else {
        throw new Error('unexpected pending addition');
      }
    }

    this._pendingAdditions = [];
  }

  addAnimationContext(context: IContext): SpriteTreeNode {
    let existingNode = this.lookupNode(context.element);

    if (existingNode) {
      assert(
        'Cannot add an AnimationContext which was already added',
        !existingNode.isContext()
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
  removeAnimationContext(context: IContext): void {
    let node = this.lookupNode(context.element);
    if (node) {
      node.parent?.removeChild(node);
      if (node.isSprite()) {
        // TODO: we might need to do some cleanup? This is currently a WeakMap but..
        // situation where this matters is SpriteModifier hanging around when it should be removed
        this.freshlyRemovedElementsToNode.set(node.spriteModel.element, node);
      }
      this.nodesByElement.delete(context.element);
    }
  }
  addSpriteModifier(spriteModifier: ISpriteModifier): SpriteTreeNode {
    let resultNode: SpriteTreeNode;
    let existingNode = this.lookupNode(spriteModifier.element);
    if (existingNode) {
      assert(
        'Cannot add a SpriteModel which was already added',
        !existingNode.isSprite()
      );

      existingNode.spriteModel = spriteModifier;
      resultNode = existingNode;
    } else {
      let parentNode = this.findParentNode(spriteModifier.element);
      let identifier = new SpriteIdentifier(
        spriteModifier.id,
        spriteModifier.role
      );
      let matchingRemovedItems: SpriteTreeNode[] = [];

      for (let item of this.interruptedRemoved) {
        if (new SpriteIdentifier(item.id, item.role).equals(identifier)) {
          matchingRemovedItems.push(
            this.freshlyRemovedElementsToNode.get(item.element)!
          );
        }
      }

      assert(
        'Multiple matching interrupted removed items found while adding a new sprite',
        matchingRemovedItems.length <= 1
      );

      if (matchingRemovedItems.length === 1) {
        let removedNode = matchingRemovedItems[0]!;
        removedNode.delete();
        this.interruptedRemoved.delete(removedNode.spriteModel!);
      }
      let node = new SpriteTreeNode(
        spriteModifier,
        SpriteTreeNodeType.Sprite,
        parentNode || this
      );
      this.nodesByElement.set(spriteModifier.element, node);
      resultNode = node;
    }

    this.freshlyAdded.add(spriteModifier);

    return resultNode;
  }
  removeSpriteModifier(spriteModifier: ISpriteModifier): void {
    let node = this.lookupNode(spriteModifier.element);
    if (node) {
      node.parent?.removeChild(node);
      if (node.isSprite()) {
        // TODO: we might need to do some cleanup? This is currently a WeakMap but..
        // situation where this matters is SpriteModifier hanging around when it should be removed
        this.freshlyRemovedElementsToNode.set(node.spriteModel.element, node);
        this.freshlyRemoved.add(spriteModifier);
      }
      this.nodesByElement.delete(spriteModifier.element);
    }
  }

  lookupNode(target: Element): SpriteTreeNode | undefined;
  lookupNode(target: ISpriteModifier): SpriteTreeNode | undefined;
  lookupNode(target: IContext): SpriteTreeNode | undefined;
  lookupNode(target: Sprite): SpriteTreeNode | undefined;
  lookupNode(target: Element | { element: Element }) {
    let element =
      target instanceof Element
        ? target
        : target.element instanceof Element
        ? target.element
        : null;

    if (!element) {
      throw new Error(
        'Unable to determine element for which to lookup a SpriteTreeNode'
      );
    }

    let nonRemoved = this.nodesByElement.get(element);
    let removed = this.freshlyRemovedElementsToNode.get(element);

    if (target instanceof Sprite) {
      if (target.type === SpriteType.Removed)
        assert(
          'Unexpectedly found SpriteTreeNode via non-removed lookup, while looking up a removed sprite',
          !nonRemoved
        );
      if (target.type !== SpriteType.Removed)
        assert(
          'Unexpectedly found SpriteTreeNode via removed lookup, while looking up a non-removed sprite',
          !removed
        );
    }

    assert(
      'Sprite tree lookup maps appear to be incorrect. Element is in map for removed and non-removed.',
      !(nonRemoved && removed)
    );

    return nonRemoved ?? removed;
  }

  descendantsOf(
    model: SpriteTreeModel,
    opts: GetDescendantNodesOptions = { includeFreshlyRemoved: false }
  ): SpriteTreeModel[] {
    let node = this.lookupNode(model.element);
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

  getContextRunList(requestedContexts: Set<IContext>): IContext[] {
    let result: IContext[] = [];
    for (let context of requestedContexts) {
      if (result.indexOf(context) !== -1) continue;
      result.unshift(context);
      let node = this.lookupNode(context.element);
      let ancestor = node && node.parent;
      while (ancestor) {
        if (ancestor.isContext()) {
          if (result.indexOf(ancestor.contextModel) === -1) {
            result.push(ancestor.contextModel);
          }
        }
        ancestor = (ancestor as SpriteTreeNode).parent;
      }
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
      let node = this.lookupNode(element.parentElement);
      if (node) {
        return node;
      }
      element = element.parentElement;
    }
    return null;
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
