import { AnimationDefinition } from './transition-runner';

// Diagram with state and how long each state is valid + why we need to keep it around

interface AnimationsService {}

interface AnimationParticipantManager {
  domRefs: DOMRefNode;

  // Class-internal utilities for matching sprites to participants
  // Expose for unit-testing if necessary
  generateIdentifier(modifier: ISpriteModifier): string;
  // If there is an existing context that matches an AnimationContext or the sprite modifier (sprite modifiers matched using the identifier)
  // Then update the participant and return it? (Unsure if one-by-one is ok? We might need to do this in a batch to handle certain special cases)
  // If there isn't, create the participant and return it
  // Also update the sprite tree
  participantFor(
    animationContext: IContext | ISpriteModifier
  ): AnimationParticipant;

  // Every render, this will be called after render (but before snapshotAfterRender happens)
  // In this method, we'll be updating AnimationParticipants
  // Contexts are a bit weird, we have to match them on a per-element basis (if we want to only animate stable contexts)
  updateParticipants(changes: {
    insertedContexts: IContext[];
    removedContexts: IContext[];
    insertedSpriteModifiers: ISpriteModifier[];
    removedSpriteModifiers: ISpriteModifier[];
  }): void;

  // Called before snapshotBeforeRender
  clearSnapshots(): void;

  // Called before render
  snapshotBeforeRender(): void;

  // Called after updateParticipants is complete
  snapshotAfterRender(): void;

  // Create objects that are relevant for only this render
  // Animators are a layer over contexts that have knowledge of AnimationParticipant state
  // and define visibility of a context (what sprites can this context match this render, in what ways?)
  // As part of this, we'll need to mark contexts as having completed their first render
  createAnimatorsAndSprites(): {
    animators: Animator[]; // Sorted in the order rules should be applied.
    sprites: Sprite[]; // Sprites. No particular order
  };
}

// Animator and Sprite are per-render
// Animator provides an interface for easy rule-matching and sprite-matching
// All of the visibility rules are done in the AnimationParticipantManager itself, so the DOM/DOMRef hierarchy
// Will never need to be handled by any other parts of the Animation system
// (Until we decide we need it)
interface Animator {
  // property to track sprites that will be visible in handleRemainingSprites, eg.
  // sprites.filter(s => this.immediateDescendants.has(s))
  // private immediateDescendants: Set<Sprite>;

  // property to track sprites that will be visible in applyRules by filtering, eg.
  // sprites.filter(s => this.descendants.has(s))
  // private descendants: Set<Sprite>;

  // wrap the context
  // private context: IContext;

  animationDefinitions: AnimationDefinition[];
  sprites: Set<Sprite>;

  // create animation definitions, keep the sprites in internal state
  // For removed sprites, this will also mean an update to the DOMRefNode's position
  // Unsure what this means for cloning sprites. Allowing a cloned sprite to suddenly change contexts
  // May lead to layer bugs but maybe ensuring that doesn't happen is a user responsibility
  applyRules(sprites: Sprite[]): Sprite[];

  // grab remaining sprites to pass to the AnimationContext's @use function
  // For removed sprites, this will also mean an update to the DOMRefNode's position
  handleRemainingSprites(sprites: Sprite[]): void;

  // Create a Changeset that the current TransitionRunners know how to handle
  // May not be necessary? We could pass the Animator around and/or make it run things instead
  toChangeset(): Changeset;
}

// Sprite is a subset of the AnimationParticipant's properties
// With additional stuff tacked on to make it easier to create animations
interface Sprite {
  // private animationParticipant: AnimationParticipant;

  // This needs to feed back to the AnimationParticipant
  // So that it knows what element is animating, and has a way of keeping
  // track of that element + animation for cleanup and interruption
  // The cloning API needs to do the same, however we decide to implement it
  setupAnimation(...args: any[]): void;

  // If a Sprite is Removed AND it does not get animated, we need to perform actions to remove its representation
  // from the SpriteTree (and maybe remove its AnimationParticipant)
  // so we don't have phantoms lingering in the system
  cleanup(): void;
}

interface DOMRefNode {
  parent?: DOMRefNode;
  element: HTMLElement;
  animationParticipant: AnimationParticipant;
  children: Set<DOMRefNode>;
}

interface AnimationParticipant {
  // Sprite-specific properties
  // Derived from other state.
  // KEPT
  // If there is a current domRef and a previous domRef
  // If there is a current domRef and state captured for beforeRender and afterRender
  //
  // INSERTED
  // If there is a current domRef and state captured for afterRender but not beforeRender
  //
  // REMOVED
  // If there is a previous domRef and no current domRef
  //
  // INVALID
  // If there is a previous domRef and it's not in the BEFORE_RENDER state, it's invalid
  // If there is a current domRef and it's not in the AFTER_RENDER state, it's invalid
  // With this, we can create a UIState class that prevents us from having stale data (maybe overkill?)
  spriteState: 'REMOVED' | 'INSERTED' | 'KEPT' | 'INVALID';
  /**
   * Anytime a sprite modifier with a new identifier is introduced, a new AnimationParticipant
   * is created that keeps track of its state across renders.
   *
   * For AnimationContexts, we don't have a concept of "matching". Therefore if we
   * get the insertion right - make sure that the AnimationContext is recognized as a participant by
   * comparing the element of the AnimationContext against inserted SpriteModifier elements in the
   * same render, we should be ok. Identifiers don't matter for this, making sure that the element
   * matches does.
   */
  identifier: string;
  metadata: Record<string, string>; // This should always match the latest metadata on current (unless there is no current, in which case it has to be previous)
  // If the state is REMOVED and there are no animations on this AnimationParticipant, it can be removed. How and when this cleanup happens is TBD
  // This also may need to account for removed parents that are not yet done animating; we don't have this knowledge yet
  // Workaround at the moment is to make the transition no-op. If your removed sprites are
  // controlled by the same context, they will by nature of the orchestration have a no-op
  // that lasts as long as the longest transition in that context (possibly something we can improve)
  // but this means that removing a child before a parent is unlikely to happen.
  canBeCleanedUp: boolean;

  // How do we deal with contexts that are also animating?
  // Contexts need to supply rules
  // We often need to check whether something is a context or not, manually
  // Contexts that are also sprites + cloning have edge cases we need to be aware of and make possible to debug.
  // Another edge case for contexts is animating a counterpart in while trying to handle certain orphans?
  // I think a lot of state will still need to live on the context (can this animate or not?)
  // But there also is information that can live in the AnimationParticipant (UI state)
  context?: IContext;

  uiState: {
    // We need a beforeRender state for both current and previous because
    // We need to be able to resume counterpart animations when they're interrupted
    // Example is a fade through; we need to know what the opacity of the previous element is
    // This means that higher level APIs cannot be constructed with the assumption that
    // a sprite and its counterpart will have the same state if both are used... I wonder when that is relevant? Though I think it's
    // still right to have the ui state for current and previous elements separate. If something with a counterpart isn't yet animated,
    // (first render) we will still be able to get the beforeRender state from previous and the afterRender state from current
    // If we decide to only animate the current, then the next render we'll be taking both beforeRender and afterRender from current,
    // there will be no counterpart
    // If we decide to animate both, we'll get measurements for beforeRender for both, and afterRender only for current
    // When refactoring to this structure, we can contain the bounds assignments within the AnimationParticipantManager
    current: {
      // Current nodes may not have beforeRender state (might be inserted and hence new)
      beforeRender?: UIState;
      afterRender: UIState;
      // What's the animation? We won't need to query the DOM if we are keeping track of this on an AnimationParticipant
      // The animation is also going to contain a reference to the DOM element that we're handling
      animation?: Animation;
      // Relationships to the DOM. Will be used to check for hierarchy/relationships
      domRef: DOMRefNode;
      _stage: 'CLEARED' | 'BEFORE_RENDER' | 'AFTER_RENDER';
    };
    // This is what becomes a counterpart. It's also the one we refer to for a removed sprite
    previous?: {
      // Previous nodes only have beforeRender state since they no longer exist in the DOM
      beforeRender: UIState;
      // When an animation for previous completes, we need to trigger a series of actions for cleanup
      // Tracking this makes it possible to do cleanup on a per-element basis, rather than per-context
      animation?: Animation;
      // Relationships to the DOM. Will be used to check for hierarchy/relationships
      domRef: DOMRefNode;
      _stage: 'CLEARED' | 'BEFORE_RENDER';
    };
  };
  clearSnapshots(): void;
  snapshotBeforeRender(): void;
  snapshotAfterRender(): void;
}

// I think we would also remove the UI state stored on a context
// There is an edge case re: a context that is also a sprite, that has a counterpart that is animating to its new state
// Measurements for the context will be weird if that's the case.
// But if we're controlling the interface we expose when performing sprite-matching and creating Changesets, then we can mitigate this weirdness
// That said, I think the right thing to do for now is to just warn when we hit this edge case (counterpart animating out and context element animating in)
// I think it's hard to handle this correctly
interface IContext {}

// We'd remove the UI state stored on a sprite modifier
interface ISpriteModifier {}

interface ChangesetBuilder {}

interface Changeset {}

// Any visual properties that we want to track will be in UIState
interface UIState {}
