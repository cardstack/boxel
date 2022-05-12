1. kept sprite - A sprite that was in the DOM in the previous render, and is not scheduled for removal in this render. Should have initial and final DOM state. may have a counterpart.
2. inserted sprite - A sprite that was not in the DOM in the previous render, and was inserted/is present in the DOM in this render. Should have final DOM state, but not initial.
3. removed sprite - A sprite that was in the DOM in the previous render, and is no longer in/is removed from the DOM this render. Should have initial DOM state, but not final.
4. intermediate sprite - Sprites created from sprite modifiers that were registered in the previous render. They are used to identify possible interruptions of sprite's animations, and to transfer animated state like position from one render to the next (how?). They are a separate category from kept sprites, inserted sprites, and removed sprites.
6. counterpart - when a kept sprite is created as a result of a different DOM element (eg via an if helper) being rendered with the same modifier id and role, the old element and its DOM state are used as the counterpart.
7. sprite modifier - an Ember modifier that registers a `SpriteModifier` when the DOM element it is attached to is rendered, and unregisters the `SpriteModifier` when the DOM element it is attached to is removed from the DOM. The `SpriteModifier` has information about: 
	- the modifier's DOM element
	- the current state (eg the bounds) of the DOM element
	- the id and role that a sprite created from it will take on
8. sprite - an object that stores DOM state (whether initial, final, or both, depending on the type) so that it can be animated. Can be kept, inserted, removed, or intermediate.
9. a sprite's role - a way of identifying a sprite. does not have to be unique
10. a sprite's id - a unique way of identifying a sprite. 
11. a sprite's identifier - unique combination of id and role of a sprite
12. orphan - a DOM element that should be removed in this render, but is kept around for purposes of animation
13. orphans element - a special element in the animation context that is used to hold orphans. it is currently implemented as an absolutely positioned element at the top of the relatively positioned animation context. 
14. animation context - an Ember component that acts as a container to sprites. it is used as a reference point for animations of position for its child sprites. the user can use this to supply the transition function that determines how child sprites should be animated.
15. animations service - the service that runs transitions, and keeps track of changes in animation contexts and sprites
16. sprite tree - stores sprite modifiers and animation contexts in a tree structure. one use of this is to identify children of an animation context when animating.
17. transition - the process of calculating all changes in sprites' states, starting animations in a coordinated way, and then cleaning up the state
18. changeset - an object that holds removed, inserted, and kept sprites for an animation context for a given render.
20. (animated) value - stores a previous value, current value and velocity. currently only supports numeric values, not composite values like color
21. sprite animation - plays animations. checked finished to see if an animation is completed.
22. interrupted animations - when a new render happens before an animation is completed, the animation is said to be interrupted.
23. render - when Ember updates the state of the DOM for a given context. animation contexts detect when renders affect their state/state of DOM within them and run animations.
24. initial bounds - element's position + size in the previous render
25. final bounds - element's position + size in the current render
26. behavior - a way to apply easing to animations
27. motion - objects that create animation keyframes by interpolating between specified initial and final DOM state + some other customization parameters (what?).
28. keyframes - web animation API keyframes.
