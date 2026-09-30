# Drag Handles and Coordinate Correction

A card that contains editable text should not become draggable whenever the user tries to select that text. Separating the handle from the movable element preserves ordinary interaction inside the card. It also gives you one place to apply pointer-coordinate correction when the card lives inside a transformed surface.

## Starting From a Handle

Create controls with `createDragControls()` and pass them to the draggable element. Disable its automatic drag listener, then start the controls from the handle's pointer event. The controls do not change your application data; they connect a chosen input surface to the element's existing drag behavior.

```gts title="Component template excerpt"
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { motion, createDragControls } from 'glimmer-motion';

export class MovableCard extends Component {
  controls = createDragControls();
  start = (event: PointerEvent) => this.controls.start(event);

  <template>
    <article {{motion drag=true dragListener=false dragControls=this.controls}}>
      <button type='button' {{on 'pointerdown' this.start}}>Move card</button>
      <input aria-label='Card title' />
    </article>
  </template>
}
```

The handle needs a deliberate touch policy, and the application still needs an accessible way to perform the equivalent movement. Naming a button “Move card” does not by itself provide a keyboard reordering implementation. The Table Plan demo is useful evidence because the movable item remains a real form.

## Matching the Visible Coordinate System

Pointer events report coordinates in screen or page space, while the dragged object's movement may be expressed inside a scaled or transformed parent. `correctParentTransform(elementOrRef)` provides the transform function for that parent relationship. `transformViewBoxPoint(svgOrRef)` handles an SVG surface whose viewBox maps drawing units onto a different displayed size.

Pass the function as `transformPagePoint` on the modifier, or establish it for a subtree with `MotionConfig`. Keep the supplied element or reference current when the host changes. A stale reference can make an otherwise correct conversion produce a discontinuity after a layout or route change.

Test the same gesture under the transforms the real product uses. A fixture at scale one cannot expose a doubled delta at scale two. Check the first pointer-down frame, continued motion, release velocity, and hit targets after the parent moves. If two subsystems both apply correction, the result can be just as wrong as applying none; the boundary should convert the event once into the space the drag system expects.

## API Coverage

**glimmer-motion**: `createDragControls`, `DragControls`, `correctParentTransform`, `transformViewBoxPoint`.

Read the implementation: [`drag-controls.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/gestures/drag-controls.ts), [`transform-page-point.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/gestures/transform-page-point.ts).
