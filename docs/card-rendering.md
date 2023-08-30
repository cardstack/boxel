# Card Rendering

To render a card, the primary step is to obtain a Glimmer component identified by the template tags within the card. A card may contain several Glimmer components, including fields and other miscellaneous components, that are categorized into three formats: isolated, embedded, and edit. These formats determine which component should be rendered. If there are no components available for the isolated or edit formats, the default format from the CardDef base class is used instead. The Glimmer components themselves are building blocks that can be used to create many other things.

## Format

- Isolated format renders a card as a root component.
- Embedded format is useful when a card is embedded within another card.
- Edit format is used when the user wants to update the value of the card.

## Field

A card object can serve as a field within another card object. To establish a card as a field for another card, you can use the @field decorator and specify one of the following field types: `contains`, `containsMany`, `linksTo`, or `linksToMany`. The main difference between a contained field and a linked field is that a linked field refers to another card instance in the realm, whereas a contained field creates a new card instance within the root component of the original card. In other words, a linked field has an identity to refer to, while a contained field doesn't. In edit mode, a contained field will provide inputs for updating its value, while a linked field will provide a modal to search for an existing card instance.

## Rendering process

1. Wrapping a card in Box class as a root component.
2. Getting a glimmer component based on format.
3. Getting fields from the Box class, including field's component.
4. Using fields and box class to instantiate the glimmer component.

## Re-rendering process

Our approach leverages the glimmer invalidation system to trigger card re-rendering. To achieve this, we rely on [TrackedWeakMap implementation](../packages/base/card-api.gts#L136-L138), where each card instance is used as a key. In order to track updates for a field in Glimmer, we entangle it by calling the `.get()` method on a map. When we need to signal to Glimmer that the field needs to be re-rendered, we use the `.set()` method on the same map.
