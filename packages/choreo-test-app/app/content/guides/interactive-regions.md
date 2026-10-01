# Nested Regions and Far Matching

A complex interface contains several motion systems: a shell, an editor, a list, perhaps a floating inspector. Nesting Choreo regions lets each system retain its own participants and timeline. A region is a scene boundary, not a global provider that should automatically collect every animation in the application.

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

## Verifying Independence

Test local changes in each region before testing the cross-region flight. The editor's ordinary update should not replay every shell animation. Then test interruption halfway through a transfer, movement of both containers, and a scaled outer frame. Check that the arriving item is the usable live representation and that the departing skin is released when its work ends.

Nesting does not automatically synchronize clocks. When a parent film needs to drive another region's time, use an explicit attachment or an explicitly owned player. Spatial hierarchy and temporal ownership are related design choices, but neither should be inferred from the other.
