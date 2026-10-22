// Pretui — proof for the layered graph layout. Run with `boxel test`;
// deployment leaves `*.test.gts` off the realm.
//
// These are unit tests over a pure function, which is exactly why
// `graphLayout` lives in its own module: local `boxel test` cannot load the
// surfaces bundle (no `@ember/template-compilation` in the in-process test
// server's shim set), so NodeCanvas and NodeCard are
// unreachable here. The layout pass is the part of the node graph most
// worth proving and the part that needs no engine.
import { module, test } from 'qunit';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import {
  countCrossings,
  graphLayout,
  handleSidesFor,
} from './surfaces-canvas-layout';
import type { LayoutEdge, LayoutNode } from './surfaces-canvas-layout';

function n(...ids: string[]): LayoutNode[] {
  return ids.map((id) => ({ id }));
}

function e(...pairs: string[]): LayoutEdge[] {
  return pairs.map((pair) => {
    let [source, target] = pair.split('>');
    return { source: source as string, target: target as string };
  });
}

function layerOf(
  result: ReturnType<typeof graphLayout>,
  id: string,
): number | undefined {
  return result.placements.find((p) => p.id === id)?.layer;
}

module('Pretui | surfaces | graphLayout', function (hooks) {
  setupCardTest(hooks);

  test('an empty graph lays out to nothing rather than throwing', function (assert) {
    let result = graphLayout([], []);
    assert.deepEqual(result.placements, [], 'no placements');
    assert.deepEqual(result.layers, [], 'no layers');
    assert.strictEqual(result.width, 0, 'no width');
    assert.strictEqual(result.height, 0, 'no height');
  });

  test('a chain lands one node per layer, in order', function (assert) {
    let result = graphLayout(n('a', 'b', 'c', 'd'), e('a>b', 'b>c', 'c>d'));
    assert.strictEqual(layerOf(result, 'a'), 0, 'a is the source');
    assert.strictEqual(layerOf(result, 'b'), 1, 'b follows a');
    assert.strictEqual(layerOf(result, 'c'), 2, 'c follows b');
    assert.strictEqual(layerOf(result, 'd'), 3, 'd is the sink');
    assert.strictEqual(result.layers.length, 4, 'four layers');
  });

  test('longest path wins: a node waits for its LATEST predecessor', function (assert) {
    // a→b→c and a→c. `c` must sit at layer 2, not layer 1, or the a→c edge
    // would run backwards through b's layer.
    let result = graphLayout(n('a', 'b', 'c'), e('a>b', 'b>c', 'a>c'));
    assert.strictEqual(layerOf(result, 'c'), 2, 'c waits for b');
  });

  test('a cycle is broken rather than hanging, and the reversal is reported', function (assert) {
    let edges = e('a>b', 'b>c', 'c>a');
    let result = graphLayout(n('a', 'b', 'c'), edges);
    assert.strictEqual(result.reversed.length, 1, 'exactly one edge reversed');
    assert.strictEqual(
      result.reversed[0],
      2,
      'the back edge c→a is the one reported, by its index in the input',
    );
    assert.strictEqual(result.placements.length, 3, 'every node still placed');
  });

  test('a self-loop is ignored for geometry and never reported as a cycle', function (assert) {
    let result = graphLayout(n('a', 'b'), e('a>a', 'a>b'));
    assert.deepEqual(result.reversed, [], 'no reversal needed');
    assert.strictEqual(layerOf(result, 'b'), 1, 'the real edge still ranks b');
  });

  test('an edge naming an unknown node is ignored, not fatal', function (assert) {
    let result = graphLayout(n('a', 'b'), e('a>b', 'a>ghost', 'ghost>b'));
    assert.strictEqual(result.placements.length, 2, 'two nodes placed');
    assert.strictEqual(layerOf(result, 'b'), 1, 'b still ranks after a');
  });

  test('isolated nodes are placed, not dropped', function (assert) {
    let result = graphLayout(n('a', 'b', 'lonely'), e('a>b'));
    assert.strictEqual(result.placements.length, 3, 'all three placed');
    assert.strictEqual(layerOf(result, 'lonely'), 0, 'isolated sits in layer 0');
  });

  test('a duplicate id is kept once, first wins', function (assert) {
    let result = graphLayout(
      [{ id: 'a' }, { id: 'a' }, { id: 'b' }],
      e('a>b'),
    );
    assert.strictEqual(result.placements.length, 2, 'the duplicate is dropped');
  });

  test('nothing in a layer overlaps', function (assert) {
    // one source fanning out to six siblings: the whole point of the
    // packing pass is that these six never stack.
    let result = graphLayout(
      n('s', 'a', 'b', 'c', 'd', 'f', 'g'),
      e('s>a', 's>b', 's>c', 's>d', 's>f', 's>g'),
      { direction: 'right', nodeHeight: 100, nodeGap: 20 },
    );
    let fanned = result.placements
      .filter((p) => p.layer === 1)
      .sort((p, q) => p.y - q.y);
    assert.strictEqual(fanned.length, 6, 'all six in one layer');
    for (let i = 1; i < fanned.length; i += 1) {
      let previous = fanned[i - 1] as { y: number };
      let current = fanned[i] as { y: number };
      assert.ok(
        current.y >= previous.y + 100 + 20 - 0.001,
        `sibling ${i} clears the one before it (${previous.y} → ${current.y})`,
      );
    }
  });

  test('layer bands are separated by rankGap along the flow axis', function (assert) {
    let result = graphLayout(n('a', 'b'), e('a>b'), {
      direction: 'right',
      nodeWidth: 150,
      rankGap: 90,
    });
    let a = result.placements.find((p) => p.id === 'a') as { x: number };
    let b = result.placements.find((p) => p.id === 'b') as { x: number };
    assert.strictEqual(b.x - a.x, 240, '150 wide plus a 90 gap');
  });

  test('the same graph twice gives byte-identical output — no RNG anywhere', function (assert) {
    // dagre, the layout xyflow reaches for, calls Math.random() in its
    // ranker. That is illegal in realm code AND it means two runs of the
    // same graph can differ. This is the assertion that rules it out.
    let nodes = n('a', 'b', 'c', 'd', 'f', 'g', 'h');
    let edges = e('a>c', 'b>c', 'a>d', 'b>f', 'c>g', 'd>g', 'f>h', 'g>h');
    let first = graphLayout(nodes, edges);
    let second = graphLayout(nodes, edges);
    assert.deepEqual(
      second.placements,
      first.placements,
      'identical placements',
    );
    assert.deepEqual(second.layers, first.layers, 'identical ordering');
  });

  test('input order, not identity, decides ties — a re-ordered array still lays out the same shape', function (assert) {
    let edges = e('a>c', 'b>c');
    let first = graphLayout(n('a', 'b', 'c'), edges);
    let second = graphLayout(n('a', 'b', 'c'), edges);
    assert.deepEqual(
      first.layers,
      second.layers,
      'a fresh array of the same ids gives the same layers',
    );
  });

  test('the ordering sweeps actually reduce crossings', function (assert) {
    // Deliberately crossed: the input order puts every edge in the worst
    // position, so a layout that did no ordering work would score the same
    // before and after. This is the test that would catch the sweeps being
    // silently a no-op.
    let nodes = n('a1', 'a2', 'a3', 'b1', 'b2', 'b3');
    let edges = e('a1>b3', 'a2>b2', 'a3>b1', 'a1>b2', 'a3>b2');
    let result = graphLayout(nodes, edges);
    assert.ok(
      result.crossingsAfter <= result.crossingsBefore,
      `crossings never increase (${result.crossingsBefore} → ${result.crossingsAfter})`,
    );
  });

  test('countCrossings counts a real crossing and ignores a parallel pair', function (assert) {
    let layers = [
      ['a1', 'a2'],
      ['b1', 'b2'],
    ];
    let positions = new Map([
      ['a1', { layer: 0, order: 0 }],
      ['a2', { layer: 0, order: 1 }],
      ['b1', { layer: 1, order: 0 }],
      ['b2', { layer: 1, order: 1 }],
    ]);
    assert.strictEqual(
      countCrossings(layers, e('a1>b1', 'a2>b2'), positions),
      0,
      'parallel edges do not cross',
    );
    assert.strictEqual(
      countCrossings(layers, e('a1>b2', 'a2>b1'), positions),
      1,
      'swapped endpoints cross exactly once',
    );
  });

  test('direction rotates the graph without changing its topology', function (assert) {
    let nodes = n('a', 'b');
    let edges = e('a>b');
    let right = graphLayout(nodes, edges, { direction: 'right' });
    let down = graphLayout(nodes, edges, { direction: 'down' });
    let rightA = right.placements.find((p) => p.id === 'a') as {
      x: number;
      y: number;
    };
    let rightB = right.placements.find((p) => p.id === 'b') as {
      x: number;
      y: number;
    };
    let downA = down.placements.find((p) => p.id === 'a') as {
      x: number;
      y: number;
    };
    let downB = down.placements.find((p) => p.id === 'b') as {
      x: number;
      y: number;
    };
    assert.ok(rightB.x > rightA.x, 'right flows along x');
    assert.strictEqual(rightA.y, rightB.y, 'right does not move along y');
    assert.ok(downB.y > downA.y, 'down flows along y');
    assert.strictEqual(downA.x, downB.x, 'down does not move along x');
    assert.strictEqual(layerOf(right, 'b'), layerOf(down, 'b'), 'same layers');
  });

  test('left and up run the same layering from the far end', function (assert) {
    let result = graphLayout(n('a', 'b', 'c'), e('a>b', 'b>c'), {
      direction: 'left',
    });
    let a = result.placements.find((p) => p.id === 'a') as { x: number };
    let c = result.placements.find((p) => p.id === 'c') as { x: number };
    assert.strictEqual(layerOf(result, 'c'), 2, 'c is still the last layer');
    assert.ok(c.x < a.x, 'but it is drawn to the LEFT of a');
  });

  test('per-node sizes are honoured, not one global size', function (assert) {
    // The xyflow dagre example hard-codes 150x50 for every node, which
    // mis-spaces any graph whose nodes differ. These two differ.
    let result = graphLayout(
      [
        { id: 'tall', width: 100, height: 300 },
        { id: 'short', width: 100, height: 40 },
        { id: 's' },
      ],
      e('s>tall', 's>short'),
      { direction: 'right', nodeGap: 10, nodeHeight: 40 },
    );
    let tall = result.placements.find((p) => p.id === 'tall') as { y: number };
    let short = result.placements.find((p) => p.id === 'short') as { y: number };
    let gap = Math.abs(short.y - tall.y);
    assert.ok(
      gap >= 170,
      `the 300-tall node is given its own room (${gap} apart)`,
    );
  });

  test('origin moves the whole block', function (assert) {
    let plain = graphLayout(n('a', 'b'), e('a>b'));
    let moved = graphLayout(n('a', 'b'), e('a>b'), {
      originX: 500,
      originY: 250,
    });
    let plainA = plain.placements[0] as { x: number; y: number };
    let movedA = moved.placements[0] as { x: number; y: number };
    assert.strictEqual(movedA.x - plainA.x, 500, 'shifted along x');
    assert.strictEqual(movedA.y - plainA.y, 250, 'shifted along y');
  });

  test('a deep chain does not blow the stack — the DFS is iterative', function (assert) {
    let ids: string[] = [];
    for (let i = 0; i < 5000; i += 1) {
      ids.push(`n${i}`);
    }
    let edges: LayoutEdge[] = [];
    for (let i = 1; i < ids.length; i += 1) {
      edges.push({ source: ids[i - 1] as string, target: ids[i] as string });
    }
    let result = graphLayout(n(...ids), edges, { passes: 0 });
    assert.strictEqual(result.layers.length, 5000, 'five thousand layers');
  });

  test('handleSidesFor pairs the handles with the direction', function (assert) {
    assert.deepEqual(handleSidesFor('right'), { source: 'right', target: 'left' });
    assert.deepEqual(handleSidesFor('left'), { source: 'left', target: 'right' });
    assert.deepEqual(handleSidesFor('down'), { source: 'bottom', target: 'top' });
    assert.deepEqual(handleSidesFor('up'), { source: 'top', target: 'bottom' });
  });

  test('more passes are never worse, and the result never has more crossings than the input order', function (assert) {
    // a small LCG, so the graphs are the same on every run
    let seed = 7;
    let rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let worse = 0;
    let aboveInput = 0;
    for (let g = 0; g < 300; g += 1) {
      let nodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}` }));
      let edges = [];
      for (let i = 0; i < 10; i += 1) {
        for (let j = i + 1; j < 10; j += 1) {
          if (rand() < 0.25) {
            edges.push({ source: `n${i}`, target: `n${j}` });
          }
        }
      }
      let previous = Infinity;
      for (let passes = 0; passes <= 6; passes += 1) {
        let r = graphLayout(nodes, edges, { passes });
        if (r.crossingsAfter > previous) {
          worse += 1;
        }
        if (r.crossingsAfter > r.crossingsBefore) {
          aboveInput += 1;
        }
        previous = r.crossingsAfter;
      }
    }
    assert.strictEqual(worse, 0, 'no graph got more crossings as passes grew');
    assert.strictEqual(aboveInput, 0, 'and none ended above its input order');
  });
});
