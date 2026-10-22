## What it is

**A deterministic layered layout for a directed graph.** Give it nodes and edges, and it returns a position for every node, in rows or columns that flow in one direction, with the edge crossings reduced. It is what turns a flow, a dependency graph or an org chart with no stored positions into a readable picture for **NodeCanvas**.

It is a function, not a component: `graphLayout(nodes, edges, options)` in `surfaces-canvas-layout.ts`. It draws nothing. Use it in a getter and hand the placements to NodeCanvas.

## The contract

```
graphLayout(nodes: LayoutNode[], edges: LayoutEdge[], options?: GraphLayoutOptions): GraphLayoutResult

options   direction ('right' | 'down' | 'left' | 'up'; default 'right')
          nodeWidth (200), nodeHeight (96), rankGap (110), nodeGap (28)
          originX, originY (0), passes (8)
result    placements, layers, reversed, crossingsBefore, crossingsAfter, width, height
```

**The stages.** It is the classic layered, Sugiyama-style layout:

1. **Break cycles.** A cycle is broken by reversing an edge, and `reversed` reports which ones, so the caller can draw them differently. Nothing hangs.
2. **Assign layers by longest path.** A node waits for its latest predecessor.
3. **Order each layer.** Barycenter sweeps, `passes` of them, reduce crossings. The lowest-crossing ordering seen, the input order included, is the one kept. So more passes are slower, never worse, and the result never has more crossings than the input.
4. **Place the nodes.** Each layer gets coordinates from each node's own width and height, with `rankGap` between layers and `nodeGap` between siblings.

**It is pure and deterministic.** There is no `Math.random()`, no `Date.now()` and no mutation of the input. The same graph gives byte-identical output, and ties are decided by input order. That makes it safe to call from a getter the indexer may evaluate.

**It is forgiving.** A repeated node id is kept once (the first wins). Self-loops and edges naming an unknown node are ignored for geometry. Isolated nodes are placed, not dropped. A deep chain does not overflow the stack, because the depth-first search is iterative.

`direction` rotates the whole layout without changing its topology. `handleSidesFor(direction)` gives the matching source and target handle sides, and `countCrossings` is exported for measuring.

## Prior art

**dagre** (and **@dagrejs/dagre**) is the layout React Flow's docs point to: the same Sugiyama stages, a mutable graph object, and `rankdir`, `ranksep` and `nodesep` options. **ELK** (elkjs) is far more capable (ports, compound nodes, orthogonal routing) and far heavier, and it runs in a worker. **d3-dag** offers several layering and ordering strategies.

Where Pretui is better: **no dependency and no mutable graph object.** It is one pure function that is safe in a realm getter. **Cycles are reported**, not silently reversed. **The output is reproducible byte for byte**, which dagre does not promise across versions.

Where it is thinner: **no compound or grouped nodes**, **no edge routing** (NodeCanvas draws the edges), **no ports**, and **no incremental layout**: moving one node lays out the whole graph again. Use ELK when you need those.

## Accessibility

Not applicable to the function itself: it computes positions and renders nothing. What it enables is the reading order. `layers` gives the nodes in flow order, layer by layer, which is the order to present them in for a non-visual reading of the graph, for example in NodeCanvas's outline mode. The visual layout and that reading order then agree.

## Theming

None. Spacing is set by `rankGap`, `nodeGap` and the node sizes, which are options, not tokens. The canvas that draws the result reads its own tokens.

## React ecosystem

| Agent types                             | Give them                                              |
| --------------------------------------- | ------------------------------------------------------ |
| `dagre.layout(g)` with `rankdir: 'LR'`  | `graphLayout(nodes, edges, { direction: 'right' })`    |
| dagre `ranksep` / `nodesep`             | `rankGap` / `nodeGap`                                  |
| React Flow `getLayoutedElements` recipe | `graphLayout`, then pass placements to **NodeCanvas**  |
| elkjs `layered` algorithm               | `graphLayout` for plain DAGs; ELK for ports and groups |
