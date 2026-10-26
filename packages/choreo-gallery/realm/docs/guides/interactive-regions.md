# Nested Regions and Far Matching

A complex interface contains several motion systems: a shell, an editor, a list, perhaps a floating inspector. Nesting Choreo regions lets each system retain its own participants and timeline. A region is a scene boundary, not a global provider that should automatically collect every animation in the application.

::card[../../demos/far]

**Live example: Nested Regions and Far Matching.** Move a card across regions and watch the receiving scene preserve its identity. [Open the demo](../../demos/far) to tune it with DialKit.

## Discovering the Owner

A motion participant belongs to its nearest Choreo ancestor in the DOM. The parent region does not collect the child region's steps, and the child's participants do not silently become part of the parent's changeset. This keeps a local editor transition independent from a shell rearrangement.

```gts title="Component template excerpt"
<Choreo @id='workspace' as |shell|>
  <aside {{motion id='navigation' role='chrome'}}>Navigation</aside>
  <Choreo @id='editor' as |panel|>
    <article {{motion id='document' role='card'}}>Document</article>
    <panel.Move @of={{panel.moved 'card'}} />
  </Choreo>
  <shell.Move @of={{shell.moved 'chrome'}} />
</Choreo>
```

The region identifiers make host lookup and explicit attachment possible, while participant identifiers describe the subjects moving inside or between regions. Keep those namespaces meaningful; a region identifier is not the same thing as the identity of a card it contains.

## Transferring an Identity

Far matching connects a departing participant in one region with an arriving participant of the same identity in another region during the coordinated pass. The receiving region owns the arriving motion. This allows a card to move between panels while the panels retain independent timelines.

A beacon solves a different problem: it lends geometry without transferring identity. Use a beacon for a compose button, trash destination, or other named place. A row sent toward a trash button should not claim that it has become the button.

## Coordinating the Pass

Make the data change that transfers the item as one coherent application operation. If removal and insertion happen in unrelated later turns, the system may no longer see the same pairing opportunity. Read the far-match demo alongside its contract tests when implementing a multi-panel transfer, especially if an enclosing region also moves.

Some state that a pass changes is not markup. A scroll position is the usual example: a list that follows new content moves its scroll offset in the same pass as the content. `registerSettle(fn)` registers a function that runs after the pass's mounts and before any region measures, so that state lands first and every region measures the page as the reader will see it. An element that the scroll kept still then reads as not moved. Settlers run in registration order, and the call returns the function that removes the settler.

## Verifying Independence

Test local changes in each region before testing the cross-region flight. The editor's ordinary update should not replay every shell animation. Then test interruption halfway through a transfer, movement of both containers, and a scaled outer frame. Check that the arriving item is the usable live representation and that the departing skin is released when its work ends.

Nesting does not automatically synchronize clocks. When a parent film needs to drive another region's time, use an explicit attachment or an explicitly owned player. Spatial hierarchy and temporal ownership are related design choices, but neither should be inferred from the other.

---

[← Tethers and Connector Geometry](interactive-tethers) · [All guides](README) · [Live Scene Crossings →](interactive-crossings)
