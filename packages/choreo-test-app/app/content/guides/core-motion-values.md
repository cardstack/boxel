# Motion Values and Derived Values

Continuous input can change many times between meaningful application state changes. A pointer position, a scroll offset, or a spring's current value does not usually need to cause a component render for every sample. MotionValues provide a direct connection between that changing value and the renderer.

## Binding a Value

Import `motionValue` and `transformValue` from `glimmer-motion`. They are the engine's own functions, re-exported rather than reimplemented, so the library uses the existing engine's value model and one frame loop. The same curated set carries `styleEffect`, which binds values to an element's style outside the modifier; `frame`, which schedules read, update, and render work on that loop; and `animate`, which drives a value or an element imperatively. Pass values through the `style` argument of the motion modifier so the engine subscribes to them and writes the corresponding style.

```gts title="Component template excerpt"
import { motion, motionValue, styles } from 'glimmer-motion';

// In a component instance, so each instance owns its position:
// x = motionValue(0);

<template>
  <div {{motion style=(styles x=this.x)}}>Drag position</div>
</template>
```

Updating `this.x.set(nextX)` changes the bound position without requiring a tracked field to invalidate the whole component. Read a value with `get()` when an event needs its current number. Use a derived MotionValue when another continuous property depends on it. The derived value should express the mapping, not duplicate a manually synchronized second state variable.

## Connecting Continuous and Discrete State

Application state still belongs in tracked fields. For example, the position of a sheet can be continuous while its selected resting stop is discrete. Update the selected stop when the interaction reaches a meaningful decision, rather than assigning the same tracked value unconditionally on every drag sample. Glimmer invalidates on an assignment even when a callback appears to be reporting the same logical state.

That distinction prevents feedback loops between measurement, drag callbacks, renders, and projection updates. A loop can consume the browser's rendering budget even when every individual callback looks reasonable. The library's layout loop guard diagnoses this condition; it is not a substitute for a clear state boundary.

## Owning Subscriptions

When you subscribe directly to a MotionValue or start an imperative animation with `animate`, keep the returned cleanup or playback controls. Stop work when the component is destroyed, and unsubscribe listeners that belong to that component. A value stored at module scope is shared by every instance, which is appropriate for a deliberate shared signal but usually wrong for an individual draggable card.

Inspect the pointer, parallax, and sheet demos to see this separation in real interactions. Their controls remain real DOM, while continuous visual updates go through Motion. In a film, decide separately whether the value follows live input or a declared external clock; a recording cannot reconstruct an unspecified history of user input.
