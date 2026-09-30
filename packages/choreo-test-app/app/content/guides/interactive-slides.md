# Composing Slide Changes

A slide change can explain how a composition has been rearranged. The Slides example keeps a small cast of recognizable elements across several layouts. Your goal is to preserve that identity while letting text, dimensions and position change. This is useful for product explainers and presentations where the audience should follow an idea between arrangements rather than interpret every slide from scratch.

## Start with the cast

Give a recurring participant a stable identity and a role that describes its job in the score. A plate remains a plate even when its box changes. A line that exists on only one slide is an arrival or departure, not a shared participant. This distinction lets a single timeline select the elements that move and the elements that fade.

Read the example's template before changing its animation. The ordinary component state chooses the composition. Choreo observes the resulting render pass and measures the before and after bounds. The timeline then describes how the changes become visible. It should not also maintain a second description of where the elements belong.

## Keep the material readable

The plate has a gradient, so stretching a bitmap of it would change its appearance. The example uses real box movement and declares the radius to the motion system. Compare the corners and the gradient while changing slides; a smooth outer trajectory is not enough if the content inside it looks stretched.

Shared text needs similar care. Its identity explains continuity, but newly introduced copy should have its own entrance. Make the final static composition readable before tuning the spring. Motion should explain that layout, not repair an unclear one.

## Control the pacing

Use the two presets to compare an elastic treatment with a concise editorial treatment. Then edit only the type spring while leaving the plate response fixed. This separates the pacing of the message from the pacing of its container. Reverse direction before settlement: a presentation still has to behave when a speaker changes their mind.

For click-paced reveals within a composition, continue with [gates](/docs/interactive-gates). For changing live contents inside a travelling box, compare [crossings](/docs/interactive-crossings). These solve related problems at different boundaries; neither requires turning every slide into a screenshot.
