# Text Delivery and Stagger

A title can appear as one object or arrive through smaller units. Choreo's delivery controls let a property step express that choice without creating an independent timer for every character. The whole delivery remains one addressable step, so anchors and gates can refer to its complete span.

## Choosing a Unit

`@by` selects item, word, character, or paragraph delivery. Item is the ordinary participant-level behavior. The text modes subdivide text while preserving the underlying nodes needed by Glimmer's updates. Use a text mode only on a participant that actually contains the appropriate text content.

```gts title="Component template excerpt"
<c.Tween @of={{c.inserted 'heading'}} @by='word'
  @order='forward' @stagger={{0.05}}
  @opacity={{array 0 1}} @duration={{0.8}} />
```

`@order` supports forward, reverse, center, and random ordering. Pick the order to support reading. A center-out title may suit a short visual emphasis, while a long explanatory sentence is usually easier to follow in reading order. If a recording requires repeatable output, verify the behavior of any randomized ordering against the exact renderer you use rather than assuming a seed option exists at this template boundary.

## Allocating Time

`@stagger` is the offset between delivery slots. The total step still owns its declared span, and the slot windows account for the offsets. A very large stagger leaves less useful time for each unit's transition and can make the last units feel rushed. Start with the amount of time a reader needs for the complete thought, then distribute the delivery inside that interval.

The `DeliveryBy` and `DeliveryOrder` types describe the accepted vocabulary. Do not confuse this delivery model with the `stagger()` helper used for inherited Motion variants. Both distribute timing, but one operates over a Choreo query and the other participates in Motion's child transition configuration.

## Preserving Readability and Lifecycle

Text splitting is temporary presentation work owned by the region. Verify that changing the underlying tracked text still updates correctly and that leaving the scene cleans up the temporary structure. Avoid putting essential meaning exclusively in the order of animated characters; the final text and accessible reading order should remain coherent.

Inspect the build-order and presentation examples for timing relationships around titles. Test at normal speed, under reduced motion, and with a longer localized string. A fixed character count in an English sample is not a reliable estimate of the time or space another language needs. The timeline should remain understandable when the content changes, not just when the original demonstration is replayed.

## API Coverage

**glimmer-motion**: `DeliveryBy`, `DeliveryOrder`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts).
