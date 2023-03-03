# Design Ideas

## AnimationContext

AnimationContext controls all lifetime scoping for sprites and their ability to move.

- the only time a sprite can animate is when there's an animation context above it that is stable in the DOM that wants it to animate
- "counterparts" (meaning sprites that had a different element but logically match a new element) only aply within a single context, never across contexts
  - if you wanted a magic move type matching, you needed a higher context that can see both the start and finish places in the dom
- AnimationContext doesn't animate anything when it initially renders (that's not its job, it animates changes inside itself)
- if you want an entry animation, you needed a higher context
- this eliminates the complexity of `initialInsertion` and `finalRemoval` as they work today in ember-animated

- AnimationContext is currently treated as a kind of Sprite. This is probably convenient because it needs to be measured like one, but it's not important from a public API perspective. I don't think users should directly apply motions to them just because there's an inner Sprite tracking them.
  - However, I do think it should be legal to say <AnimationContext {{sprite }} > so that a parent animation context can affect our element.
- a design goal for AnimationContext is that it has a single element so that it has minimal impact on your CSS. That plus `...attributes` and https://github.com/tildeio/ember-element-helper means users have almost complete control over html markup.
- another important job for AnimationContext is that all motion within it is relative to the context as a container. Motion of the container itself is not its concern and shouldn't cause sprites inside to move around (at least not due to rules on this context, a higher context could decide to handle them)

## counterparts

- this replaces the concepts "sentSprites" and "receivedSprites"
- a keptSprite will sometimes have a counterpart sprite available
  - it _always_ has "before" and "after" position/style information
  - sometimes it has only its own element because that element moves in the transition
  - sometimes it also has a counterpart sprite because the counterpart was destroyed and a new element was created and they are a logical match
  - the counterpart is not also listed as a removedSprite. It's only listed as the counterpart of its corresponding keptSprite

## orchestration

- a sprite can be nested under zero or more AnimationContexts
- zero is legal because sometimes a reusable component has sprites in it that can animate when they happen to live in an animation context that cares about them
- when there's more than one, we need clear rules for deciding which context animates it
- I don't think more than one context should be able to handle/see the same sprite during the same transition
- it's possible that a simple rule like "lowest stable animation context always drives" could work
- it's possible that we need a more complicated system where there's a priority order and higher priority contexts can choose to handle, and if they don't handle then lower priority contexts get a chance until somebody handles or nobody does
- Some cases are pretty clearly _not_ the responsibility of a given context:
- if the context is being destroyed, it has no say over animations
- if the context is being initially rendered, it has no say over animations

## sprite API

- in the past we implicitly tried to do the right thing and sometimes guessed wrong and it was hard to understand
  - automatically switching between which of a sentSprite or receiveSprite would be hidden vs shown
  - whether a sprite moved into orphans was not something you could control, it happened just because of the surrounding context changing
  - we tried to adjust the starting position of each sprite to where you would "want" it to start, but this could be wrong
- instead we would like clear explicit API for each of these intentions
- for example, before you were expected to put a sprite into the place you wanted it to start moving from, and we tried to guess that for you as a good default that you could change. This is confusing, instead the motion itself should take a clear argument expression the intention to start at the sprite's (for example) initial position
- becoming an orphan should ideally also be something you can explicitly opt into
  - so you can escape things like opacity changes of your parent
