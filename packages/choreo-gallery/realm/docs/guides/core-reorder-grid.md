# Reordering a Wrapped Grid

A reorderable grid asks the reader to follow one item while several neighbours change places. The Reorder grid example uses distinct covers and colours so the movement communicates which item was moved. Your goal is to keep the selected cover attached to the gesture while the collection's order becomes real application state.

::card[../../demos/grid]

**Live example: Reordering a Wrapped Grid.** Drag diagonally across a row boundary, reverse, and release. Compare Playful pickup and Precise pickup while following one cover's colour. [Open the demo](../../demos/grid) to tune it with DialKit.

## Let values carry identity

ReorderGroup receives the ordered values and reports a new order through its callback. Each ReorderItem represents one stable value. Keep the same identities when moving between rows. An array index describes a position, which is exactly the thing this interaction is changing; it is therefore the wrong identity for a cover with its own state.

A wrapped grid uses both axes. The example's xy mode lets a gesture cross a row boundary while neighbours project into their new positions. The final order should be understandable without the animation. Check the values your application stores rather than relying on the order in which elements happen to appear during a drag.

## Separate pickup from displacement

The grabbed cover has a whileDrag treatment. Rotation and scale make it readable as the active item, while the group transition moves the surrounding covers. Those are distinct design choices. A lively pickup does not require every neighbour to bounce dramatically, and a precise pickup can still use gentle settlement.

Compare Playful pickup with Precise pickup, then edit the rotation alone. Drag diagonally, stop near a row boundary, reverse direction, and release. The selected cover should retain its identity throughout. Try the same sequence after resizing the viewport, because wrapping is determined by actual layout rather than an assumed column count.

## Integrate with a real collection

If a cover contains a link, text field or menu, decide where dragging is allowed to start. A separate handle can preserve normal interaction with those controls. Read [drag handles](core-drag-handles) before making the entire cover a gesture surface.

Removal is a separate lifetime question. [Presence](core-presence) can retain a departing item, but the values passed to the group must still represent the application's intended order. Check rapid removal and reorder together before assuming they compose correctly. Also preserve a non-drag way to change order when the product needs keyboard operation.

---

[← Testing Geometry, Identity, and Cleanup](core-test-geometry) · [All guides](README) · [Moving a Shared Selection Marker →](core-shared-layout)
