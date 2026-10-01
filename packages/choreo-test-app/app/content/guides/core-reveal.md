# Revealing Data on Arrival

A reveal should help the reader understand what has arrived. This example is a scrolling log of pours: each row has a label, a heat value and a bar. The animation draws attention to newly visible data while preserving a readable final result. Your goal is to distinguish a one-time arrival from a value continuously driven by scroll progress.

## Observe the right viewport

The log scrolls within its own container. Its viewport root therefore belongs to that container, not automatically to the browser window. A row can be visible in the page while still being clipped by its local scroller. Use the same boundary that determines what the reader can actually see.

The example combines whileInView, viewport.once and an entry callback. The target styles describe the row's arrival, while the callback begins the numeric readout. Once means the row does not replay every time a small reverse scroll carries it across the threshold. This is an intentional reading behaviour, not a performance switch to apply indiscriminately.

## Keep the data domain stable

The bar length is measured against a fixed heat ceiling. That makes lengths comparable across rows. If the denominator changed to the hottest currently visible item, an identical value could appear at a different length after scrolling, undermining the comparison the animation is meant to support.

The row's final text is the meaningful result. The count-up and bar fill are explanatory effects. Make sure the final value remains available when animation is reduced, when the row is already in view on initial render, and when the observer or component is destroyed during a transition.

## Tune related effects separately

Curtain call gives the arrival, fill and readout time to register; Flash reveal makes the response brisk. Edit the fill delay without changing the row's spring to notice their distinct roles. A delayed bar can create a readable sequence, but a long delay can leave a seemingly empty row on screen.

Scroll down and back up, including quick reversals at the container edge. Verify that once-only arrivals remain complete. For a transform that should continuously track scrolling, use [scroll progress](/docs/core-scroll) instead. A discrete entry event and a continuously sampled progress value have different lifecycle and reset requirements.
