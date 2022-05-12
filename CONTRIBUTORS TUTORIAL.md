I'd like these examples to be used with CodeTour. Probably not necessary to create tours for all, but these are examples that I could come up with.

1. Toggle example - Kept Sprite with no counterpart
	- What is the scenario?
		- basically just the toggle moving left to right in response to a state change
		- yes, doable via CSS, but for the purposes of demo sticking to a simple example.
	- What does the code look like? Minimal setup within a single component
	- Intro, so extra content
		- What happens when we first render (skip animation, see design.md)
		- What is a Sprite
		- What is a SpriteModifier
		- What is an AnimationContext
		- Brief introduction of the animations service and how it manages with and interacts with sprite modifiers and animation contexts
		- pull in some content from design.md + current Ember Animated docs
	- What happens when we click on the toggle (timeline)
		1. image of what the toggle looks like before the click 
		1. state change in Ember component as result of click event
		1. render will happen as a result of state change
		1. detection of render before it happens, by the `AnimationContext`
        1. image of what the toggle should look like after the click. state that it happens, and then we do measurements.  
				- we try to do all our measurements and preparation  within 1? frame because humans cannot perceive visual changes that are too fast, so if we move stuff back right after measuring quickly enough then start the animation, it looks just like a smooth animation without sudden flickering. 
		1.  measurements of `AnimationContext` and the toggle thumb sprite modifier's DOM elements
		1.  checking if something has changed in the new measured values vs previous values
		1. detecting that yes, something has changed in the toggle thumb sprite modifier's DOM element's position
		1. generating a changeset that contains the toggle thumb as a Kept Sprite 
		1. calling the user-provided transition function with the Changeset
		1. in the user-provided transition function, we call `setupAnimation` with `'position'` and `Linear Behavior`. This creates a motion that stores all the information required to generate keyframes for the web animations API
		1. then, still in the user-provided transition function, we call `runAnimations` to generate keyframes using the motion (hint here that we can support multiple motions and that's why compiling motions to keyframes is a separate step, will show in a separate example), and use the keyframes to start animating via the Web Animations API.
		1. When we get out of the user-provided transition function, we clean up any state that we do not want to carry to the next render
		1. We're done!
2. Toggle example - Kept Sprite with counterpart
3. Toggle example - Multiple motions (also animate color)
4. List item deletion - Removed Sprite
5. List item addition - Inserted Sprite
6. List item addition with special case - Filtering for a sprite with a specific role/id
7. Current ball demo - Interruption
	- Suggest deferring, because this is quite a fuzzy area with some bugs to fix still.
