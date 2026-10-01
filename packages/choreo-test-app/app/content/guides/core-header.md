# Responding to Scroll Direction

A hiding header should make room for reading and return when the reader looks back. Responding to the sign of every scroll delta is not sufficient: small reversals, trackpad noise and overscroll recoil can make a header flicker. This example teaches a small state machine around a scroll value, with motion responsible only for the resulting visible state.

## Separate observation from presentation

The scroll subscription observes the local column. It tracks the previous position and accumulates travel in the current direction. When direction reverses, the accumulated distance starts over rather than requiring the reader to pay back the previous movement. Only sustained travel changes the hidden state.

The header target then derives from that state: visible or translated upward with lower opacity. The transition determines how that state change feels. Floating header and Instant response alter this presentation timing; they do not change the amount of directional travel required to trigger a change. That threshold remains a separate variable in the source.

## Handle boundaries deliberately

A scroll container can report positions outside its ordinary range during rubber-band overscroll. Clamp the observed position before calculating a direction. Otherwise the recoil back into range resembles an intentional movement in the opposite direction.

The top edge always shows the header. Near the bottom, the state holds instead of reacting to every small bounce. These edge policies are part of the interaction, not merely numerical cleanup. Test them on touch hardware as well as with a mouse wheel, because the input produces different boundary behaviour.

## Verify the reader's control

Scroll down far enough to hide the header, reverse slightly, then reverse decisively. A small reversal should not cause chatter, while sustained upward travel should restore the controls. Repeat near both ends of the column and after changing the transition preset.

Keep the document position stable when the header changes. If the header's removal also changes layout height, the resulting scroll delta can feed back into the state machine. The example translates the header visually instead of using its disappearance to resize the content.

For continuous layer movement, compare [scroll progress](/docs/core-scroll). For discrete row entrances, compare [revealing data](/docs/core-reveal). All three consume scroll-related information, but their state and timing responsibilities differ.
