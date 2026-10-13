# Moving a Shared Selection Marker

A selection marker can make a tab change understandable without moving the entire interface. The Shared layout example renders the marker under the selected button and gives each possible instance the same layout identity. Your goal is to see one highlight move between choices, even though the template renders its next representation under a different button.

::card[../../demos/tabs]

**Live example: Moving a Shared Selection Marker.** Switch between distant tabs quickly. Follow the marker and compare Jelly tab with Magnetic tab; the selected label updates immediately while the marker catches up. [Open the demo](../../demos/tabs) to tune it with DialKit.

## Distinguish data identity from layout identity

The selected tab is ordinary tracked state. Changing it updates the button styling and conditionally renders the marker. The marker's shared layoutId tells the motion system that the new representation should continue from the previous representation's measured bounds.

A layoutId is not an HTML id and does not promise that one DOM node was physically reparented. It expresses a visual relationship between representations. This distinction matters when attaching focus, form state or application behaviour: those still belong to the actual elements and their component state.

## Scope the relationship

The example wraps its controls in LayoutGroup. Use a deliberate group boundary when the page contains independent widgets with similar markers. Otherwise a copied identity can accidentally pair elements that have nothing to do with one another. The scope should follow the widget whose selection is being explained.

The marker's transition is a named source variable. Jelly tab exaggerates settlement and Magnetic tab makes it concise. Switch between distant choices, then change direction before the marker arrives. Selection itself should update immediately; the animation explains the new state and should not postpone the user's choice until a spring finishes.

## Add panels as a separate concern

This small demo deliberately isolates the marker. It does not animate a content panel or demonstrate a tab keyboard controller. If you extend it into a production tab interface, add the appropriate tab roles, focus behaviour and arrow-key navigation along with the content relationships.

When panels must remain alive while leaving, use [Presence](core-presence.md). Preserve the outgoing panel's own data during exit instead of reading the newly selected tab's content. The marker's geometry and the panel's lifetime are different concerns, and keeping them separate makes both easier to reason about.

Compare [layout animation](core-layout.md) when the same node changes its own box, and [cross-region movement](interactive-regions.md) when an item is transferred between Choreo scenes.

---

[← Reordering a Wrapped Grid](core-reorder-grid.md) · [All guides](README.md) · [Revealing Data on Arrival →](core-reveal.md)
