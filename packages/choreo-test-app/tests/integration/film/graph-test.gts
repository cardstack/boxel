/**
 * THE GRAPH COMPILES TO THE TABLE.
 *
 * Both reference films exist twice on this branch: as the beat tables the
 * engine has always run (`lib/films/*.ts`) and as graphs written in the
 * film vocabulary (`components/films/*-score.gts`, generated from those
 * tables by `docs/film-graph/tograph.mjs`). These render each graph
 * inside a bare `<FilmGraph>` and assert that what it compiles to is the
 * table — every row, every key — and the same measured reads. That is
 * the whole of Phase 2's first claim, and it is what lets the films
 * switch from `@beats` to the graph without a frame changing.
 */
import { render, waitUntil } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { type CompiledGraph, FilmGraph } from 'glimmer-motion/film';
import { module, test } from 'qunit';
import { SagradaScore } from 'test-app/components/films/sagrada-score';
import { TowersScore } from 'test-app/components/films/towers-score';
import * as SAGRADA from 'test-app/lib/films/sagrada';
import * as TOWERS from 'test-app/lib/films/towers';

/** the same object with every undefined member gone, so a row compares to one that never had the key */
const plain = (o: unknown) => JSON.parse(JSON.stringify(o)) as unknown;

module('Integration | film | graph', function (hooks) {
  setupRenderingTest(hooks);

  test('Sagrada Família: the graph compiles to the table', async function (assert) {
    let compiled: CompiledGraph | null = null;
    const take = (c: CompiledGraph | null) => (compiled = c);
    await render(
      <template>
        <FilmGraph @onCompile={{take}} as |f|>
          <SagradaScore @f={{f}} />
        </FilmGraph>
      </template>
    );
    await waitUntil(() => compiled != null, { timeout: 4000 });
    const c = compiled!;
    assert.strictEqual(
      c.beats.length,
      SAGRADA.BEATS.length,
      `${c.beats.length} rows`
    );
    c.beats.forEach((b, i) => {
      assert.deepEqual(
        plain(b),
        plain(SAGRADA.BEATS[i]),
        `row ${i} (${b.id}) is the table's`
      );
    });
    assert.deepEqual(
      plain(c.chapters),
      plain(SAGRADA.CHAPTERS),
      "the chapters are the table's"
    );
    assert.deepEqual(
      c.voSecs,
      SAGRADA.VO_SECS,
      "the measured reads are the table's"
    );
    assert.strictEqual(c.defaultJoin, 'dip', "the spine's seam");
  });

  test('Towers: the graph compiles to the table', async function (assert) {
    let compiled: CompiledGraph | null = null;
    const take = (c: CompiledGraph | null) => (compiled = c);
    await render(
      <template>
        <FilmGraph @onCompile={{take}} as |f|>
          <TowersScore @f={{f}} />
        </FilmGraph>
      </template>
    );
    await waitUntil(() => compiled != null, { timeout: 4000 });
    const c = compiled!;
    assert.strictEqual(
      c.beats.length,
      TOWERS.BEATS.length,
      `${c.beats.length} rows`
    );
    c.beats.forEach((b, i) => {
      assert.deepEqual(
        plain(b),
        plain(TOWERS.BEATS[i]),
        `row ${i} (${b.id}) is the table's`
      );
    });
    assert.deepEqual(
      plain(c.chapters),
      plain(TOWERS.CHAPTERS),
      "the chapters are the table's"
    );
    assert.deepEqual(
      c.voSecs,
      TOWERS.VO_SECS,
      "the measured reads are the table's"
    );
    assert.strictEqual(c.defaultJoin, 'wipe', "the spine's seam");
  });
});
