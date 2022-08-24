# Goal
Get this demo working with the current API
[video] of demo

This presentation presents some of the things necessary for the demo to work, but more generally talks about what it takes to use the current API to build complex, meaningful transitions, and questions this brings up around the API we want.

# Key concepts in current API
- Sprite
  - id - unique, user-provided
  - role - user-provided
  - identifiers are needed for matching of sprites 
    - creating a kept sprite from removed and inserted sprites
    - managing orphans (DOM elements that are removed from Ember's control and we manipulate in our transitions - used for removed sprites and counterparts)
  - identifiers are also useful to filter for specific sprites when applying animations in the transition function (see Animation Context)
- Animation Context
  - can animate things each time there is a new render, receives changeset
  - user passes a transition function that applies animations to sprites in the changeset
- Changeset
  - per animation context per render
  - contains sprites that the animation context can control
- Animations Service
  - Whenever an Animation Context's content is re-rendered, this will perform measurements, create sprites based on the new DOM state, and distribute these sprites into changesets then pass the changesets to Animation Contexts

# Sprites, ids, and who controls what?
[diagram] of a sprite that is within two animation contexts

Demo is done with current constraints, not aiming to introduce new API just yet. 

There are some transitions that should be built in to a card - animations for the resizing of a card from minimized to expanded should not rely on the card being in an environment that supports viewing its children in a maximized form. This means we need one animation context for that, and another for the external environment that supports viewing a maximized card.

The only way that an outer context gains control of a sprite that is a descendant of the inner context is currently by "matching" removed and inserted sprites as a non-natural kept sprite.

## Major Assumption - IDs can be assigned for every instance of a card in the UI
Any card in the UI has an ID assigned, and if it is moved somewhere, that new instance has the same ID. 
This demo uses this characteristic of the data model to ensure that sprites can be matched and control provided to the "external" context.

# How animations are orchestrated <--Move to a known constraint slide-->
In large part, using Promises to ensure we run one set of animations first, then another.
  - This makes it hard to resume an animation reliably
Using Linear (as opposed to Spring) motions so that we can ensure duration reliably and match timing of different animations.
Sprites are grouped by card ID and separate transition functions are applied to groups.
Setting opacity + manually applying styles.
[WILL REMOVE, see ## Known constraint: Not able to reliably apply transitions based on state change (A -> B), only the final state (B)] - Card states are determined based on origin and destination DOM state.
The UI element that we think about/center our transitions on is a card, but we see a lot of sprites (grouping).

## Some terminology
- Kept sprites can be natural, or non-natural
  - Natural: element remains in DOM between 2 renders
  - Non-natural: original element from first render is removed from DOM in second render, however a new element whose sprite has the same id + role is introduced in the second render.
    - New sprite is kept sprite
    - Original sprite is **counterpart** of kept sprite
- Elements that are plucked out of the DOM as clones of now-removed HTML elements are called **orphans** 

## Note - the following step-by-step(s) assume that sprite groups are established

## Step by step for how the fade through animation is done (expanded -> max)
[video] of this happening, slow mo

Animating a group of sprites - main participants are the card and card content. The goal is to fade out the card content, then move the card to its final position while resizing it, then fade in the new card content

### Prep, pt 1 <-- split this into global prep and pt 1 prep
1. Create an orphan of the counterpart of the card
2. Put the counterpart card exactly where it was before the new render happened
3. Clip the counterpart to make it look like it's within its containing card
4. Ensure that the counterpart is visible and not blocked by other items (z-index/layer problems, especially since the counterpart is an orphan)
5. Hide the card from the current render because we don't want it showing while we animate the counterpart

### Animating, pt 1
6. Fade out the card content on the counterpart

### Prep, pt 2
7. Show the card proper
8. Hide the counterpart (remove the orphan)
9. Hide the card proper's content (opacity=0)

### Animating, pt 2
10. Move the card proper from its initial to final position while resizing

### Prep, pt 3
11. Set the card proper's content opacity to 1 (was at 0)

### Animating, pt 3
12. Fade the card proper's content in

## Step by step for how the fade through animation is done (max -> expanded)
### Prep, pt 1
1. Create an orphan of the placeholder
2. Put the placeholder exactly where it was in the previous render
3. Lower its z-index to make sure that we don't accidentally cover the card
4. Clip the placeholder vertically to make it look like it's within its containing card
5. Hide the card (opacity = 0)
6. Create an orphan of the card's counterpart
7. Put the orphan exactly where it was in the previous render

### Animation, pt 1
8. [Animation] Set up an animation for placeholders in case they need to move
9. [Animation] Fade out the content of the card's counterpart

### Prep, pt 2
10. Set the counterpart card's height and width to the initial height and width of the kept sprite. This is to work with a currently naive implementation for using scale for width and height transitions.
  - This seems more troubleesome, but we choose to use the counterpart here because of layer issues. We don't yet have a way to opt in to cloning of the kept sprite, and we want to make sure that the animated item appears above the card that it's entering.
11. Set the counterpart card's z index to make sure that it is above all other cards

### Animation, pt 2
12. [Animation] Move the counterpart while resizing it

### Prep, pt 3
13. Remove the counterpart orphan
14. Reintroduce the card proper by setting its opacity back to 1

### Animation, pt 3
15. [Animation] Animate the card proper's content's opacity from 0 to 1

## Step by step for how the gallery moving animation is done (expanded -> max)
### Prep, pt 1
1. Hide all the child cards of the maximized gallery card by setting their opacity to 0, because we want to fade them in later
2. Keep all images in place using transform, because we only want to move them after their parent card has resized and moved.

### Animation, pt 1
3. [Animation] Move the card proper over to the new position while resizing it

### Prep, pt 2
4. Remove the transform on the images

### Animation, pt 2
5. [Animation] Move images to their new positions

### Animation, pt 3
6. [Animation] Fade in child cards of the now-maximized gallery card

## Step by step for how the gallery moving animation is done (max -> expanded)
### Prep, pt 1
1. Create an orphan of the placeholder
2. Put it exactly where it was last render
3. Make sure it has a very small z-index so that it never covers a card
4. Clip it vertically to make it look like it's within the bounds of its containers
5. Create an orphan of the card's counterpart
6. Put it exactly where it was last render
7. Adjust the z-index to make sure it's above the placeholder

### Animation, pt 1
8. [Animation] Fade out the counterpart card's child cards

### Prep, pt 2
9. Create orphans of the images within the counterpart card
10. Change their z-index to make sure they are above the counterpart card

### Animation, pt 2
11. [Animation] Move images to their final positions (relative to counterpart card)

### Prep, pt 3
12. Adjust the counterpart card's height and width to its final height and width

### Animation, pt 3
13. [Animation] Animate the counterpart card's position and size to its final state
14. [Animation] Move the images together with the counterpart card (Necessary because they are orphans and detached from the counterpart card now)

### Cleanup
15. Show the card proper (remove opacity=0)
16. Remove the counterpart card

## Grouping/identifying sprites as related
This was central to development of the demo with this current API. It's possible to improve our metadata to reduce the hacks (or use DOM elements to carry this metadata via data attributes).

## Hack 1: magic numbers for timing
[video] of a placeholder staying in place while a maximized card shrinks down into expanded state on top of it
- Fixed timing provided for placeholders' transitions because they remain under the control of the inner context despite 
- There isn't a good way to "lift" placeholders out of an inner context - no corresponding sprite in a maximized sprite
- One of the key topics of context selection - How should contexts declare that they want to claim a sprite from an inner context, or a sprite decide it needs to break out?
- Smaller issue - orchestration of transitions is currently a bit awkward ([video] eg. the resizing and moving of cards while/before a maximized card changes to expanded) <-- This might be my code quality issue

## Hack 2: Clipping things & layers
- Basic clipping is necessary because of layers. Removed sprites and counterparts (clones) manipulated by a context currently need clip paths + z-index manipulated in order to look like they are in the right containers and on the right layers.
- No solution for dynamically clipping such sprites yet, but may be necessary
  - [video] of half-sliced placeholders
  - [image] of images "leaking" out of card boundaries

## Known constraint: Not able to reliably apply transitions based on state change (A -> B), only the final state (B)
- Current work breaks upon interruption because of this
  - also because of difficulty resuming transitions orchestrated using Promises
- This affects how people should author transitions
  - [excerpt] from discussion with Ed about how to achieve certain transitions while only knowing the final DOM state and DOM state on interruption
- Do we need to think about workarounds?
- Design input re: this constraint?
- [video] of the gallery animation breaking upon interruption
- Discussion w Ed about matching state changes to transitions:  https://discord.com/channels/584043165066199050/987010308214259752/1007650034948521994

## General problem related to interruptions
Resuming such animations needs to account for many different states, right now it's hard to resume from the middle of a Promise-orchestrated animation

## Path not taken
- Dynamically assigning roles to sprites to tell which ones should be animated
- Problems with assigning roles dynamically - not updated in time for render
- If we want to go down this route, we probably check how reliable it is in interruptions

# Low-level Hacks and Problems
Will spend some time looking at these and possibly developing more robust solutions:
- scale for resizing
  - scale correction (requires some magic numbers/reading of DOM state, may be complicated)
  - how much magic can we provide, and how do users opt in/out of scale vs width?
- merging transform keyframes from different motions (resizing + moving at the same time)
- merging transform keyframes from different motions (moving the same thing twice in the same transition with a delay in between?)
- [POSSIBLY TRICKY IMPLEMENTATION DETAIL] Differences between handling sprites and their counterparts (initial position and dimensions are different, so we need to distinguish this when using scale etc)
  - bikesheds can happen around implementation of animations when users have to pay attention to counterparts etc, since there are different implications when you use a counterpart vs the sprite itself re: layering, initial position + dimensions etc
- [NEEDS INVESTIGATION] improving performance of animating images on a kept sprite by using a counterpart?
  - potential for dropped frames if paint happens while we are trying to move things, eg. image loading while animating

# Next steps
## Clarify?
- Clearer design constraints (eg. duration) would help understand what needs to be done to get production-ready
- If the initial API is in place, what would stop us from using this in production?
## Actions?
## Hope to get to initial API by Oct/next full time
- What's needed before then?
