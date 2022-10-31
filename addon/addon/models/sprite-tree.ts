import { assert } from '@ember/debug';
import { CopiedCSS } from '../utils/measurement';
import { formatTreeString, TreeNode } from '../utils/format-tree';
import Sprite, { SpriteIdentifier, SpriteType } from './sprite';
import { Changeset } from './changeset';

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
    use?(changeset: Changeset): Promise<void>;
    id?: string;
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

/**
 * We can also separate the proposed SpriteTreeNode below as a UIElement and have the SpriteTree be responsible
 * for keeping track of hierarchies, while storing pointers to UIElements (and UIElements store pointers of DOM elements that
 * are in the SpriteTree). We would pass UIElements around still, and supply them with visibility information based on the SpriteTree.
 * The SpriteTree would generally change based on DOM structure, removed things are a tricky but important part. If they're not animated
 * on the first render when they're gone, they should be cleaned up (from the SpriteTree/however we track them, the DOM part happens automatically).
 * If they're animated, they should be kept where they're animated and ideally not move around until they're done, though it seems impossible to prevent
 * a removed sprite from being forced to move upwards if another rule decides to claim it (until it's run out of ancestor contexts completely).
 * It is hard to reliably keep a removed SpriteTree branch around as a reference point for where a Sprite should be in the DOM
 * because it is possible to introduce matching Sprites for certain elements... and invalidate a branch of the SpriteTree, or maybe an ancestor gets removed...
 * and also we'd be keeping phantoms around. Also, once an AnimationContext has claimed a removed Sprite and attached it as an orphan, you might see bugs where
 * another AnimationContext claiming it ends up causing a layer bug (where the animated Sprite is no longer visible because of overflow on the new AnimationContext
 * controlling it, which is lower in the DOM hierarchy than the original controlling one).
 *
 * I think we'll need to make sure that if a context claims a removed sprite and animates it, it now belongs to the context (directly under it in the SpriteTree hierarchy)
 * until it is cleaned up. Clean up will happen when the animation completes, or the removed sprite is no longer valid, because ANOTHER representation of the UI element
 * in the DOM has now been removed and you cannot (and should not need to?) have two removed UI elements at once. <-- not sure how easy it is to guarantee this.
 *
 * It's hard to imagine the right way to handle the removed sprite's descendant sprites. The easier path for now is to assume we will not
 * attempt to reintroduce those as UI elements that need animating from the current orphaned elements to the new position,
 * and dispose of any state that represents them within our animation system. I don't think this is perfect, but this reduces the chances
 * that we are handling ghosts of removed sprites past, and prevents passing removed sprites around in a confusing manner (I hope).
 *
 *
 * TLDR: for removed sprites, use it this render or lose it; this includes descendant sprite representations in our animation system.
 */

/**
 * If we want removed sprites to be able to be handled the same way as non-removed sprites, how should we structure the
 * SpriteTree? (things I'm considering are related to relationships between UI elements: coordinate systems and hierarchy-based requirements,
 * like child UI elements of a card need to animate out with a certain timing)
 */

/**
 * When you clone a Sprite, you are cloning both the sprite's DOM element AND DOM elements that represent descendant sprites.
 * This is a potential source of bugs. The cloning implementation has to account for this.
 *
 * Related to the coordinate system problem below.
 */

/**
 * Should it be possible to attach a root Sprite as an orphan, and handle the descendant Sprites as if they have coordinate relative to the root orphan?
 * Or should the only way be to attach to the context and use coordinates relative to the context?
 *
 * It currently is, but.... this means that there are now multiple ways to specify the same animations for the same batch of removed sprites.
 * What should our recommended way be? Can we hide this detail? <-- I think we can, for most simple exit transitions
 */

/**
 * What happens if you clone a sprite that is also a context, and then try to attach orphans to that context???
 * We should decide what we want to do about this and document it.
 */

/**
 * How should the DOM structure that affects the SpriteTree hierarchy be defined, if only one SpriteTreeNode
 * should represent each UI element?
 *
 * How should we understand removed sprites and **where they can be attached to the DOM**? Considering interruptions, how can we answer this questions?
 */

/**
 * Each instance of SpriteTreeNode will answer:
 *
 * What is the state of this UI element? How did it change?
 *
 * UI element is a separate concept from DOM element. DOM elements can change without anything perceptibly changing
 * in the UI. The animation system attempts to keep track of UI elements as perceived by the user,
 * aided by metadata provided by consumers of the library. This means that the SpriteTreeNode will need to
 * keep track of different DOM elements that it recognizes as matching based on the provided metadata.
 *
 * The reason we're using a SpriteTreeNode this way is because it seems like a reasonable place to store state that's
 * relevant to a particular UI element **across renders**. Why? We may not be animating a sprite modifier's
 * DOM element (or we could be animating it + other things). A sprite modifier may have a "counterpart",
 * and we plan to introduce a cloning API at some point.
 * We need a place to keep track of what we are animating, and also what is current in the DOM.
 * Having easy ways to keep track of these things for a given UI element, in an understandable way
 * helps us have better interruption-handling and cleanup too.
 *
 * This means that the SpriteTreeNode, as a representation of a UI element, needs to keep track of:
 *
 * - any DOM element that is detached but we're still interested in (counterparts, clones)
 * - the current representation of the UI element in the DOM
 * - animations that are running on the DOM element
 * - state before and after render -> this determines whether removed, inserted, or kept
 * - opportunities for cleanup (animations completing, no animations being attached after render)
 *
 * With all this state, at the end of each render, a SpriteTreeNode would have enough information to create a Sprite.
 * A Sprite could become a readonly snapshot of a SpriteTreeNode's state for a given render (a subset of it, maybe), and starting an animation
 * using a Sprite would feed the information back to the SpriteTreeNode so that it knows what animating element to measure during interruptions
 * and keep track of for cleanup purposes.
 *
 * This reduces the need to consolidate state from various places - we've mentioned sprite modifiers;
 * the SpriteTree and the DOM are other sources that we're querying from a modifier in the
 * process of creating animations for a UI element. There's also the concept of intermediate sprites,
 * which we would no longer need.
 *
 * A goal of this work - we would pass SpriteTreeNodes around instead of passing AnimationContexts and Modifiers.
 * This does require that we provide a way to query for visibility of a SpriteTreeNode representing a Sprite to a
 * given SpriteTreeNode representing a Context. We can update visibility within the SpriteTree each render,
 * to provide SpriteTreeNodes with the following information:
 *
 * - For AnimationContexts:
 *   - visible descendant SpriteTreeNodes (taking into account multiple representations of UI elements in the DOM)
 *   - immediate descendant SpriteTreeNodes
 *     - this means that responsibility for deciding whether an AnimationContext can animate is in the SpriteTree?
 * - Parent SpriteTreeNode
 *
 * The ability to know by the end of each render, before we proceed into deciding how each Sprite should animate,
 * which Sprites will be visible to which AnimationContexts (and hence their rules) should make it easier to understand
 * and debug things. A tradeoff here is that we make hierarchy-based logic harder, whether in the library
 * itself or for users. I think having clarity about visibility makes things easier in the beginning, and we
 * can dismantle this abstraction later (I think?). We could also provide SpriteTreeNodes with a method to see if they match
 * a certain pattern (are you a descendant of this card?), without directly requiring interaction with the SpriteTree.
 *
 * Another goal - improved testability because we can separate the handling of DOM changes (SpriteTree/SpriteTreeNode concern)
 * from distribution (ChangesetBuilder concern) since we can mock SpriteTreeNodes for testing ChangesetBuilder, 
 * without having to think about DOM structure and the SpriteTree directly.
 *
 * ------
 *
 * SOME OTHER ISSUES THAT THIS HOPES TO HANDLE
 * Since a SpriteTreeNode is meant to be persistent across renders, it allows us to avoid using string-based keys to keep track of the state of things.
 * Also, interrupted removed sprites' SpriteTreeNodes are represented in an odd phantom-like way at the moment.
 */
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
