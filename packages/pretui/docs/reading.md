# The reading group

Design notes shared by **DataGrid**, **KeyValue**, **Stat**, **Prose**, **StreamingText**, **Table**.

reading territory: data display.
Translated from pretui-design-system (components/reading + css/structure.css).
Realm adaptation: StreamingText is timer-free — words reveal via CSS
animation-delay stagger (the prerenderer blocks timers; reduced-motion
snaps to the end state). The sr-only mirror carries the full text. Stat's
headline number is likewise timer-free: it delegates to Odometer
(reading-format), whose roll is one CSS animation keyed off the digit's
from>to pair.
