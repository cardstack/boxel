# Connecting Regions and Destinations

Some movements have a destination outside the item being animated. A message can fly to an archive button. A card can move from one panel to another. Choreo provides different tools for these two relationships.

## Naming a Destination

A **beacon** names a place on the page. Register it on the element whose bounds define the destination.

```gts title="An Archive Destination — Template Excerpt"
<button type="button" {{beacon 'archive'}}>Archive</button>

<Choreo as |c|>
  {{#each @messages key="id" as |message|}}
    <article {{motion id=message.id role='message'}}>
      {{message.subject}}
    </article>
  {{/each}}

  <c.Move
    @of={{c.removed 'message'}}
    @to={{c.beacon 'archive'}}
    @duration={{0.45}}
  />
</Choreo>
```

Import `beacon` and `Choreo` from `@cardstack/choreo`, and `motion` from `glimmer-motion`. This excerpt describes what happens when application code removes a message. The parent still owns the archive action and updates the messages array.

The button remains a button. It does not become another representation of the message, and it does not need to stretch into the message's shape. Use this pattern when a destination is a place rather than a shared identity.

## Giving a Region Its Own Timeline

A nested `Choreo` establishes a separate region. Its timeline selects its own participants, so a local interaction can run without the parent selecting those same elements again.

For movement between regions, keep the item's identity stable as application state transfers it. Choreo's far matching can connect a participant leaving one region with its counterpart arriving in another during the same render pass.

Update the source and destination state together. Splitting the removal and insertion across unrelated asynchronous updates prevents that pass from describing the complete transfer.

## Seeing the Difference

The [inbox demo](/inbox) demonstrates movement toward a destination. The [far match demo](/far) demonstrates an item changing regions. Compare their state changes before choosing a pattern.

Read the [nested Choreo reference](https://github.com/cardstack/choreo/blob/main/docs/nested-choreo.md) for selection boundaries and cross-region matching rules.

## Owning the Destination

A BeaconRef identifies measured geometry; it does not transfer ownership of the element that supplied it. The beacon modifier registers the destination for its lifetime and removes that registration on teardown. Test a destination in persistent chrome while the sending region is replaced, and test removing the destination before another command tries to use it. Use a clear name that describes the place, then inspect the changeset and beacon measurements before compensating for a wrong landing with arbitrary offsets.

## API Coverage

**@cardstack/choreo**: `beacon`, `BeaconRef`.

**ChoreoContext**: `c.beacon`.

Read the implementation: [`beacon.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/beacon.ts), [`beacons.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/beacons.ts), [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
