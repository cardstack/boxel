# Animating an Element

An animation begins with a target. When that target changes, `motion` moves the element from its current appearance to the new one. Your component continues to own the state that decides what the target should be.

## Tune the Live Example

The Keyframes example above exposes variables from its own code. `rotation` changes the rotation keyframes in degrees, `peakScale` changes the largest scale multiplier, and `lift` changes the upward travel in pixels. The Transition editor supplies the duration in seconds and the easing curve used by both the shape and its glow. These values change the example itself; they do not alter this page’s navigation speed.

The relevant target construction looks like this:

```ts title="Keyframes demo: target variables"
const rotation = tuneNumber('keyframes', 360, 'rotation (deg)', 0, 720, 1);
const peakScale = tuneNumber('keyframes', 1.14, 'peakScale (×)', 0.5, 2, 0.01);
const lift = tuneNumber('keyframes', 28, 'lift (px)', 0, 80, 1);
return {
  rotate: [0, rotation / 4, (rotation * 7) / 12, rotation],
  scale: [1, 0.82, peakScale, 1],
  y: [0, -lift, 10, 0],
};
```

`tuneNumber` is the gallery’s DialKit adapter, not a public `glimmer-motion` export. It reads a named input while preserving the default written in the example. Your application can supply the same variables through ordinary component state. The modifier only needs the resulting targets.

## Responding to State

Let's build a button that moves a marker. Clicking it changes a tracked property; the modifier handles the movement.

```gts title="app/components/moving-marker.gts"
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion, spring, to } from 'glimmer-motion';

const movement = spring({ visualDuration: 0.45, bounce: 0.15 });

export class MovingMarker extends Component {
  @tracked moved = false;

  get position() {
    return this.moved ? 120 : 0;
  }

  toggle = () => {
    this.moved = !this.moved;
  };

  <template>
    <button type='button' {{on 'click' this.toggle}}>Move marker</button>
    <span {{motion animate=(to x=this.position) transition=movement}}>
      ●
    </span>
  </template>
}
```

`position` is derived from `moved`. You don't need another tracked property for the animation, or a callback to mark it complete. Clicking again while the marker is moving changes its destination.

## Choosing a Transition

Use a spring when the movement should respond naturally to a changing target. `visualDuration` sets the main travel time in seconds; `bounce` adjusts the overshoot. Use a tween when you need a fixed duration and easing curve.

```gts title="Transition Helpers"
import { spring, tween } from 'glimmer-motion';

const responsive = spring({ visualDuration: 0.4, bounce: 0.1 });
const measured = tween({ duration: 0.3, ease: 'easeInOut' });
```

Keep reusable transitions at module scope so the intent stays consistent across elements.

## Letting Motion Own Its Styles

Set transform properties such as `x`, `y`, `scale`, and `rotate` through the modifier. For styles that Motion needs to animate or correct, use its `style` argument too.

```gts title="Styles on a Motion Element"
import { motion, styles } from 'glimmer-motion';

<template>
  <div {{motion layout=true style=(styles borderRadius='14px')}}>
    A card whose corners stay round as its layout changes.
  </div>
</template>
```

A bound HTML `style` attribute can overwrite the transform that Motion is updating. Keep ordinary typography in CSS and motion-owned values in the modifier.

Try the [keyframes demo](/keyframes), then explore [input and gestures](/docs/core-input).

## Separating the Responsibilities

The element remains an ordinary HTML or SVG element. Glimmer decides which content is present, CSS decides its resting layout, and Motion applies the animated values. Keep continuous input in MotionValues when it does not require a template update. When one property needs a different transition from another, use perValue rather than splitting one visual subject into unrelated animation loops. The following guides examine targets and style ownership, springs, tweens and keyframes, variants, and continuous values individually. Start with the target that represents the application state, then choose the response that makes the change understandable.

Keep SVG drawing properties on the same modifier so the engine can observe their targets and lifecycle too.

## API Coverage

**glimmer-motion**: `MotionProps`, `motion`.

Read the implementation: [`motion.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/motion.ts).
