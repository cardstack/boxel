# Attaching Another Region to a Clock

A film often combines independently authored regions: a camera score, lower thirds, an inset, or a demo interaction. `c.Attach` gives one run an explicit window over another region's run. The child keeps its own timeline vocabulary, while the parent supplies the time it should show.

## Mapping the Window

Name the child region with its Choreo identifier. The attachment's duration belongs to the parent timeline; `@in` and `@rate` map that interval onto the child's seconds. The mapping is source time equals in point plus elapsed parent-window time multiplied by rate.

```gts title="Component template excerpt"
<c.Attach @region='captions' @duration={{4}}
  @in={{0}} @rate={{1}} @end='hold' @exact={{true}} />
```

Position the attachment with the ordinary sequence, delay, or anchor controls. Before its window, the child stands at its head. After the window, hold retains the tail; remove leaves removal to the owner responsible for mounting the content. An end policy is a temporal instruction, not a generic DOM destruction command.

## Resolving Multiple Windows

Several windows can address one region, as successive film beats address a lower-third region. The run resolves a governing window for the region rather than allowing all windows to write its time independently. The active window takes precedence; an appropriate held past window or future head defines the surrounding state.

Keep region identifiers unique among simultaneously mounted instances. Two films using the same child region identifier can otherwise compete for the same registry entry. A host embedding several players should establish an explicit naming scheme and test teardown as one player leaves.

## Understanding Exactness

`@exact` rejects child runs whose supported runtime classification cannot be driven exactly, including spring or derived-follow work in the current attachment contract. Do not assume that a visually smooth child is therefore suitable for random access. Use clock-sampled tween work for an attached exact composition or provide a different controlled reconstruction boundary.

This is separate from the graph's `f.Attach`, which describes a media window in a film graph. The similarly named operations both map time, but they address different subjects: one drives a Choreo region and the other attaches media to a shot.

## Verifying Ownership

Seek before, within, and after the window, then repeat those requests in reverse order. Confirm the child is paused under parent control and does not resume its own clock unexpectedly. Replace the child region during the window and use the current region provider, not a captured obsolete run. A reliable composition can recreate its state from the controlling clock without relying on the order in which a viewer happened to reach it.

## API Coverage

**ChoreoContext**: `c.Attach`.

Read the implementation: [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
