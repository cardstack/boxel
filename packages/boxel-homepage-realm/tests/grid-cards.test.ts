// Regression tests for the AnimatedGrid hero-grid layout logic
// (contents/boxel-ai-website/lib/grid-cards.ts) and for the caching
// contract of the gridCards getter in animated-grid.gts.
//
// Run with: pnpm test (node --test; Node >= 23 strips types natively)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildGridPool,
  buildGridSlots,
  makeSeededRandom,
} from '../contents/boxel-ai-website/lib/grid-cards.ts';

// The production dimensions: 25 cols x 15 rows, 28 noun sample cards.
const CELLS = 375;
const SAMPLES = 28;

test('pool fills every cell with a valid sample index', () => {
  const pool = buildGridPool(CELLS, SAMPLES, makeSeededRandom(42));
  assert.equal(pool.length, CELLS);
  for (const idx of pool) {
    assert.ok(Number.isInteger(idx) && idx >= 0 && idx < SAMPLES);
  }
});

test('pool is deterministic for a given seed', () => {
  const a = buildGridPool(CELLS, SAMPLES, makeSeededRandom(7));
  const b = buildGridPool(CELLS, SAMPLES, makeSeededRandom(7));
  assert.deepEqual(a, b);
});

test('different seeds produce different layouts', () => {
  const a = buildGridPool(CELLS, SAMPLES, makeSeededRandom(1));
  const b = buildGridPool(CELLS, SAMPLES, makeSeededRandom(2));
  assert.notDeepEqual(a, b);
});

test('every sample card appears in the grid', () => {
  const pool = buildGridPool(CELLS, SAMPLES, makeSeededRandom(42));
  assert.equal(new Set(pool).size, SAMPLES);
});

test('adjacent duplicates are broken up', () => {
  // Deterministic rng, so this can never flake; a sweep of seeds guards the
  // dedupe pass rather than one lucky shuffle.
  for (let seed = 0; seed < 50; seed++) {
    const pool = buildGridPool(CELLS, SAMPLES, makeSeededRandom(seed));
    let adjacent = 0;
    for (let i = 0; i < pool.length - 1; i++) {
      if (pool[i] === pool[i + 1]) adjacent++;
    }
    assert.ok(
      adjacent <= 2,
      `seed ${seed}: ${adjacent} adjacent duplicate pairs`,
    );
  }
});

test('slots cover all cells when every card resolves', () => {
  const cards = Array.from({ length: SAMPLES }, (_, i) => ({ id: i }));
  const slots = buildGridSlots(cards, CELLS, makeSeededRandom(42));
  assert.equal(slots.length, CELLS);
  for (const slot of slots) {
    assert.equal(slot.card, cards[slot.index]);
  }
});

test('cells for unresolved card links are dropped, not emitted as broken tiles', () => {
  // Simulate a linksToMany entry that failed to resolve (the bug that used
  // to emit `[]` as a grid entry, rendering a blank tile whose popup fell
  // back to sample 0).
  const cards: ({ id: number } | null)[] = Array.from(
    { length: SAMPLES },
    (_, i) => ({ id: i }),
  );
  cards[5] = null;

  const pool = buildGridPool(CELLS, SAMPLES, makeSeededRandom(42));
  const cellsForMissing = pool.filter((i) => i === 5).length;
  const slots = buildGridSlots(cards, CELLS, makeSeededRandom(42));

  assert.ok(cellsForMissing > 0, 'seed 42 should map some cells to sample 5');
  assert.equal(slots.length, CELLS - cellsForMissing);
  for (const slot of slots) {
    assert.notEqual(slot.index, 5);
    assert.ok(slot.card != null);
  }
});

test('no cards yields an empty grid (empty-state branch)', () => {
  assert.deepEqual(buildGridSlots([], CELLS, makeSeededRandom(42)), []);
});

test('gridCards getter in animated-grid.gts stays @cached', () => {
  // The isolated template reads gridCards twice ({{#if}} + {{#each}});
  // without @cached the 375-cell layout builds twice per render and every
  // read hands {{#each}} a new array identity. Guard the source contract
  // since the component itself cannot be instantiated outside the host.
  const source = readFileSync(
    fileURLToPath(
      new URL(
        '../contents/boxel-ai-website/animated-grid.gts',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  assert.match(
    source,
    /@cached\s+private get gridCards\(\)/,
    'gridCards must keep the @cached decorator',
  );
  assert.match(
    source,
    /buildGridSlots\(/,
    'gridCards must delegate to the tested lib/grid-cards module',
  );
});
