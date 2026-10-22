// Pretui — surfaces territory: deterministic layered graph layout.
//
// `graphLayout` is the auto-layout pass NodeCanvas never had. It is a
// plain module on purpose: it imports NOTHING — not the surfaces bundle,
// not Glimmer, not the DOM — so it can be unit-tested by local
// `boxel test` (which cannot load the surfaces bundle at all: the
// in-process test server's shim set has no `@ember/template-compilation`).
//
// ── Why this exists ──────────────────────────────────────────────────────
// xyflow / React Flow ship NO layout of any kind. Their own Layouting
// example (examples/react/src/examples/Layouting) reaches for `dagre`,
// which is a 33 KB dependency with a `Math.random()` in its ranker's
// tie-breaking — and `Math.random()` is FORBIDDEN in realm code, because
// the indexer requires a module to evaluate to the same thing twice. So
// the honest options were "vendor dagre and patch its RNG" or "write the
// pass". This is the pass: ~250 lines, no dependency, and deterministic by
// construction — every tie in every phase breaks on the caller's own input
// order, so the same graph always lays out to the same pixels.
//
// ── The algorithm (Sugiyama, four phases) ────────────────────────────────
//   1. CYCLE BREAK — iterative DFS in input order; an edge reaching a node
//      still on the stack is recorded as reversed and flipped for the rest
//      of the pass. Reported back so a caller can mark feedback edges.
//   2. LAYERING — longest path via Kahn topological order. A node sits one
//      layer after its latest predecessor. Isolated nodes land in layer 0,
//      which is what dagre does too.
//   3. ORDERING — alternating down/up barycenter sweeps. Ties break on the
//      node's current index, so a sweep can never shuffle a settled layer.
//      `crossingsBefore` / `crossingsAfter` are returned so the work is
//      measurable rather than asserted (and so a test can prove it helped).
//   4. COORDINATES — per layer, each node is pulled toward the MEDIAN of
//      its neighbours in the reference layer, then a single forward sweep
//      restores the minimum gap. The forward sweep alone is provably
//      order-preserving and overlap-free, so no phase can produce a stacked
//      pair. Layers are then centred against each other.
//
// ── What it fixes relative to dagre, itemised ────────────────────────────
//   • No RNG anywhere, so it is legal in a realm and reproducible in a
//     screenshot test. dagre's `Math.random()` means two runs of the same
//     graph can differ.
//   • Sizes are per node, not one global `{width,height}`. dagre's own
//     xyflow example hard-codes `150 × 50` for every node and therefore
//     mis-spaces any graph whose nodes are not all that size.
//   • It returns the LAYERS and the reversed-edge list, not just
//     coordinates — which is what an accessible text rendering of the graph
//     needs in order to say "stage 2 of 4" out loud.
//   • Positions come back as top-left corners, in the coordinate space the
//     canvas engine actually stores, so a caller never has to remember that
//     dagre reports centres and xyflow wants corners — the bug the upstream
//     example ships (it assigns `nodeWithPosition.x` straight to
//     `position.x`, so every node is offset by half its size).

/** Which way the graph flows. Also picks the handle sides. */
export type GraphDirection = 'right' | 'down' | 'left' | 'up';

/** Minimum a node must supply. Extra keys are ignored and preserved by the caller. */
export interface LayoutNode {
  id: string;
  /** measured or declared size; falls back to the options' defaults */
  width?: number;
  height?: number;
}

/** Minimum an edge must supply. */
export interface LayoutEdge {
  source: string;
  target: string;
}

export interface GraphLayoutOptions {
  /** flow direction (default `right`) */
  direction?: GraphDirection;
  /** width for a node that does not declare one (default 200, the NodeCard width) */
  nodeWidth?: number;
  /** height for a node that does not declare one (default 96) */
  nodeHeight?: number;
  /** space between layers, along the flow axis (default 110) */
  rankGap?: number;
  /** space between siblings, across the flow axis (default 28) */
  nodeGap?: number;
  /** top-left of the laid-out block (default 0, 0) */
  originX?: number;
  originY?: number;
  /** barycenter sweep pairs (default 8). More is slower, never worse: the
   * lowest-crossing ordering seen is the one kept. */
  passes?: number;
}

/** One node's placement. `x`/`y` are TOP-LEFT, as the canvas engine stores them. */
export interface LayoutPlacement {
  id: string;
  x: number;
  y: number;
  /** 0-based layer index, in flow order */
  layer: number;
  /** 0-based position within the layer, across the flow axis */
  order: number;
}

export interface GraphLayoutResult {
  placements: LayoutPlacement[];
  /** node ids per layer, in final cross-axis order */
  layers: string[][];
  /** indices into the input `edges` array that had to be reversed to break a cycle */
  reversed: number[];
  /** edge-crossing count before and after the ordering sweeps */
  crossingsBefore: number;
  crossingsAfter: number;
  /** bounding box of the result */
  width: number;
  height: number;
}

const DEFAULTS = {
  direction: 'right' as GraphDirection,
  nodeWidth: 200,
  nodeHeight: 96,
  rankGap: 110,
  nodeGap: 28,
  originX: 0,
  originY: 0,
  passes: 8,
};

/** `right`/`left` run along x; `down`/`up` run along y. */
function isHorizontal(direction: GraphDirection): boolean {
  return direction === 'right' || direction === 'left';
}

/** `left` and `up` are the same layering, drawn from the far end. */
function isReversedAxis(direction: GraphDirection): boolean {
  return direction === 'left' || direction === 'up';
}

/**
 * Handle sides that match a direction. NodeCanvas pins these onto every
 * node so the engine's edge geometry lands on the handles the node shell
 * actually draws — the mismatch that makes most React Flow graphs render
 * edges leaving the bottom of a node whose handle is on the right.
 */
export function handleSidesFor(direction: GraphDirection): {
  source: 'left' | 'right' | 'top' | 'bottom';
  target: 'left' | 'right' | 'top' | 'bottom';
} {
  switch (direction) {
    case 'left':
      return { source: 'left', target: 'right' };
    case 'down':
      return { source: 'bottom', target: 'top' };
    case 'up':
      return { source: 'top', target: 'bottom' };
    default:
      return { source: 'right', target: 'left' };
  }
}

/** Median of an already-sorted list; the mean of the middle pair when even. */
function medianOfSorted(values: number[]): number {
  let n = values.length;
  if (n === 0) {
    return Number.NaN;
  }
  let mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    return values[mid] as number;
  }
  return ((values[mid - 1] as number) + (values[mid] as number)) / 2;
}

/**
 * Count edge crossings between every adjacent pair of layers, given the
 * current within-layer ordering. Two edges (u1→v1) and (u2→v2) cross when
 * their endpoints are in opposite orders. O(E²) per layer pair, which is
 * nothing at realm scale, and it makes the ordering phase measurable.
 */
export function countCrossings(
  layers: string[][],
  edges: LayoutEdge[],
  positionOf: Map<string, { layer: number; order: number }>,
): number {
  let byLayer: { u: number; v: number }[][] = layers.map(() => []);
  for (let edge of edges) {
    let a = positionOf.get(edge.source);
    let b = positionOf.get(edge.target);
    if (!a || !b || b.layer !== a.layer + 1) {
      continue;
    }
    (byLayer[a.layer] as { u: number; v: number }[]).push({
      u: a.order,
      v: b.order,
    });
  }
  let total = 0;
  for (let pairs of byLayer) {
    for (let i = 0; i < pairs.length; i += 1) {
      for (let j = i + 1; j < pairs.length; j += 1) {
        let p = pairs[i] as { u: number; v: number };
        let q = pairs[j] as { u: number; v: number };
        if ((p.u - q.u) * (p.v - q.v) < 0) {
          total += 1;
        }
      }
    }
  }
  return total;
}

/**
 * Lay a directed graph out in layers. Pure, allocation-only, and free of
 * `Math.random()` / `Date.now()` — safe to call from a getter the indexer
 * may evaluate.
 *
 * Nodes whose id repeats are kept once (first wins). Edges naming an
 * unknown node, and self-loops, are ignored for geometry — they are still
 * the caller's to draw.
 */
export function graphLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: GraphLayoutOptions = {},
): GraphLayoutResult {
  let direction = options.direction ?? DEFAULTS.direction;
  let nodeWidth = options.nodeWidth ?? DEFAULTS.nodeWidth;
  let nodeHeight = options.nodeHeight ?? DEFAULTS.nodeHeight;
  let rankGap = options.rankGap ?? DEFAULTS.rankGap;
  let nodeGap = options.nodeGap ?? DEFAULTS.nodeGap;
  let originX = options.originX ?? DEFAULTS.originX;
  let originY = options.originY ?? DEFAULTS.originY;
  let passes = Math.max(0, options.passes ?? DEFAULTS.passes);

  // ── index, de-duplicated, in the caller's order ────────────────────────
  let ids: string[] = [];
  let indexOf = new Map<string, number>();
  let sizes: { w: number; h: number }[] = [];
  for (let node of nodes) {
    if (indexOf.has(node.id)) {
      continue;
    }
    indexOf.set(node.id, ids.length);
    ids.push(node.id);
    sizes.push({
      w: node.width && node.width > 0 ? node.width : nodeWidth,
      h: node.height && node.height > 0 ? node.height : nodeHeight,
    });
  }
  let n = ids.length;

  if (n === 0) {
    return {
      placements: [],
      layers: [],
      reversed: [],
      crossingsBefore: 0,
      crossingsAfter: 0,
      width: 0,
      height: 0,
    };
  }

  // Usable edges, as index pairs, keeping the caller's edge index so
  // reversals can be reported against the original array.
  let links: { from: number; to: number; at: number }[] = [];
  for (let at = 0; at < edges.length; at += 1) {
    let edge = edges[at] as LayoutEdge;
    let from = indexOf.get(edge.source);
    let to = indexOf.get(edge.target);
    if (from === undefined || to === undefined || from === to) {
      continue;
    }
    links.push({ from, to, at });
  }

  // ── 1. cycle break ─────────────────────────────────────────────────────
  // Iterative DFS (no recursion: a deep chain must not blow the stack in a
  // getter). WHITE 0 / GRAY 1 / BLACK 2; an edge into a GRAY node is a back
  // edge and gets flipped.
  let out: number[][] = ids.map(() => []);
  for (let link of links) {
    (out[link.from] as number[]).push(link.at);
  }
  let byIndex = new Map<number, { from: number; to: number }>();
  for (let link of links) {
    byIndex.set(link.at, { from: link.from, to: link.to });
  }

  let color = new Uint8Array(n);
  let reversed: number[] = [];
  let reversedSet = new Set<number>();
  for (let root = 0; root < n; root += 1) {
    if (color[root] !== 0) {
      continue;
    }
    let stack: { node: number; next: number }[] = [{ node: root, next: 0 }];
    color[root] = 1;
    while (stack.length > 0) {
      let frame = stack[stack.length - 1] as { node: number; next: number };
      let outgoing = out[frame.node] as number[];
      if (frame.next >= outgoing.length) {
        color[frame.node] = 2;
        stack.pop();
        continue;
      }
      let at = outgoing[frame.next] as number;
      frame.next += 1;
      if (reversedSet.has(at)) {
        continue;
      }
      let target = (byIndex.get(at) as { from: number; to: number }).to;
      if (color[target] === 1) {
        reversedSet.add(at);
        reversed.push(at);
        continue;
      }
      if (color[target] === 0) {
        color[target] = 1;
        stack.push({ node: target, next: 0 });
      }
    }
  }

  // The acyclic edge set the rest of the pass works on.
  let acyclic: { from: number; to: number }[] = links.map((link) =>
    reversedSet.has(link.at)
      ? { from: link.to, to: link.from }
      : { from: link.from, to: link.to },
  );

  // ── 2. layering (longest path, via Kahn) ───────────────────────────────
  let indegree = new Uint32Array(n);
  let succ: number[][] = ids.map(() => []);
  for (let link of acyclic) {
    (succ[link.from] as number[]).push(link.to);
    indegree[link.to] = (indegree[link.to] as number) + 1;
  }
  let layerOf = new Int32Array(n);
  let ready: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (indegree[i] === 0) {
      ready.push(i);
    }
  }
  let settled = 0;
  // FIFO with a head pointer: `ready` starts in input order and every push
  // appends, so the traversal order is fully determined by the input.
  for (let head = 0; head < ready.length; head += 1) {
    let node = ready[head] as number;
    settled += 1;
    for (let next of succ[node] as number[]) {
      let candidate = (layerOf[node] as number) + 1;
      if (candidate > (layerOf[next] as number)) {
        layerOf[next] = candidate;
      }
      indegree[next] = (indegree[next] as number) - 1;
      if (indegree[next] === 0) {
        ready.push(next);
      }
    }
  }
  // Defensive: cycle-breaking should make this unreachable, but a node left
  // unsettled would otherwise silently keep layer 0 and overlap.
  if (settled < n) {
    for (let i = 0; i < n; i += 1) {
      if (indegree[i] !== 0) {
        layerOf[i] = 0;
      }
    }
  }

  let layerCount = 1;
  for (let i = 0; i < n; i += 1) {
    layerCount = Math.max(layerCount, (layerOf[i] as number) + 1);
  }

  // ── 3. ordering (barycenter sweeps) ────────────────────────────────────
  let layers: number[][] = [];
  for (let l = 0; l < layerCount; l += 1) {
    layers.push([]);
  }
  for (let i = 0; i < n; i += 1) {
    (layers[layerOf[i] as number] as number[]).push(i);
  }

  let orderOf = new Int32Array(n);
  const reindex = () => {
    for (let layer of layers) {
      for (let k = 0; k < layer.length; k += 1) {
        orderOf[layer[k] as number] = k;
      }
    }
  };
  reindex();

  let incomingOf: number[][] = ids.map(() => []);
  let outgoingOf: number[][] = ids.map(() => []);
  for (let link of acyclic) {
    if ((layerOf[link.to] as number) === (layerOf[link.from] as number) + 1) {
      (incomingOf[link.to] as number[]).push(link.from);
      (outgoingOf[link.from] as number[]).push(link.to);
    }
  }

  const positionMap = () => {
    let map = new Map<string, { layer: number; order: number }>();
    for (let i = 0; i < n; i += 1) {
      map.set(ids[i] as string, {
        layer: layerOf[i] as number,
        order: orderOf[i] as number,
      });
    }
    return map;
  };
  let acyclicEdgePairs: LayoutEdge[] = acyclic.map((link) => ({
    source: ids[link.from] as string,
    target: ids[link.to] as string,
  }));
  let namedLayers = () => layers.map((layer) => layer.map((i) => ids[i] as string));
  let crossingsBefore = countCrossings(
    namedLayers(),
    acyclicEdgePairs,
    positionMap(),
  );

  const sweep = (neighbours: number[][], order: number[]) => {
    for (let l of order) {
      let layer = layers[l] as number[];
      let keyed = layer.map((node, k) => {
        let refs = (neighbours[node] as number[])
          .map((other) => orderOf[other] as number)
          .sort((a, b) => a - b);
        let bary = medianOfSorted(refs);
        return {
          node,
          k,
          bary: Number.isNaN(bary) ? k : bary,
        };
      });
      // Stable on the previous index: a node with no neighbours, or a tie,
      // never moves. That is what makes repeated runs identical.
      keyed.sort((a, b) => (a.bary === b.bary ? a.k - b.k : a.bary - b.bary));
      layers[l] = keyed.map((entry) => entry.node);
      reindex();
    }
  };

  let downOrder: number[] = [];
  for (let l = 1; l < layerCount; l += 1) {
    downOrder.push(l);
  }
  let upOrder: number[] = [];
  for (let l = layerCount - 2; l >= 0; l -= 1) {
    upOrder.push(l);
  }
  // A sweep can make things worse, so keep the lowest-crossing ordering seen
  // — the input order included — and restore it at the end. That is what
  // makes more passes never worse.
  let best = { crossings: crossingsBefore, layers: layers.map((layer) => [...layer]) };
  for (let pass = 0; pass < passes; pass += 1) {
    sweep(incomingOf, downOrder);
    sweep(outgoingOf, upOrder);
    let now = countCrossings(namedLayers(), acyclicEdgePairs, positionMap());
    if (now < best.crossings) {
      best = { crossings: now, layers: layers.map((layer) => [...layer]) };
    }
  }
  for (let l = 0; l < layers.length; l += 1) {
    layers[l] = [...(best.layers[l] as number[])];
  }
  reindex();

  let crossingsAfter = best.crossings;

  // ── 4. coordinates ─────────────────────────────────────────────────────
  // `cross` is the axis WITHIN a layer, `flow` is the axis BETWEEN layers.
  const crossExtent = (i: number) =>
    isHorizontal(direction)
      ? (sizes[i] as { w: number; h: number }).h
      : (sizes[i] as { w: number; h: number }).w;
  const flowExtent = (i: number) =>
    isHorizontal(direction)
      ? (sizes[i] as { w: number; h: number }).w
      : (sizes[i] as { w: number; h: number }).h;

  let crossCentre = new Float64Array(n);

  /**
   * Pack one layer, honouring `desired` centres where the gap allows. A
   * single forward sweep is provably valid: each node is placed at least
   * `gap` after its predecessor's trailing edge, so no pair can overlap and
   * the input order is preserved exactly.
   */
  const pack = (layer: number[], desired: number[]) => {
    let cursor = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < layer.length; k += 1) {
      let node = layer[k] as number;
      let half = crossExtent(node) / 2;
      let lowest = cursor === Number.NEGATIVE_INFINITY ? -Infinity : cursor + half;
      let want = desired[k] as number;
      let place = Number.isFinite(want) ? want : 0;
      if (lowest !== -Infinity && place < lowest) {
        place = lowest;
      }
      crossCentre[node] = place;
      cursor = place + half + nodeGap;
    }
  };

  // seed: stack every layer from zero, in order
  for (let layer of layers) {
    let seed: number[] = [];
    let cursor = 0;
    for (let k = 0; k < layer.length; k += 1) {
      let node = layer[k] as number;
      let half = crossExtent(node) / 2;
      cursor = k === 0 ? half : cursor + half;
      seed.push(cursor);
      cursor = cursor + half + nodeGap;
    }
    pack(layer, seed);
  }

  // refine: pull toward the median of the reference layer, repack, both ways
  const refine = (neighbours: number[][], order: number[]) => {
    for (let l of order) {
      let layer = layers[l] as number[];
      let desired = layer.map((node) => {
        let refs = (neighbours[node] as number[])
          .map((other) => crossCentre[other] as number)
          .sort((a, b) => a - b);
        let median = medianOfSorted(refs);
        return Number.isNaN(median) ? (crossCentre[node] as number) : median;
      });
      pack(layer, desired);
    }
  };
  for (let pass = 0; pass < Math.max(2, Math.ceil(passes / 2)); pass += 1) {
    refine(incomingOf, downOrder);
    refine(outgoingOf, upOrder);
  }

  // centre every layer against the widest one
  let spans = layers.map((layer) => {
    if (layer.length === 0) {
      return { lo: 0, hi: 0 };
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let node of layer) {
      let half = crossExtent(node) / 2;
      lo = Math.min(lo, (crossCentre[node] as number) - half);
      hi = Math.max(hi, (crossCentre[node] as number) + half);
    }
    return { lo, hi };
  });
  let widest = 0;
  for (let span of spans) {
    widest = Math.max(widest, span.hi - span.lo);
  }
  for (let l = 0; l < layers.length; l += 1) {
    let span = spans[l] as { lo: number; hi: number };
    let offset = (widest - (span.hi - span.lo)) / 2 - span.lo;
    for (let node of layers[l] as number[]) {
      crossCentre[node] = (crossCentre[node] as number) + offset;
    }
  }

  // flow axis: one band per layer, sized by its tallest/widest member
  let bandStart: number[] = [];
  let cursor = 0;
  for (let l = 0; l < layers.length; l += 1) {
    bandStart.push(cursor);
    let band = 0;
    for (let node of layers[l] as number[]) {
      band = Math.max(band, flowExtent(node));
    }
    cursor += band + rankGap;
  }
  let flowTotal = Math.max(0, cursor - rankGap);

  // ── map onto x / y ─────────────────────────────────────────────────────
  reindex();
  let placements: LayoutPlacement[] = [];
  for (let i = 0; i < n; i += 1) {
    let layer = layerOf[i] as number;
    let band = bandStart[layer] as number;
    let flowPos = isReversedAxis(direction)
      ? flowTotal - band - flowExtent(i)
      : band;
    let crossPos = (crossCentre[i] as number) - crossExtent(i) / 2;
    placements.push({
      id: ids[i] as string,
      x: isHorizontal(direction) ? originX + flowPos : originX + crossPos,
      y: isHorizontal(direction) ? originY + crossPos : originY + flowPos,
      layer,
      order: orderOf[i] as number,
    });
  }

  return {
    placements,
    layers: namedLayers(),
    reversed,
    crossingsBefore,
    crossingsAfter,
    width: isHorizontal(direction) ? flowTotal : widest,
    height: isHorizontal(direction) ? widest : flowTotal,
  };
}
