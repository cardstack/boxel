# Gallery tile capacity audit

All 45 catalog demos were audited against their expanded states. Tile sizes are CSS pixels; the focused canvas remains at native CSS scale. A short screen gets a scrollable viewport onto that canvas rather than reducing its height. The guide brings its next control into view before moving the cursor.

## Changes

| Demo                   | Before    | Allocated canvas | Reason                                                                             |
| ---------------------- | --------- | ---------------- | ---------------------------------------------------------------------------------- |
| In place / Inline edit | 480 × 300 | 480 × 520        | Fixed 340px layout row, expanded field lanes, and room around the transition.      |
| Inbox                  | 480 × 360 | 480 × 560        | Maximum six messages plus toolbar, row gaps, stage padding and clearance.          |
| Lightbox               | 480 × 360 | 480 × 520        | Allows the intended 268 × 335 hero without the old height constraint shrinking it. |
| Sequence               | 720 × 320 | 720 × 420        | Expanded hero and remaining thumbnail row require 360px plus stage padding.        |
| Wires                  | 720 × 360 | 720 × 560        | Longest draft and comments, including the stacked narrow layout.                   |

The four-column masonry packer uses the enlarged frames automatically. Browser checks verify that every frame remains above the floor and no pair in the same bay overlaps.

## All-demo allocation

“Expanded” reserves the largest bounded content state. “Scroll viewport” retains the demo's designed scrolling surface. “Camera viewport” contains a camera/device/slide scene whose world may extend outside its visible frame. “Bounded” has fixed or container-relative geometry.

| Demo         | Canvas    | State model     |
| ------------ | --------- | --------------- |
| playhead     | 480 × 480 | Bounded         |
| lightbox     | 480 × 520 | Expanded        |
| inbox        | 480 × 560 | Expanded        |
| inline-edit  | 480 × 520 | Expanded        |
| sequence     | 720 × 420 | Expanded        |
| interrupt    | 720 × 260 | Bounded         |
| slides       | 480 × 420 | Camera viewport |
| mockup       | 360 × 640 | Camera viewport |
| sylva        | 840 × 480 | Camera viewport |
| towers       | 840 × 480 | Camera viewport |
| camera       | 720 × 480 | Camera viewport |
| presentation | 840 × 540 | Camera viewport |
| wires        | 720 × 560 | Expanded        |
| escort       | 480 × 300 | Bounded         |
| grid         | 480 × 440 | Bounded         |
| tabs         | 720 × 180 | Bounded         |
| far          | 720 × 360 | Expanded        |
| crossing     | 720 × 420 | Camera viewport |
| subdivision  | 480 × 480 | Bounded         |
| drag         | 360 × 360 | Bounded         |
| rack         | 420 × 620 | Bounded         |
| sheet        | 360 × 560 | Bounded         |
| split        | 720 × 380 | Bounded         |
| reorder      | 420 × 480 | Bounded         |
| layout       | 420 × 600 | Bounded         |
| lists        | 480 × 420 | Expanded        |
| stagger      | 480 × 320 | Bounded         |
| trail        | 360 × 360 | Bounded         |
| jump         | 480 × 420 | Bounded         |
| keyframes    | 360 × 360 | Bounded         |
| long-take    | 840 × 540 | Camera viewport |
| sagrada      | 840 × 540 | Camera viewport |
| grip         | 720 × 440 | Scroll viewport |
| gestures     | 360 × 360 | Bounded         |
| presence     | 480 × 320 | Bounded         |
| parallax     | 480 × 560 | Scroll viewport |
| enter        | 480 × 300 | Bounded         |
| reveal       | 480 × 560 | Scroll viewport |
| drift        | 480 × 480 | Bounded         |
| hang         | 480 × 560 | Bounded         |
| header       | 480 × 500 | Scroll viewport |
| fold         | 480 × 520 | Bounded         |
| path         | 360 × 360 | Bounded         |
| pointer      | 360 × 360 | Bounded         |
| build-order  | 720 × 540 | Scroll viewport |

## Verification and measurement limits

- Source audit covers all 45 components, including all six names in one Lists column, all four Far pieces in one bay, the six-message Inbox limit, and Grip's single expanded form.
  The dimensions above were measured at native width and at 342px phone content
  width, including expanded content. Raw scroll extents include intentionally
  hidden flight layers and internal scroll regions, so they are diagnostics rather
  than automatic frame dimensions. Reinspect the actual expanded card bounds when
  changing a demo's content or controls.
