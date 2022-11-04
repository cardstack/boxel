- each animation participant has its state stored in a long-lived object (AnimationParticipant)
  - sprite modifiers and animation contexts are used to get references to app state + DOM state
    - ui state
    - DOM element
      - DOM element serves as a second way of matching
        - What if a sprite doesn't have an identifier? (We might want to enforce having a way of generating a unique identifier)
        - Contexts that are also sprites will need to use DOM element matching, with the current setup
      - DOM elements become refs in a tree that serves to determine hierarchy and visibility (see Relationship to the DOM)
    - metadata, for sprite modifiers
      - identifiers will be generated from metadata
    - for contexts, they still track whether they have completed the initial render or not. we could theoretically make it possible
      to match contexts that are conditionally rendered; the counterpart story is a bit tricky though.
    - each render, sprite/context insertions/removals are used to update the state of this long-lived object
  - sprites are generated from this long lived object, directly
    - when an animation is started, the long-lived object keeps track of it. this is so that it can be notified when an animation completes (cleanup reasons), and also for handling the next render (what should it get the ui state from, the actual element with the modifier attached, or is there an animating one?)
    - when a removed sprite is claimed by a context, the dom ref that it represents will move to directly under that context
      - related: unsure how to think about cloning of non-removed sprites. should they generate a dom ref of their own? i think we might need that
    - AnimationParticipants have a property that indicates whether they can be cleaned up. If a sprite doesn't have an animation attached in the render and the sprite is REMOVED (whether as a counterpart or just removed), the AnimationParticipant can be cleaned up.

- Relationship to the DOM
  - AnimationParticipants keep track of DOM elements that represent them in the UI; they can keep track of 2 at a time. One for a DOM element that exists in this render, another for a previous DOM element that no longer exists in this render but might need to be animated. 
  - DOM references are stored in their own tree
  - This tree is used to determine hierarchy and visibility of sprites (as SpriteTree has always done)
  - this tree is populated when a new item is inserted
  - items are removed when they leave the DOM AND their animations are done
    - since the AnimationParticipant keeps track of animations it can schedule these cleanups
  - tree is modified by animations - if a context claims a sprite and appends it as an orphan, the DOMRef moves to directly under the context. This is to prevent layer bugs from happening and to reduce the amount of "phantom" dom refs we keep around

- Simplified way of capturing ui state
  - each render, clear all captured ui state first
  - capture ui state for all animation participants before render
  - capture ui state for all animation participants after render

unresolved questions:
- how do we want to think about cloning?
- how do we deal with 2 or more "previous" elements
- cloning, nested? removed, nested?
- animated counterparts with an animation context?

ed: does the refactor support cloning well?

- demo: planet? black hole 2x, one bigger than another
