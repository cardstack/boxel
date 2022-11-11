import { assert } from '@ember/debug';
import {
  getDocumentPosition,
  copyComputedStyle,
  Snapshot,
} from '../utils/measurement';
import Sprite, { SpriteType } from './sprite';
import { IContext, ISpriteModifier } from './sprite-tree';

// Currently this is just a wrapper around a context
// We already have a first pass that kicks out unstable contexts, but cloning introduces another layer that disables contexts
// when cloning is introduced, this can be used store state about whether this context should be allowed to animate
// We could try to introduce that right now for counterpart-animated stuff
export class Animator {
  constructor(
    private participant: AnimationParticipant,
    public context: IContext,
    public _state: {
      initial: Snapshot;
      final: Snapshot;
    }
  ) {}

  handleSprites(sprites: Sprite[]) {
    let keptSprites = new Set<Sprite>();
    let insertedSprites = new Set<Sprite>();
    let removedSprites = new Set<Sprite>();

    for (let sprite of sprites) {
      if (sprite.defaultAnimator === this) {
        sprite.within(this);
        if (sprite.type === SpriteType.Inserted) {
          insertedSprites.add(sprite);
        } else if (sprite.type === SpriteType.Removed) {
          removedSprites.add(sprite);
        } else if (sprite.type === SpriteType.Kept) {
          keptSprites.add(sprite);
        } else throw new Error(`Unexpected sprite type: ${sprite.type}`);
      }
    }

    return {
      keptSprites,
      removedSprites,
      insertedSprites,
    };
  }
}

interface MatchGroup {
  insertedSpriteModifier?: ISpriteModifier;
  removedSpriteModifier?: ISpriteModifier;
  insertedDOMRef?: DOMRefNode;
  insertedContext?: IContext;
  removedContext?: IContext;
}

// How do we make it possible to easily move DOMRefNodes around?
class DOMRefNode {
  animationParticipant?: AnimationParticipant;
  parent: DOMRefNode | undefined = undefined;
  children: Array<DOMRefNode> = [];

  constructor(readonly element: HTMLElement) {}
}

export class AnimationParticipantManager {
  DOMRefs: Array<DOMRefNode> = [];
  DOMRefLookup: Map<HTMLElement, DOMRefNode> = new Map();
  participants: Set<AnimationParticipant> = new Set();

  // Class-internal utility for matching inserted sprites to participants
  // Expose for unit-testing if necessary
  generateIdentifierKey(modifier: ISpriteModifier): string {
    // This is implicitly requiring that we assign a unique id to every sprite modifier
    return modifier.id;
  }

  updateParticipants(changes: {
    insertedContexts: Set<IContext>;
    removedContexts: Set<IContext>;
    insertedSpriteModifiers: Set<ISpriteModifier>;
    removedSpriteModifiers: Set<ISpriteModifier>;
  }): void {
    let elementLookup: Map<HTMLElement, AnimationParticipant> = new Map();
    let keyLookup: Map<string, AnimationParticipant> = new Map();
    let groups: Map<AnimationParticipant, MatchGroup> = new Map();

    for (let animationParticipant of this.participants) {
      let identifier = animationParticipant.identifier;
      // Naive cleanup for now.
      // This should be changed to something that can prune DOMRefs AND graft live nodes
      // It should collect all DOMRefs to dispose, then traverse the tree and remove them at one go, preserving
      // nodes that are NOT disposed and all of their descendants
      animationParticipant._DOMRefsToDispose.forEach((DOMRef) => {
        this.DOMRefLookup.delete(DOMRef.element);
        if (DOMRef.parent)
          DOMRef.parent.children = DOMRef.parent.children.filter(
            (v) => v !== DOMRef
          );
      });

      // Clean things up each time we animate
      if (animationParticipant.canBeCleanedUp) {
        this.participants.delete(animationParticipant);
        let DOMRef = animationParticipant.uiState.previous?.DOMRef;
        if (DOMRef) {
          this.DOMRefLookup.delete(DOMRef.element);
          if (DOMRef.parent)
            DOMRef.parent.children = DOMRef.parent.children.filter(
              (v) => v !== DOMRef
            );
        }
      } else {
        if (
          animationParticipant.uiState.previous &&
          (!animationParticipant.uiState.previous.animation ||
            animationParticipant.uiState.previous.animation.playState ===
              'finished')
        ) {
          let DOMRef = animationParticipant.uiState.previous?.DOMRef;
          if (DOMRef) {
            this.DOMRefLookup.delete(DOMRef.element);
            if (DOMRef.parent)
              DOMRef.parent.children = DOMRef.parent.children.filter(
                (v) => v !== DOMRef
              );
          }
          animationParticipant.uiState.previous = undefined;
        }
        if (identifier.key) keyLookup.set(identifier.key, animationParticipant);
        // Element should never be null unless something wasn't cleaned up
        if (identifier.element) {
          elementLookup.set(identifier.element, animationParticipant);
        }
        groups.set(animationParticipant, {});
      }
    }

    // Removed things MUST have a match in existing participants. If they don't, we should error.
    for (let modifier of changes.removedSpriteModifiers) {
      // for removed sprite modifiers, the identifier should not matter
      // what's important is the element it matches
      let participant = elementLookup.get(modifier.element as HTMLElement);
      if (!participant) {
        throw new Error('Unexpected unmatched removed element');
      }
      let group = groups.get(participant);
      if (!group) throw new Error('Unexpected missing group');
      group.removedSpriteModifier = modifier;
    }
    for (let context of changes.removedContexts) {
      let participant = elementLookup.get(context.element as HTMLElement);
      if (!participant) throw new Error('Unexpected unmatched removed element');
      let group = groups.get(participant);
      if (!group) throw new Error('Unexpected missing group');
      group.removedContext = context;
    }

    // Create DOMRefNodes and then sort them by DOM position, before adding to main tree
    let DOMRefNodes: DOMRefNode[] = [];
    let insertedElementToGroup: Map<HTMLElement, MatchGroup> = new Map();
    let toCreateNewParticipants: Set<HTMLElement> = new Set();
    // Inserted things need to be grouped up and a new DOMRefNode created
    for (let modifier of changes.insertedSpriteModifiers) {
      let participant = keyLookup.get(this.generateIdentifierKey(modifier));
      let insertedDOMRef: DOMRefNode = new DOMRefNode(
        modifier.element as HTMLElement
      );
      if (!participant) {
        insertedElementToGroup.set(modifier.element as HTMLElement, {
          insertedDOMRef,
          insertedSpriteModifier: modifier,
        });
        toCreateNewParticipants.add(modifier.element as HTMLElement);
      } else {
        let group = groups.get(participant);
        if (!group) throw new Error('Unexpected missing group');
        group.insertedDOMRef = insertedDOMRef;
        group.insertedSpriteModifier = modifier;
        insertedElementToGroup.set(modifier.element as HTMLElement, group);
      }
    }
    for (let context of changes.insertedContexts) {
      let group = insertedElementToGroup.get(context.element as HTMLElement);
      if (!group) {
        let insertedDOMRef = new DOMRefNode(context.element as HTMLElement);
        insertedElementToGroup.set(context.element as HTMLElement, {
          insertedDOMRef,
          insertedContext: context,
        });
        toCreateNewParticipants.add(context.element as HTMLElement);
      } else {
        // insertedDOMRef already assigned, along with sprite modifier
        group.insertedContext = context;
      }
    }

    for (let element of toCreateNewParticipants) {
      let group = insertedElementToGroup.get(element);
      if (!group) throw new Error('Unexpected missing group');
      if (!group.insertedDOMRef) {
        throw new Error('Missing a DOMRef for fresh inserted participant');
      }
      if (!group.insertedSpriteModifier && !group.insertedContext) {
        throw new Error(
          'Invalid group detected, missing either insertedSpriteModifier or insertedContext'
        );
      }
      let identifier = new AnimationParticipantIdentifier(
        group.insertedSpriteModifier
          ? this.generateIdentifierKey(group.insertedSpriteModifier)
          : null,
        element
      );
      let animationParticipant = new AnimationParticipant({
        identifier,
        spriteModifier: group.insertedSpriteModifier,
        context: group.insertedContext,
        DOMRef: group.insertedDOMRef,
      });
      DOMRefNodes.push(group.insertedDOMRef);
      if (group.insertedDOMRef)
        group.insertedDOMRef.animationParticipant = animationParticipant;
      this.participants.add(animationParticipant);
    }

    for (let [animationParticipant, matchGroup] of groups) {
      if (matchGroup.insertedDOMRef) {
        matchGroup.insertedDOMRef.animationParticipant = animationParticipant;
        DOMRefNodes.push(matchGroup.insertedDOMRef);
      }
      animationParticipant.handleMatches(matchGroup);
    }

    // The DOMRef insertion code is optimizable... but I think it's fine for now
    // We must make sure that ancestors are added before descendants
    DOMRefNodes.sort((a, b) => {
      let bitmask: number = a.element.compareDocumentPosition(b.element);

      assert(
        'Sorting DOMRefNode additions - Document position of two compared nodes is implementation-specific or disconnected',
        !(
          bitmask & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC ||
          bitmask & Node.DOCUMENT_POSITION_DISCONNECTED
        )
      );

      return bitmask & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    for (let node of DOMRefNodes) {
      let maybeParent: DOMRefNode | undefined;
      let searchedElement = node.element;
      while (searchedElement.parentElement) {
        maybeParent = this.DOMRefLookup.get(searchedElement);
        if (maybeParent) {
          break;
        }
        searchedElement = searchedElement.parentElement;
      }
      if (!maybeParent) {
        this.DOMRefs.push(node);
        this.DOMRefLookup.set(node.element, node);
      } else {
        maybeParent.children.push(node);
        node.parent = maybeParent;
        this.DOMRefLookup.set(node.element, node);
      }
    }
  }

  // Called before snapshotBeforeRender
  clear(): void {
    this.participants.forEach((participant) => {
      participant.clear();
    });
  }

  // Called before render
  snapshotBeforeRender(): void {
    this.participants.forEach((participant) => {
      participant.snapshotBeforeRender();
    });
    // Canceling has to happen after all measurements. If it happens before, it risks affecting some measurements
    this.participants.forEach((participant) => {
      participant.cancelAnimations();
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
    let spriteForParticipant: Map<AnimationParticipant, Sprite> = new Map();

    let animatorLookup = new Map<DOMRefNode, Animator>();
    for (let participant of this.participants) {
      if (participant.context) {
        if (!participant.uiState.current)
          throw new Error(
            'Unexpected missing DOMRef for context during distribution'
          );
        let animator = participant.asAnimator();
        if (!animator) continue;
        animators.push(animator);
        animatorLookup.set(participant.uiState.current.DOMRef, animator);
      }
    }

    let animatorsByDOMRef = new Map<DOMRefNode, Animator[]>();
    function recordAnimatorsOnPath(
      node: DOMRefNode,
      pathNotIncludingSelf: Animator[]
    ) {
      animatorsByDOMRef.set(node, pathNotIncludingSelf);
      let animator = animatorLookup.get(node);
      let nextPath = animator
        ? pathNotIncludingSelf.concat(animator)
        : pathNotIncludingSelf;
      for (let index = 0; index < node.children.length; index++) {
        let child = node.children[index]!;
        recordAnimatorsOnPath(child, nextPath);
      }
    }
    for (let index = 0; index < this.DOMRefs.length; index++) {
      let DOMRef = this.DOMRefs[index]!;
      recordAnimatorsOnPath(DOMRef, []);
    }

    for (let participant of this.participants) {
      let sprite = participant.asSprite();
      if (sprite === null) {
        continue;
      }
      spriteForParticipant.set(participant, sprite);

      let animatorList: Animator[] = [];

      if (participant.uiState.previous && participant.uiState.current) {
        let current = animatorsByDOMRef.get(
          participant.uiState.current.DOMRef
        )!;
        let previous = animatorsByDOMRef.get(
          participant.uiState.previous.DOMRef
        )!;
        animatorList = [];
        for (let i = 0; i < Math.min(current.length, previous.length); i++) {
          let c = current[i]!;
          let p = previous[i]!;
          if (c === p) {
            animatorList.push(c);
          } else {
            break;
          }
        }
      } else if (participant.uiState.current) {
        animatorList = animatorsByDOMRef.get(
          participant.uiState.current.DOMRef
        )!;
        assert('animator list is empty', animatorList);
      } else if (participant.uiState.previous) {
        animatorList = animatorsByDOMRef.get(
          participant.uiState.previous.DOMRef
        )!;
        assert('animator list is empty', animatorList);
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

    // HAX!!! actually not, but it doesn't feel great to do this
    spriteForParticipant.forEach((sprite, participant) => {
      if (sprite.type === SpriteType.Removed) {
        let parentParticipant =
          participant.uiState.previous!.DOMRef.parent?.animationParticipant;
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
            participant.uiState.previous!.DOMRef.parent?.animationParticipant;
          // Order of preference for parent:
          // - If there's a stable context, that's the first priority
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

    animators.sort((a, b) => {
      let bitmask = a.context.element.compareDocumentPosition(
        b.context.element
      );

      assert(
        'Sorting animators - Document position of two compared nodes is implementation-specific or disconnected',
        !(
          bitmask & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC ||
          bitmask & Node.DOCUMENT_POSITION_DISCONNECTED
        )
      );

      return bitmask & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    return {
      animators,
      sprites: Array.from(spriteForParticipant.values()),
    };
  }
}

class AnimationParticipantIdentifier {
  constructor(
    readonly key: string | null,
    public element: HTMLElement | null
  ) {}

  updateElement(element: HTMLElement | null) {
    this.element = element;
  }
}

class AnimationParticipant {
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
    previous: ClearedPreviousState | BeforeRenderPreviousState | undefined;
  } = {
    current: undefined,
    previous: undefined,
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
  // So... any previous that completes animating is moved here
  // Any previous that is deleted (for a new previous) is moved here
  // Then we run cleanup at times which the manager thinks are appropriate
  // Cleanup needs to be able to do "pruning" of a tree where we can graft living nodes back on
  _DOMRefsToDispose: Set<DOMRefNode> = new Set();

  constructor(options: {
    context?: IContext;
    spriteModifier?: ISpriteModifier;
    DOMRef: DOMRefNode;
    identifier: AnimationParticipantIdentifier;
  }) {
    if (!options.context && !options.spriteModifier) {
      throw new Error(
        'AnimationParticipant needs to be initialized with a sprite modifier or context'
      );
    }

    this.context = options.context;
    this.latestModifier = options.spriteModifier;
    this.identifier = options.identifier;
    this.uiState.current = this.createCurrent(options.DOMRef);
  }

  isInvalid(): boolean {
    return Boolean(
      (!this.uiState.previous && !this.uiState.current) ||
        (this.uiState.current &&
          this.uiState.current._stage !== 'AFTER_RENDER') ||
        (this.uiState.previous &&
          this.uiState.previous._stage !== 'BEFORE_RENDER')
    );
  }

  isSprite(): boolean {
    return Boolean(this.latestModifier);
  }

  isKept(): this is {
    uiState: { current: AfterRenderCurrentState; previous: undefined };
  } {
    return Boolean(
      this.uiState.current &&
        this.uiState.current.beforeRender &&
        this.uiState.current.afterRender &&
        !this.uiState.previous
    );
  }

  isKeptWithCounterpart(): this is {
    uiState: {
      current: AfterRenderCurrentState;
      previous: BeforeRenderPreviousState;
    };
  } {
    return Boolean(this.uiState.current && this.uiState.previous);
  }

  // Types are a bit wonky
  isInserted(): this is {
    uiState: {
      current: AfterRenderCurrentState;
      previous: undefined;
    };
  } {
    return Boolean(this.uiState.current && !this.uiState.current.beforeRender);
  }

  isRemoved(): this is {
    uiState: { previous: BeforeRenderPreviousState; current: undefined };
  } {
    return Boolean(this.uiState.previous && !this.uiState.current);
  }

  // TODO: This is a bit tricky. If a removed parent is still hang around, we shouldn't clean these up, maybe
  // Though we actually don't really remove things from the DOM, we just lose the reference that leads us to animate
  // things, so it might be okay to clean up
  get canBeCleanedUp(): boolean {
    return (
      (this.isRemoved() &&
        (!this.uiState.previous.animation ||
          this.uiState.previous.animation?.playState === 'finished')) ||
      (!this.isSprite() && !this.context)
    );
  }

  get metadata(): Record<'id' | 'role', string> | null {
    if (this.latestModifier) {
      let result: Record<string, string> = {};
      if (this.latestModifier.id) result['id'] = this.latestModifier.id;
      if (this.latestModifier.role) result['role'] = this.latestModifier.role;
      return result;
    } else {
      return null;
    }
  }

  private currentCallbacks() {
    let onCurrentAnimation = (animation: Animation) => {
      if (!this.uiState.current)
        throw new Error(
          'Unexpected missing uiState.current when starting current animation'
        );
      this.uiState.current.animation = animation;
      animation.addEventListener('cancel', () => {
        // TODO: This is not reliable because
        // We might change current to previous around the same time
        // We've added something to prevent this in currentToPrevious
        // But what can we do to prevent this from causing dangling animations?
        if (
          this.uiState.current &&
          this.uiState.current.animation === animation
        ) {
          this.uiState.current.animation = undefined;
        }
      });
      animation.addEventListener('finish', () => {
        if (
          this.uiState.current &&
          this.uiState.current.animation === animation
        )
          this.uiState.current.animation = undefined;
      });
      animation.addEventListener('remove', () => {
        if (
          this.uiState.current &&
          this.uiState.current.animation === animation
        )
          this.uiState.current.animation = undefined;
      });
    };

    return {
      onAnimationStart: onCurrentAnimation,
    };
  }

  private previousCallbacks() {
    let onPreviousAnimation = (animation: Animation) => {
      if (!this.uiState.previous)
        throw new Error(
          'Unexpected missing uiState.previous when starting Previous animation'
        );
      this.uiState.previous.animation = animation;
      animation.addEventListener('cancel', () => {
        if (
          this.uiState.previous &&
          this.uiState.previous.animation === animation
        )
          this.uiState.previous.animation = undefined;
      });
      animation.addEventListener('finish', () => {
        if (
          this.uiState.previous &&
          this.uiState.previous.animation === animation
        )
          this.uiState.previous.animation = undefined;
      });
      animation.addEventListener('remove', () => {
        if (
          this.uiState.previous &&
          this.uiState.previous.animation === animation
        )
          this.uiState.previous.animation = undefined;
      });
    };

    return {
      onAnimationStart: onPreviousAnimation,
    };
  }

  asSprite(): Sprite | null {
    if (this.isSprite()) {
      // Limit the non-null assertions
      let metadata = this.metadata!;
      if (this.isKeptWithCounterpart()) {
        let sprite = new Sprite(
          this.uiState.current.DOMRef.element,
          metadata,
          {
            initial:
              this.uiState.current.beforeRender ??
              this.uiState.previous.beforeRender,
            final: this.uiState.current.afterRender,
          },
          SpriteType.Kept,
          this.currentCallbacks()
        );
        let counterpart = new Sprite(
          this.uiState.previous.DOMRef.element,
          metadata,
          {
            // Counterparts can start out at a different state
            initial: this.uiState.previous.beforeRender,
            final: this.uiState.current.afterRender,
          },
          SpriteType.Removed,
          this.previousCallbacks()
        );
        sprite.counterpart = counterpart;

        this.sprite = sprite;
        return sprite;
      } else if (this.isKept()) {
        let sprite = new Sprite(
          this.uiState.current.DOMRef.element,
          metadata,
          {
            initial: this.uiState.current.beforeRender,
            final: this.uiState.current.afterRender,
          },
          SpriteType.Kept,
          this.currentCallbacks()
        );

        this.sprite = sprite;
        return sprite;
      } else if (this.isInserted()) {
        let sprite = new Sprite(
          this.uiState.current.DOMRef.element,
          metadata,
          {
            final: this.uiState.current.afterRender,
          },
          SpriteType.Inserted,
          this.currentCallbacks()
        );

        this.sprite = sprite;
        return sprite;
      } else if (this.isRemoved()) {
        let sprite = new Sprite(
          this.uiState.previous.DOMRef.element,
          metadata,
          {
            initial: this.uiState.previous.beforeRender,
          },
          SpriteType.Removed,
          this.previousCallbacks()
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
        let animator = new Animator(this, this.context, {
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

  // This is currently a bit verbose but I think it describes the match handling reasonably
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
          'Unexpectedly matched an inserted context without an inserted sprite modifier'
        );
      }
      this.context = insertedContext;
    } else if (removedContext) {
      this.context = undefined;
      if (!removedSpriteModifier) {
        assert(
          'Unexpectedly removing a context without also removing a sprite modifier, despite the context once having been a sprite',
          !this.latestModifier
        );
        this.identifier.updateElement(null);
        return;
      }
    }

    if (removedSpriteModifier) {
      assert(
        'removedSpriteModifier does not match current DOMRef',
        removedSpriteModifier.element === this.uiState.current?.DOMRef.element
      );
    }

    if (this.uiState.current && this.uiState.previous) {
      if (insertedSpriteModifier && removedSpriteModifier) {
        if (
          this.uiState.current._stage !== 'BEFORE_RENDER' ||
          this.uiState.current.beforeRender === undefined
        ) {
          throw new Error('Invalid attempt to convert current to previous');
        }
        assert('inserted items did not come with a dom ref', insertedDOMRef);

        this._DOMRefsToDispose.add(this.uiState.previous.DOMRef);
        this.uiState.previous = this.currentToPrevious(this.uiState.current);
        this.uiState.current = this.createCurrent(insertedDOMRef);
        this.latestModifier = insertedSpriteModifier;

        // this is a situation where we have 2 elements fighting to be the previous element, no clear solution
        // It might be right to limit the ways people can interact with counterparts
      } else if (removedSpriteModifier) {
        if (
          this.uiState.current._stage !== 'BEFORE_RENDER' ||
          this.uiState.current.beforeRender === undefined
        ) {
          throw new Error('Invalid attempt to convert current to previous');
        }

        this._DOMRefsToDispose.add(this.uiState.previous.DOMRef);
        this.uiState.previous = this.currentToPrevious(this.uiState.current);
        this.uiState.current = undefined;
        this.latestModifier = removedSpriteModifier;

        // this is a situation where we have 2 elements fighting to be the previous element, no clear solution
        // It might be right to limit the ways people can interact with counterparts
      } else if (insertedSpriteModifier) {
        throw new Error(
          'Invalid insertion that matches existing element without removal'
        );
      }
    } else if (this.uiState.current) {
      if (insertedSpriteModifier && removedSpriteModifier) {
        if (
          this.uiState.current._stage !== 'BEFORE_RENDER' ||
          this.uiState.current.beforeRender === undefined
        ) {
          throw new Error('Invalid attempt to convert current to previous');
        }
        assert('inserted items did not come with a dom ref', insertedDOMRef);

        this.uiState.previous = this.currentToPrevious(this.uiState.current);
        this.uiState.current = this.createCurrent(insertedDOMRef);
        this.latestModifier = insertedSpriteModifier;

        // this is a situation where we have 2 elements fighting to be the previous element, no clear solution
        // It might be right to limit the ways people can interact with counterparts
      } else if (removedSpriteModifier) {
        if (
          this.uiState.current._stage !== 'BEFORE_RENDER' ||
          this.uiState.current.beforeRender === undefined
        ) {
          throw new Error('Invalid attempt to convert current to previous');
        }

        this.uiState.previous = this.currentToPrevious(this.uiState.current);
        this.uiState.current = undefined;
        this.latestModifier = removedSpriteModifier;
      } else if (insertedSpriteModifier) {
        throw new Error(
          'Invalid insertion that matches existing element without removal'
        );
      }
    } else if (this.uiState.previous) {
      if (removedSpriteModifier) {
        throw new Error('Invalid removal of already removed element');
      }

      if (insertedSpriteModifier) {
        assert('inserted items did not come with a dom ref', insertedDOMRef);
        this.uiState.current = this.createCurrent(insertedDOMRef);
        this.latestModifier = insertedSpriteModifier;
      }
    } else {
      throw new Error(
        'While matching, detected invalid AnimationParticipant with no current or previous UI state'
      );
    }

    if (insertedSpriteModifier) {
      assert('inserted items did not come with a dom ref', insertedDOMRef);
      this.identifier.updateElement(insertedDOMRef.element);
    } else if (removedSpriteModifier) {
      this.identifier.updateElement(null);
    }
  }

  createCurrent(DOMRef: DOMRefNode): BeforeRenderCurrentState {
    return {
      _type: 'current',
      _stage: 'BEFORE_RENDER',
      beforeRender: undefined,
      afterRender: undefined,
      DOMRef,
      animation: undefined,
    };
  }

  currentToPrevious(
    current: BeforeRenderCurrentState
  ): BeforeRenderPreviousState {
    if (
      current._stage !== 'BEFORE_RENDER' ||
      current.beforeRender === undefined
    ) {
      throw new Error(
        'Attempting to convert current in invalid state to previous'
      );
    }

    return {
      ...current,
      animation: undefined, // TODO: how to make sure this gets cleaned up?
      _stage: 'BEFORE_RENDER',
      _type: 'previous',
      beforeRender: current.beforeRender,
    };
  }

  clear(): void {
    this.animator = undefined;
    this.sprite = undefined;

    if (this.uiState.current) {
      assert(
        'UI state is not AFTER_RENDER before clear',
        this.uiState.current._stage === 'AFTER_RENDER'
      );
      this.uiState.current = {
        ...this.uiState.current,
        _stage: 'CLEARED',
        beforeRender: undefined,
        afterRender: undefined,
      };
    }
    if (this.uiState.previous) {
      assert(
        'UI state is not BEFORE_RENDER before clear',
        this.uiState.previous._stage === 'BEFORE_RENDER'
      );
      this.uiState.previous = {
        ...this.uiState.previous,
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
        this.uiState.current._stage === 'CLEARED'
      );
      this.uiState.current = {
        ...this.uiState.current,
        _stage: 'BEFORE_RENDER',
        beforeRender: this.visibleStateSnapshot(this.uiState.current),
        afterRender: undefined,
      };
    }

    if (this.uiState.previous) {
      assert(
        'UI state is not CLEARED before snapshotBeforeRender',
        this.uiState.previous._stage === 'CLEARED'
      );
      this.uiState.previous = {
        ...this.uiState.previous,
        _stage: 'BEFORE_RENDER',
        beforeRender: this.visibleStateSnapshot(this.uiState.previous),
      };
    }
  }

  cancelAnimations() {
    this.uiState.previous?.animation?.cancel();
    this.uiState.current?.animation?.cancel();
  }

  snapshotAfterRender(): void {
    if (this.uiState.current) {
      assert(
        'UI state is not BEFORE_RENDER before snapshotAfterRender',
        this.uiState.current._stage === 'BEFORE_RENDER'
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
          withAnimations: true;
          playAnimations: false;
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

interface ClearedPreviousState {
  _type: 'previous';
  _stage: 'CLEARED';
  beforeRender: undefined;
  afterRender: undefined;
  animation: Animation | undefined;
  DOMRef: DOMRefNode;
}
interface BeforeRenderPreviousState {
  _type: 'previous';
  _stage: 'BEFORE_RENDER';
  beforeRender: Snapshot;
  afterRender: undefined;
  animation: Animation | undefined;
  DOMRef: DOMRefNode;
}
interface ClearedCurrentState {
  _type: 'current';
  _stage: 'CLEARED';
  beforeRender: undefined;
  afterRender: undefined;
  animation: Animation | undefined;
  DOMRef: DOMRefNode;
}
interface BeforeRenderCurrentState {
  _type: 'current';
  _stage: 'BEFORE_RENDER';
  beforeRender: Snapshot | undefined;
  afterRender: undefined;
  animation: Animation | undefined;
  DOMRef: DOMRefNode;
}
interface AfterRenderCurrentState {
  _type: 'current';
  _stage: 'AFTER_RENDER';
  beforeRender: Snapshot | undefined;
  afterRender: Snapshot;
  animation: Animation | undefined;
  DOMRef: DOMRefNode;
}
