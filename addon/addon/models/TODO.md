1. Make contexts have a map of modifiers that have orphans (id: sprite). we can't do id: modifier because modifiers don't show up in changesets. We need to enforce uniqueness of identifiers for this to work
2. From the map, exclude removed sprite modifiers that have orphans that are being used from being removed from the sprite tree. We may need to define a "wait" for this to work properly in some cases.
3. Add these removed sprite modifiers into a new Set that we pass to SpriteSnapshotNodeBuilder, this set is handled the same way as freshlyRemoved (debugging purposes) 

Measure on an orphan?

- Orphan moving to a different context?


Assume sprite modifier internals are private API for now
SpriteModifierModel
