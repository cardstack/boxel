import { assert } from '@ember/debug';

import { type TreeNode, formatTreeString } from '../utils/format-tree.ts';
import {
  type Snapshot,
  copyComputedStyle,
  getDocumentPosition,
} from '../utils/measurement.ts';
import { type IContext, Animator } from './animator.ts';
import { addToDOMRefTrees, DOMRefNode } from './dom-ref.ts';
import Sprite, { type ISpriteModifier, SpriteType } from './sprite.ts';

interface MatchGroup {
  insertedContext?: IContext;
  insertedDOMRef?: DOMRefNode;
  insertedSpriteModifier?: ISpriteModifier;
  removedContext?: IContext;
  removedSpriteModifier?: ISpriteModifier;
}
export class AnimationParticipantManager {
  DOMRefs: Array<DOMRefNode> = [];
  participants: Set<AnimationParticipant> = new Set();

  // Class-internal utility for matching inserted sprites to participants
  // Expose for unit-testing if necessary
  generateIdentifierKey(modifier: ISpriteModifier): string {
    // This is implicitly requiring that we assign a unique id to every sprite modifier
    return modifier.id;
  }

  // TODO: this should be able to inform its caller
  // about what HTML elements can be removed from the DOM, so we can selectively
  // pluck orphans out
  // In which case we don't want to call it during updateParticipants but instead
  // have the animations service call this
  performCleanup() {
    let animatedDetachedDOMRefs = new Set<DOMRefNode>();
    let unanimatedDetachedDOMRefs = new Set<DOMRefNode>();
    let displacedDOMRefs = new Set<DOMRefNode>();
    for (let participant of this.participants) {
      participant._DOMRefsToDispose.forEach((node) => {
        displacedDOMRefs.add(node);
      });
      participant._DOMRefsToDispose.clear();
      if (
        participant.uiState.detached &&
        (!participant.uiState.detached.animation ||
          participant.uiState.detached.animation.playState === 'finished' ||
          participant.uiState.detached.animation?.playState === 'idle' ||
          participant.uiState.detached.animation?.playState === 'paused')
      ) {
        // TODO: when cloning is implemented, add the DOMRef here
        unanimatedDetachedDOMRefs.add(participant.uiState.detached.DOMRef);
      } else if (participant.uiState.detached) {
        animatedDetachedDOMRefs.add(participant.uiState.detached.DOMRef);
      }
    }

    let deleted: Set<DOMRefNode> = new Set();
    let nodesToGraft = new Map<DOMRefNode, DOMRefNode>();
    function recurse<T>(
      node: DOMRefNode,
      callback: (node: DOMRefNode, scope: T) => { nextScope: T; stop: boolean },
      scope: T,
    ) {
      let { nextScope, stop } = callback(node, scope);
      if (stop) {
        return;
      }
      for (let child of node.children) {
        recurse(child, callback, nextScope);
      }
    }
    for (let node of displacedDOMRefs) {
      recurse<undefined>(
        node,
        (node, _) => {
          if (node.parent) {
            node.delete();
          } else {
            this.DOMRefs = this.DOMRefs.filter((v) => v !== node);
          }
          deleted.add(node);
          return {
            nextScope: undefined,
            stop: false,
          };
        },
        undefined,
      );
    }
    for (let DOMRef of this.DOMRefs) {
      recurse<{
        lastLiveAncestor: DOMRefNode | undefined;
      }>(
        DOMRef,
        (node, scope) => {
          if (unanimatedDetachedDOMRefs.has(node)) {
            if (node.parent) {
              node.delete();
            } else {
              this.DOMRefs = this.DOMRefs.filter((v) => v !== node);
            }
            deleted.add(node);
            return {
              nextScope: {
                ...scope,
              },
              stop: false,
            };
          } else if (animatedDetachedDOMRefs.has(node)) {
            if (scope.lastLiveAncestor) {
              if (node.parent) {
                node.delete();
              } else {
                this.DOMRefs = this.DOMRefs.filter((v) => v !== node);
              }
              nodesToGraft.set(node, scope.lastLiveAncestor);
              return {
                nextScope: {
                  ...scope,
                },
                stop: true, // no need to iterate into the children of this node, because it is currently being used (it has animations on it)
              };
            } else {
              if (node.parent) {
                node.delete();
              } else {
                this.DOMRefs = this.DOMRefs.filter((v) => v !== node);
              }
              deleted.add(node);
              return {
                nextScope: {
                  lastLiveAncestor: undefined,
                },
                stop: false,
              };
            }
          } else {
            // We're still on a live branch, so return this node as the lastLiveAncestor
            // It will become the graft target later
            return {
              nextScope: {
                lastLiveAncestor: node,
              },
              stop: false,
            };
          }
        },
        {
          lastLiveAncestor: undefined,
        },
      );
    }

    for (let [nodeToGraft, graftTo] of nodesToGraft) {
      nodeToGraft.parent = graftTo;
      graftTo.children.push(nodeToGraft);
    }

    for (let node of deleted) {
      // TODO: once we have cloning, we'll have to check the clones too
      if (node.animationParticipant.uiState.detached?.DOMRef === node) {
        node.animationParticipant.uiState.detached = undefined;
      }
    }

    for (let animationParticipant of this.participants) {
      if (
        animationParticipant.canBeCleanedUp &&
        (!animationParticipant.uiState.detached ||
          deleted.has(animationParticipant.uiState.detached.DOMRef))
      ) {
        this.participants.delete(animationParticipant);
      }
      animationParticipant.cancelAnimations();
    }
  }

  updateParticipants(changes: {
    insertedContexts: Set<IContext>;
    insertedSpriteModifiers: Set<ISpriteModifier>;
    removedContexts: Set<IContext>;
    removedSpriteModifiers: Set<ISpriteModifier>;
  }): void {
    // Clean up stale removed element references each time we animate
    this.performCleanup();

    let elementLookup: Map<HTMLElement, AnimationParticipant> = new Map();
    let keyLookup: Map<string, AnimationParticipant> = new Map();
    let groups: Map<AnimationParticipant, MatchGroup> = new Map();
    for (let animationParticipant of this.participants) {
      let identifier = animationParticipant.identifier;
      if (identifier.key) {
        keyLookup.set(identifier.key, animationParticipant);
      }
      // Element should never be null unless something wasn't cleaned up
      if (identifier.element) {
        elementLookup.set(identifier.element, animationParticipant);
      }
      groups.set(animationParticipant, {});
    }
    function getExistingGroupByElement(element: HTMLElement): MatchGroup {
      let participant = elementLookup.get(element as HTMLElement);
      if (!participant) {
        throw new Error('Unexpected unmatched removed element');
      }
      let group = groups.get(participant);
      if (!group) {
        throw new Error('Unexpected missing group');
      }
      return group;
    }
    function getExistingGroupByKey(key: string): MatchGroup | undefined {
      let participant = keyLookup.get(key);
      if (!participant) {
        return undefined;
      }
      let group = groups.get(participant);
      if (!group) {
        throw new Error('Unexpected missing group');
      }
      return group;
    }

    // Removed things MUST have a match in existing participants. If they don't, we should error.
    for (let modifier of changes.removedSpriteModifiers) {
      // for removed sprite modifiers, the identifier should not matter
      // what's important is the element it matches
      getExistingGroupByElement(
        modifier.element as HTMLElement,
      ).removedSpriteModifier = modifier;
    }
    for (let context of changes.removedContexts) {
      getExistingGroupByElement(context.element as HTMLElement).removedContext =
        context;
    }

    // Matching insertions can only happen via a matching identifier
    // Contexts piggyback on SpriteModifiers that have been matched
    // since there is no concept of matching a context on its own
    // but it's important to recognize that a matched sprite modifier's element
    // also belongs to an AnimationContext
    let insertedElementToGroup: Map<HTMLElement, MatchGroup> = new Map();
    let toCreateNewParticipants: Map<
      HTMLElement,
      {
        context?: IContext;
        spriteModifier?: ISpriteModifier;
      }
    > = new Map();
    for (let modifier of changes.insertedSpriteModifiers) {
      let element = modifier.element as HTMLElement;
      let group = getExistingGroupByKey(this.generateIdentifierKey(modifier));
      if (group) {
        group.insertedSpriteModifier = modifier;
        insertedElementToGroup.set(element, group);
      } else {
        toCreateNewParticipants.set(element, {
          spriteModifier: modifier,
        });
      }
    }
    for (let context of changes.insertedContexts) {
      let element = context.element as HTMLElement;
      let group = insertedElementToGroup.get(element);
      if (group) {
        group.insertedContext = context;
        continue;
      }

      let newGroup = toCreateNewParticipants.get(element);
      if (newGroup) {
        newGroup.context = context;
        continue;
      } else {
        toCreateNewParticipants.set(element, {
          context,
        });
      }
    }

    let DOMRefNodes: DOMRefNode[] = [];
    for (let [element, creationAargs] of toCreateNewParticipants) {
      if (!creationAargs) {
        throw new Error('Unexpected missing group');
      }
      if (!creationAargs.spriteModifier && !creationAargs.context) {
        throw new Error(
          'Invalid new group detected, missing either spriteModifier or context',
        );
      }

      let identifier = new AnimationParticipantIdentifier(
        creationAargs.spriteModifier
          ? this.generateIdentifierKey(creationAargs.spriteModifier)
          : null,
        element,
      );
      let DOMRef = new DOMRefNode(element);
      let animationParticipant = new AnimationParticipant({
        identifier,
        spriteModifier: creationAargs.spriteModifier,
        context: creationAargs.context,
        DOMRef,
      });
      DOMRef.animationParticipant = animationParticipant;
      DOMRefNodes.push(DOMRef);
      this.participants.add(animationParticipant);
    }

    for (let [animationParticipant, matchGroup] of groups) {
      let insertedElement: HTMLElement | undefined = (
        matchGroup.insertedContext || matchGroup.insertedSpriteModifier
      )?.element as HTMLElement;

      if (insertedElement) {
        let DOMRef = new DOMRefNode(insertedElement);
        matchGroup.insertedDOMRef = DOMRef;
        DOMRef.animationParticipant = animationParticipant;
        DOMRefNodes.push(matchGroup.insertedDOMRef);
      }

      animationParticipant.handleMatches(matchGroup);
    }

    this.DOMRefs = addToDOMRefTrees(this.DOMRefs, DOMRefNodes);
  }

  // Called before snapshotBeforeRender
  clearSnapshots(): void {
    this.participants.forEach((participant) => {
      participant.clearSnapshots();
    });
  }

  // Called before render
  snapshotBeforeRender(): void {
    this.participants.forEach((participant) => {
      participant.snapshotBeforeRender();
    });
  }

  // Called after updateParticipants is complete
  snapshotAfterRender(): void {
    this.participants.forEach((participant) => {
      participant.snapshotAfterRender();
    });
  }

  // Create objects that are relevant for only this render
  // Animators are a layer over contexts that have knowledge of AnimationParticipant state
  // and define visibility of a context (what sprites can this context match this render, in what ways?)
  // As part of this, we'll need to mark contexts as having completed their first render
  createAnimatorsAndSprites(): {
    animators: Animator[]; // Sorted in the order rules should be applied.
    sprites: Sprite[]; // Sprites. No particular order
  } {
    let animators: Animator[] = [];

    // Find out what animators are ancestors of each given DOMRef
    let animatorsByDOMRef = new Map<DOMRefNode, Animator[]>();
    let animatorLookup = new Map<DOMRefNode, Animator>();
    for (let participant of this.participants) {
      if (participant.context) {
        if (!participant.uiState.current) {
          throw new Error(
            'Unexpected missing state for context during distribution',
          );
        }
        let animator = participant.asAnimator();
        if (!animator) {
          continue;
        }
        animators.push(animator);
        animatorLookup.set(participant.uiState.current.DOMRef, animator);
      }
    }
    let recordAnimatorsOnPath = (
      node: DOMRefNode,
      pathNotIncludingSelf: Animator[],
    ) => {
      animatorsByDOMRef.set(node, pathNotIncludingSelf);
      let animator = animatorLookup.get(node);
      let nextPath = animator
        ? pathNotIncludingSelf.concat(animator)
        : pathNotIncludingSelf;
      for (let index = 0; index < node.children.length; index++) {
        let child = node.children[index]!;
        recordAnimatorsOnPath(child, nextPath);
      }
    };
    for (let index = 0; index < this.DOMRefs.length; index++) {
      let DOMRef = this.DOMRefs[index]!;
      recordAnimatorsOnPath(DOMRef, []);
    }

    // Create sprites
    let spriteForParticipant: Map<AnimationParticipant, Sprite> = new Map();
    for (let participant of this.participants) {
      let sprite = participant.asSprite();
      if (sprite === null) {
        continue;
      }
      spriteForParticipant.set(participant, sprite);

      // Using the DOMRef, retrieve a list of animators that are ancestors of the sprite
      let animatorList: Animator[] = [];

      // If there is a counterpart, the list should be the intersection of the sprite's DOMRef and its counterpart's DOMRef
      if (participant.uiState.detached && participant.uiState.current) {
        let current = animatorsByDOMRef.get(
          participant.uiState.current.DOMRef,
        )!;
        let detached = animatorsByDOMRef.get(
          participant.uiState.detached.DOMRef,
        )!;
        animatorList = [];
        for (let i = 0; i < Math.min(current.length, detached.length); i++) {
          let c = current[i]!;
          let p = detached[i]!;
          if (c === p) {
            animatorList.push(c);
          } else {
            break;
          }
        }
      } else if (participant.uiState.current) {
        animatorList = animatorsByDOMRef.get(
          participant.uiState.current.DOMRef,
        )!;
        assert('animator list does not exist for a DOMRef', animatorList);
      } else if (participant.uiState.detached) {
        animatorList = animatorsByDOMRef.get(
          participant.uiState.detached.DOMRef,
        )!;
        assert('animator list does not exist for a DOMRef', animatorList);
      } else {
        throw new Error('Unexpected uiState when animating');
      }

      // Store visibility info on the sprite because we can update the sprite when cloned, after this initial calculation
      // Because of the way we create the animatorList, it is a list in order of their hierarchy in the DOMRefNode tree
      // If an Animator happens to clone a sprite, the visibility of all sprites in the subtree changes to
      // let indexOfAnimator = sprite.animatorAncestors.indexOf(animatorThatClonedThis);
      // sprite.defaultAnimator = sprite.animatorAncestors[indexOfAnimator];
      // sprite.animatorAncestors = sprite.animatorAncestors.slice(0, indexOfAnimator + 1);
      // Which should reduce the need to do recalculation while distributing
      // If we want to allow cloned contexts to still operate (but on the clones), then we can choose to not do this, too
      sprite.animatorAncestors = animatorList.slice();
      sprite.defaultAnimator = animatorList[animatorList.length - 1];
    }

    // Inject the participant with knowledge about its parent
    spriteForParticipant.forEach((sprite, participant) => {
      if (sprite.type === SpriteType.Removed) {
        let parentParticipant =
          participant.uiState.detached!.DOMRef.parent?.animationParticipant;
        if (parentParticipant?.animator) {
          sprite._defaultParentState = parentParticipant.animator._state;
        } else if (parentParticipant?.sprite) {
          sprite._defaultParentState = parentParticipant.sprite._state;
        }
      } else {
        let parentParticipant =
          participant.uiState.current!.DOMRef.parent?.animationParticipant;
        if (parentParticipant?.animator) {
          sprite._defaultParentState = parentParticipant.animator._state;
        } else if (parentParticipant?.sprite) {
          sprite._defaultParentState = parentParticipant.sprite._state;
        }

        if (sprite.counterpart) {
          let parentParticipant =
            participant.uiState.detached!.DOMRef.parent?.animationParticipant;
          // Order of preference for parent:
          // - If there's a stable context, that's the first priority (this precludes a removed parent)
          // - If not, then if the parent itself is removed, it should be prioritized
          if (parentParticipant?.animator) {
            sprite.counterpart._defaultParentState =
              parentParticipant.animator._state;
          } else if (parentParticipant?.sprite) {
            if (parentParticipant.sprite.counterpart) {
              sprite.counterpart._defaultParentState =
                parentParticipant.sprite.counterpart._state;
            } else {
              sprite.counterpart._defaultParentState =
                parentParticipant.sprite._state;
            }
          }
        }
      }
    });

    return {
      animators,
      sprites: Array.from(spriteForParticipant.values()),
    };
  }

  log() {
    let participants: Record<string, AnimationParticipant> = {};
    let keyFromParticipant: Map<
      AnimationParticipant,
      {
        current: DOMRefNode | undefined;
        detached: DOMRefNode | undefined;
        key: string;
      }
    > = new Map();
    let asTreeNode = (r: DOMRefNode): TreeNode => {
      let things = keyFromParticipant.get(r.animationParticipant)!;
      let state = things.current === r ? '➕' : '❌';
      return {
        text: things.key,
        extra: state,
        children: r.children.map((child) => asTreeNode(child)),
      };
    };

    let ctxCount = 0;
    for (let participant of this.participants) {
      let key =
        [
          participant.context ? '🥡' : '',
          participant.latestModifier ? '🥠' : '',
        ].join('') +
        ':' +
        (participant.identifier.key ??
          participant.context?.id ??
          `ctx-${ctxCount++}`);
      participants[key] = participant;
      keyFromParticipant.set(participant, {
        key,
        detached: participant.uiState.detached?.DOMRef,
        current: participant.uiState.current?.DOMRef,
      });
    }

    let domRefNodeTree: TreeNode[] = this.DOMRefs.map((n) => asTreeNode(n));

    console.log(formatTreeString(domRefNodeTree));
    console.log(participants);
  }
}

class AnimationParticipantIdentifier {
  constructor(
    readonly key: string | null,
    public element: HTMLElement | null,
  ) {}

  updateElement(element: HTMLElement | null) {
    this.element = element;
  }
}

export class AnimationParticipant {
  context: IContext | undefined = undefined;
  latestModifier: ISpriteModifier | undefined = undefined;
  identifier: AnimationParticipantIdentifier;
  // An interesting point is how to keep track of clones
  // If we keep track of clones here, we need to be able to clean up the latest clone in case of an interruption
  // The clones should STILL be helping us decide on visibility of the Sprite to Animators UNTIL new clones are put in place
  // Then they need to be cleaned up
  // If clones have layers, this may be tricky
  uiState: {
    current:
      | ClearedCurrentState
      | BeforeRenderCurrentState
      | AfterRenderCurrentState
      | undefined;
    detached: ClearedDetachedState | BeforeRenderDetachedState | undefined;
  } = {
    current: undefined,
    detached: undefined,
  };

  // These references have to be cleared every render
  // They are used to handle side effects of animations
  animator: Animator | undefined;
  sprite: Sprite | undefined;

  // When we replace a domref, we need to dispose of it
  // This is a bit of a weird place, because a subtree that's detached from the DOM
  // can potentially be controlled by different contexts while maintaining its structure
  // So... what do we do?
  // For something to be disposed, we need to either have the entire subtree be disposable
  // Or we need to move the used descendants out (that's probably what we do)
  // So... any detached that completes animating is moved here
  // Any detached that is deleted (for a new detached) is moved here
  // Then we run cleanup at times which the manager thinks are appropriate
  // Cleanup needs to be able to do "pruning" of a tree where we can graft living nodes back on
  _DOMRefsToDispose: Set<DOMRefNode> = new Set();

  constructor(options: {
    DOMRef: DOMRefNode;
    context?: IContext;
    identifier: AnimationParticipantIdentifier;
    spriteModifier?: ISpriteModifier;
  }) {
    if (!options.context && !options.spriteModifier) {
      throw new Error(
        'AnimationParticipant needs to be initialized with a sprite modifier or context',
      );
    }

    this.context = options.context;
    this.latestModifier = options.spriteModifier;
    this.identifier = options.identifier;
    this.createCurrent(options.DOMRef);
  }

  isInvalid(): boolean {
    return Boolean(
      (!this.uiState.detached && !this.uiState.current) ||
        (this.uiState.current &&
          this.uiState.current._stage !== 'AFTER_RENDER') ||
        (this.uiState.detached &&
          this.uiState.detached._stage !== 'BEFORE_RENDER'),
    );
  }

  canCreateSprite(): boolean {
    return Boolean(this.latestModifier);
  }

  spriteIsKept(): this is {
    uiState: { current: AfterRenderCurrentState; detached: undefined };
  } {
    return Boolean(
      this.uiState.current &&
        this.uiState.current.beforeRender &&
        this.uiState.current.afterRender &&
        !this.uiState.detached,
    );
  }

  spriteIsKeptWithCounterpart(): this is {
    uiState: {
      current: AfterRenderCurrentState;
      detached: BeforeRenderDetachedState;
    };
  } {
    return Boolean(this.uiState.current && this.uiState.detached);
  }

  // Types are a bit wonky
  // We're not including the missing beforeRender in this type
  spriteIsInserted(): this is {
    uiState: {
      current: AfterRenderCurrentState;
      detached: undefined;
    };
  } {
    return Boolean(this.uiState.current && !this.uiState.current.beforeRender);
  }

  spriteIsRemoved(): this is {
    uiState: { current: undefined; detached: BeforeRenderDetachedState };
  } {
    return Boolean(this.uiState.detached && !this.uiState.current);
  }

  // TODO: This is a bit tricky. If a removed parent is still hang around, we shouldn't clean these up, maybe
  // Though we actually don't really remove things from the DOM, we just lose the reference that leads us to animate
  // things, so it might be okay to clean up
  get canBeCleanedUp(): boolean {
    return (
      (!this.uiState.current && !this.uiState.detached) ||
      (this.spriteIsRemoved() &&
        (!this.uiState.detached.animation ||
          this.uiState.detached.animation?.playState === 'finished' ||
          this.uiState.detached.animation?.playState === 'idle' ||
          this.uiState.detached.animation?.playState === 'paused')) ||
      (!this.canCreateSprite() && !this.context)
    );
  }

  get metadata(): Record<'id' | 'role', string> | null {
    if (this.latestModifier) {
      let result: Record<string, string> = {};
      if (this.latestModifier.id) {
        result['id'] = this.latestModifier.id;
      }
      if (this.latestModifier.role) {
        result['role'] = this.latestModifier.role;
      }
      return result;
    } else {
      return null;
    }
  }

  private currentCallbacks() {
    let onCurrentAnimation = (animation: Animation) => {
      if (!this.uiState.current) {
        throw new Error(
          'Unexpected missing uiState.current when starting current animation',
        );
      }
      this.uiState.current.animation = animation;
    };

    return {
      onAnimationStart: onCurrentAnimation,
    };
  }

  private detachedCallbacks() {
    let onDetachedAnimation = (animation: Animation) => {
      if (!this.uiState.detached) {
        throw new Error(
          'Unexpected missing uiState.detached when starting detached animation',
        );
      }
      this.uiState.detached.animation = animation;
    };

    return {
      onAnimationStart: onDetachedAnimation,
    };
  }

  asSprite(): Sprite | null {
    if (this.canCreateSprite()) {
      // Limit the non-null assertions
      let metadata = this.metadata!;
      if (this.spriteIsKeptWithCounterpart()) {
        let sprite = new Sprite(
          this.uiState.current.DOMRef.element,
          metadata,
          {
            initial:
              this.uiState.current.beforeRender ??
              this.uiState.detached.beforeRender,
            final: this.uiState.current.afterRender,
          },
          SpriteType.Kept,
          this.currentCallbacks(),
        );
        let counterpart = new Sprite(
          this.uiState.detached.DOMRef.element,
          metadata,
          {
            // Counterparts can start out at a different state
            initial: this.uiState.detached.beforeRender,
            final: this.uiState.current.afterRender,
          },
          SpriteType.Removed,
          this.detachedCallbacks(),
        );
        sprite.counterpart = counterpart;

        this.sprite = sprite;
        return sprite;
      } else if (this.spriteIsKept()) {
        let sprite = new Sprite(
          this.uiState.current.DOMRef.element,
          metadata,
          {
            initial: this.uiState.current.beforeRender,
            final: this.uiState.current.afterRender,
          },
          SpriteType.Kept,
          this.currentCallbacks(),
        );

        this.sprite = sprite;
        return sprite;
      } else if (this.spriteIsInserted()) {
        let sprite = new Sprite(
          this.uiState.current.DOMRef.element,
          metadata,
          {
            final: this.uiState.current.afterRender,
          },
          SpriteType.Inserted,
          this.currentCallbacks(),
        );

        this.sprite = sprite;
        return sprite;
      } else if (this.spriteIsRemoved()) {
        let sprite = new Sprite(
          this.uiState.detached.DOMRef.element,
          metadata,
          {
            initial: this.uiState.detached.beforeRender,
          },
          SpriteType.Removed,
          this.detachedCallbacks(),
        );

        this.sprite = sprite;
        return sprite;
      } else {
        throw new Error('Unexpected missing UI state while creating Sprite');
      }
    } else {
      return null;
    }
  }

  asAnimator(): Animator | null {
    if (!this.context) {
      return null;
    } else if (this.context.isStable) {
      // Since by definition a context is only stable after it's been around for at least 1 render,
      // We definitely should have a beforeRender snapshot
      if (
        this.uiState.current?.beforeRender &&
        this.uiState.current?.afterRender
      ) {
        let animator = new Animator(this.context, {
          initial: this.uiState.current.beforeRender,
          final: this.uiState.current.afterRender,
        });
        this.animator = animator;
        return animator;
      } else {
        throw new Error('Unexpected missing Snapshots while creating Animator');
      }
    } else {
      this.context.isInitialRenderCompleted = true;
      return null;
    }
  }

  handleMatches({
    insertedSpriteModifier,
    removedSpriteModifier,
    insertedContext,
    insertedDOMRef,
    removedContext,
  }: MatchGroup) {
    // Removed contexts can happen if the element matches, so we don't check for also having a sprite modifier
    // The order of insertion and removal handling is important.
    // if a context is also a sprite and happens to be in a counterpart situation, we want to replace the context
    if (removedContext && insertedContext) {
      this.context = insertedContext;
    } else if (insertedContext) {
      // If we're receiving an inserted context that matches an existing animation participant, then
      // it means that it's also a sprite.
      if (insertedContext && !insertedSpriteModifier) {
        throw new Error(
          'Unexpectedly matched an inserted context without an inserted sprite modifier',
        );
      }
      this.context = insertedContext;
    } else if (removedContext) {
      this.context = undefined;
      if (!removedSpriteModifier) {
        assert(
          'Unexpectedly removing a context without also removing a sprite modifier, despite the context once having been a sprite',
          !this.latestModifier,
        );
        this.currentToDetached();
        this.identifier.updateElement(null);
        return;
      }
    }

    // Ensure we don't hit "impossible" conditions
    if (
      this.uiState.current &&
      insertedSpriteModifier &&
      !removedSpriteModifier
    ) {
      throw new Error(
        'Invalid insertion that matches existing element without removal',
      );
    }
    if (
      this.uiState.detached &&
      !this.uiState.current &&
      removedSpriteModifier
    ) {
      throw new Error('Invalid removal of already removed element');
    }
    if (!this.uiState.current && !this.uiState.detached) {
      throw new Error(
        'While matching, detected invalid AnimationParticipant with no current or detached UI state',
      );
    }

    if (removedSpriteModifier && insertedSpriteModifier) {
      assert(
        'removedSpriteModifier does not match current DOMRef',
        removedSpriteModifier.element === this.uiState.current?.DOMRef.element,
      );
      assert('inserted items did not come with a dom ref', insertedDOMRef);

      this.currentToDetached();
      this.createCurrent(insertedDOMRef);
      this.latestModifier = insertedSpriteModifier;
      this.identifier.updateElement(insertedDOMRef.element);
    } else if (removedSpriteModifier) {
      assert(
        'removedSpriteModifier does not match current DOMRef',
        removedSpriteModifier.element === this.uiState.current?.DOMRef.element,
      );
      this.currentToDetached();
      this.identifier.updateElement(null);
    } else if (insertedSpriteModifier) {
      assert('inserted items did not come with a dom ref', insertedDOMRef);

      this.createCurrent(insertedDOMRef);
      this.latestModifier = insertedSpriteModifier;
      this.identifier.updateElement(insertedDOMRef.element);
    }
  }

  createCurrent(DOMRef: DOMRefNode) {
    this.uiState.current = {
      _type: 'current',
      _stage: 'BEFORE_RENDER',
      beforeRender: undefined,
      afterRender: undefined,
      DOMRef,
      animation: undefined,
    };
  }

  currentToDetached() {
    let current = this.uiState.current;
    if (
      !current ||
      current._stage !== 'BEFORE_RENDER' ||
      current.beforeRender === undefined
    ) {
      throw new Error(
        'Attempting to convert current in invalid state to detached',
      );
    }

    if (current.animation) {
      throw new Error('Failed to cancel animation before handling matches');
    }
    if (this.uiState.detached) {
      // this is a situation where we have 2 elements fighting to be the detached element, no clear solution
      // It might be right to limit the ways people can interact with counterparts
      this._DOMRefsToDispose.add(this.uiState.detached.DOMRef);
    }

    this.uiState.detached = {
      ...(current as BeforeRenderCurrentState),
      animation: undefined, // TODO: how to make sure this gets cleaned up?
      _stage: 'BEFORE_RENDER',
      _type: 'detached',
      beforeRender: current.beforeRender,
    };
    this.uiState.current = undefined;
  }

  clearSnapshots(): void {
    this.animator = undefined;
    this.sprite = undefined;

    if (this.uiState.current) {
      assert(
        'UI state is not AFTER_RENDER before clear',
        this.uiState.current._stage === 'AFTER_RENDER',
      );
      this.uiState.current = {
        ...this.uiState.current,
        _stage: 'CLEARED',
        beforeRender: undefined,
        afterRender: undefined,
      };
    }
    if (this.uiState.detached) {
      assert(
        'UI state is not BEFORE_RENDER before clear',
        this.uiState.detached._stage === 'BEFORE_RENDER',
      );
      this.uiState.detached = {
        ...this.uiState.detached,
        _stage: 'CLEARED',
        beforeRender: undefined,
        afterRender: undefined,
      };
    }
  }

  snapshotBeforeRender(): void {
    if (this.uiState.current) {
      assert(
        'UI state is not CLEARED before snapshotBeforeRender',
        this.uiState.current._stage === 'CLEARED',
      );
      this.uiState.current = {
        ...this.uiState.current,
        _stage: 'BEFORE_RENDER',
        beforeRender: this.visibleStateSnapshot(this.uiState.current),
        afterRender: undefined,
      };
    }

    if (this.uiState.detached) {
      assert(
        'UI state is not CLEARED before snapshotBeforeRender',
        this.uiState.detached._stage === 'CLEARED',
      );
      this.uiState.detached = {
        ...this.uiState.detached,
        _stage: 'BEFORE_RENDER',
        beforeRender: this.visibleStateSnapshot(this.uiState.detached),
      };
    }
  }

  cancelAnimations() {
    if (this.uiState.detached) {
      this.uiState.detached.animation?.cancel();
      this.uiState.detached.animation = undefined;
    }
    if (this.uiState.current) {
      this.uiState.current.animation?.cancel();
      this.uiState.current.animation = undefined;
    }
  }

  snapshotAfterRender(): void {
    if (this.uiState.current) {
      assert(
        'UI state is not BEFORE_RENDER before snapshotAfterRender',
        this.uiState.current._stage === 'BEFORE_RENDER',
      );
      this.uiState.current = {
        ...this.uiState.current,
        _stage: 'AFTER_RENDER',
        afterRender: this.finalStateSnapshot(this.uiState.current),
      };
    }
  }

  private finalStateSnapshot(target: { DOMRef: DOMRefNode }): Snapshot {
    let bounds = getDocumentPosition(target.DOMRef.element);
    let styles = copyComputedStyle(target.DOMRef.element);
    return {
      bounds,
      styles,
    };
  }

  private visibleStateSnapshot(target: {
    DOMRef: DOMRefNode;
    animation?: Animation;
  }): Snapshot {
    let element = target.DOMRef.element;
    let opts:
      | {
          playAnimations: false;
          withAnimations: true;
        }
      | undefined = undefined;
    if (target.animation) {
      opts = {
        withAnimations: true,
        playAnimations: false,
      };
      element = (target.animation?.effect as KeyframeEffect)
        .target as HTMLElement;
    }
    let bounds = getDocumentPosition(element, opts);
    let styles = copyComputedStyle(element);
    return {
      bounds,
      styles,
    };
  }
}

interface ClearedDetachedState {
  DOMRef: DOMRefNode;
  _stage: 'CLEARED';
  _type: 'detached';
  afterRender: undefined;
  animation: Animation | undefined;
  beforeRender: undefined;
}
interface BeforeRenderDetachedState {
  DOMRef: DOMRefNode;
  _stage: 'BEFORE_RENDER';
  _type: 'detached';
  afterRender: undefined;
  animation: Animation | undefined;
  beforeRender: Snapshot;
}
interface ClearedCurrentState {
  DOMRef: DOMRefNode;
  _stage: 'CLEARED';
  _type: 'current';
  afterRender: undefined;
  animation: Animation | undefined;
  beforeRender: undefined;
}
interface BeforeRenderCurrentState {
  DOMRef: DOMRefNode;
  _stage: 'BEFORE_RENDER';
  _type: 'current';
  afterRender: undefined;
  animation: Animation | undefined;
  beforeRender: Snapshot | undefined;
}
interface AfterRenderCurrentState {
  DOMRef: DOMRefNode;
  _stage: 'AFTER_RENDER';
  _type: 'current';
  afterRender: Snapshot;
  animation: Animation | undefined;
  beforeRender: Snapshot | undefined;
}
