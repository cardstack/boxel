# Turning a Gesture into a Scored Throw

Shuffleboard depends on how fast the hand is moving when it releases the puck. A layout measurement can tell you where an element was, but it cannot supply that release velocity. The Hang example reads the gesture, resolves a legal result using the game's rules, and choreographs the movement to that result. Your goal is to separate gesture evidence, destination choice and visual travel.

## Read the release

The shooting area constrains where the puck can be dragged. Reaching a distant zone therefore requires a throw rather than carrying the puck directly to its final position. The gesture snapshot provides both the release location and velocity, which the application uses to predict travel.

The example disables automatic drag momentum. This is essential to ownership: Motion's free inertia must not continue driving the puck while Choreo also moves it toward a scored destination. One system chooses and owns the released movement. Another can observe that movement, but it should not issue competing targets to the same value.

## Resolve the game's meaning

A predicted resting position is translated into a legal outcome such as a zone or a knock. Read that application logic before copying the spring. The animation is an explanation of the resolved result, not the rule that determines whether a throw scored.

The opening velocity should agree with the gesture the person just made. If the destination calculation assumes one model and the visual travel starts with an unrelated response, the puck can appear to ignore the hand even though it reaches the intended location. Compare throws from a similar point at different speeds to expose that mismatch.

## Keep companions attached

Follow derives companion movement from the driven puck rather than guessing an independent path. This matters when another action interrupts the throw. A shadow or label needs to stay attached on unplanned frames as well as on the original trajectory.

Try Rubber hang and Decisive release while keeping the release gesture as similar as possible. These presets alter the transition response; the gesture still carries the evidence used to choose the outcome. Reset between comparisons when existing pucks would change the game's result.

Read [derived following](/docs/interactive-follow) for companion values, [anchors](/docs/interactive-anchors) for destinations, and [drag handles](/docs/core-drag-handles) when the gesture starts from a dedicated control.
