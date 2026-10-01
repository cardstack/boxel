# Tethers and Connector Geometry

A connector is part of the explanation: it tells the reader which label, comment, or destination belongs to which subject. `c.Tether` derives an SVG path from two participants' current geometry so the relationship remains visible while the scene moves. The path belongs to the score instead of a separate requestAnimationFrame loop.

## Defining the Path

Select the endpoints with `@from` and `@to`. Supply a stable `@path` function that accepts their rectangles and returns SVG path data. The rectangles are expressed in the region's coordinate system, so the function can choose edges or centers without querying global screen positions.

```ts title="Component logic excerpt"
import type { Rect } from 'glimmer-motion';

const connect = (from: Rect, to: Rect) => {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  return `M ${x1} ${y1} C ${x1 + 24} ${y1}, ${x2 - 24} ${y2}, ${x2} ${y2}`;
};
```

```gts title="Component template excerpt"
<c.Tether @from={{c.id 'mark'}} @to={{c.id 'comment'}} @path={{connect}} />
```

This example connects the right edge of one box to the left edge of another. A different layout may need a different routing rule. Keep the relationship geometrically meaningful rather than using a fixed path that only lines up at one viewport size.

## Giving the Connector a Lifetime

A tether can have a duration and common timing arguments, or remain as standing work while its relationship exists. Place it beside the movement it explains when it should share that interval. Remove it through the same application state that removes the annotation, rather than independently deleting an SVG element the runtime owns.

The Wires demo demonstrates a comment attached to text while the layout changes. Inspect how source identities survive the change and how the connector is redrawn for both movement and a paused still. The connector should explain the current state, not trail behind the subject's previously painted frame.

## Reviewing Geometry and Performance

Test the first moving frame, the midpoint, and the tail under a scaled ancestor. A coordinate conversion that accidentally applies scale twice may look acceptable at the default zoom and fail badly inside a camera view. Also test endpoints of different sizes and a relationship that changes sides.

Like other derived geometry, a tether performs per-frame work on the main thread. Keep the path function small and deterministic. It should not mutate application state, launch an animation, or measure unrelated DOM. For a general follower that changes a participant's style rather than drawing a connector, use `c.Follow` and declare its resting values explicitly.

## API Coverage

**ChoreoContext**: `c.Tether`.

Read the implementation: [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
