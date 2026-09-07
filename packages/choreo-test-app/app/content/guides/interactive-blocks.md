# Sequences and Parallel Blocks

A timeline should express why one action follows another. `c.Sequence` and `c.Parallel` provide the two basic relationships: wait for preceding work, or let work share an interval. Nesting them creates an explicit structure that remains correct when a spring or fade duration changes.

## Composing an Interaction

In a sequence, each ordinary child contributes its duration before the next child begins. In a parallel block, children begin together unless their own delay or anchor says otherwise, and the longest child determines the block's span. A sequence can contain a parallel block, so a visual hold or elevation can last for the same interval as a movement.

```gts title="Component template excerpt"
<c.Sequence>
  <c.Tween @of={{c.removed 'detail'}} @opacity={{0}} @duration={{0.15}} />
  <c.Parallel @name='flight'>
    <c.Move @of={{c.moved 'card'}} @spring={{response}} />
    <c.Hold @of={{c.moved 'card'}} @zIndex={{2}} />
  </c.Parallel>
  <c.Tween @of={{c.inserted 'detail'}} @opacity={{array 0 1}} @duration={{0.2}} />
</c.Sequence>
```

The hold takes the block's span when it has no independent duration. This is more reliable than choosing a timeout that happens to match the spring today. The compiler resolves the movement's actual duration and the surrounding structure follows it.

## Naming a Block

Both blocks accept `@name`, `@at`, and `@delay`. An anchor can address the whole block, whose duration is derived from its contents. This lets a reusable composite expose a meaningful boundary such as an introduction or flight instead of forcing callers to know every inner step.

An anchored child is lifted out of its parent's sequential flow, but it remains part of the score. If it ends later than all the unanchored children, it still extends the run. Read the anchors guide before mixing block order and named overlap, because treating the last written child as the end of the run is an easy mistake.

## Keeping the Timeline Declarative

The block components produce `TimelineNode` data; they are not independent browser timers. Do not supplement them with `setTimeout` calls to release an overlay or start the next action. Those timers cannot adapt to a new spring duration, a paused run, or a seek.

Gates belong to an ordered sequence and cannot be placed under a parallel context. When two branches must finish before the next user-controlled build, put the parallel block before a gate in the enclosing sequence. Test the structure by changing the movement duration and by advancing while a segment is still moving. A sound composition preserves its ordering under both changes.

## API Coverage

**glimmer-motion**: `Block`.

**ChoreoContext**: `c.Parallel`, `c.Sequence`.

Read the implementation: [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo/types.ts), [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
