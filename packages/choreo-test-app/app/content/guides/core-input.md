# Gestures and Scroll

Motion can respond directly to pointer, keyboard, and viewport activity. Start with the built-in gesture arguments before adding component state for an effect that only lasts while a gesture is active.

## Hovering and Pressing

A button can lift slightly on hover and compress when pressed.

```gts title="app/components/save-button.gts"
import { motion, to } from 'glimmer-motion';

<template>
  <button
    type='button'
    {{motion whileHover=(to scale=1.04) whileTap=(to scale=0.96)}}
  >
    Save changes
  </button>
</template>
```

These arguments describe temporary targets. When the gesture ends, the element returns to its resting target. Keep the element a real button so its action remains available from the keyboard. Add a visible focus style in your application CSS.

## Dragging an Element

Enable `drag` to let the pointer move an element. Pass `'x'` or `'y'` to limit the gesture to one axis.

```gts title="A Horizontal Drag Handle"
import { motion } from 'glimmer-motion';

<template>
  <div {{motion drag='x'}}>Drag me horizontally</div>
</template>
```

This is a movement example, not a complete accessible slider. If dragging changes application data, provide buttons or another keyboard interaction for the same action. For list ordering, the library also provides `ReorderGroup` and `ReorderItem`; see the [reorder list demo](/reorder).

## Responding to the Viewport

`whileInView` supplies a target while an element is visible. For effects tied continuously to scrolling, use the library's scroll APIs rather than writing a tracked property on every frame.

Motion values hold frequently changing values without making Glimmer rerender for each update. The [pointer follower](/pointer) and [scroll demo](/parallax) show this distinction in practice.

Keep essential information readable without animation. The next guide covers [reduced motion and testing](/docs/core-testing).

## Designing an Input Contract

Before tuning the response, decide what the gesture means. A hover may preview an action; a press may confirm that the control received input; a drag may select a different resting position. The action should remain available through an appropriate keyboard or discrete-control path. Test a canceled press, movement beyond a drag boundary, and a second gesture before the first spring settles. The dedicated dragging, drag-handle, reorder, and scroll guides describe the corresponding ownership and cleanup rules. They also explain why a transformed parent needs coordinate correction and why every pointer sample should not become a full component render.
