/**
 * THE GOLDEN SCHEDULE. A film is its cue table and its camera path. These
 * recompute both reference films' schedules from their data and assert
 * them equal, to the digit, to the fixtures `scripts/film-fixtures.mjs`
 * wrote from the same code — so any refactor of the engine that changes
 * when a beat starts, what fires when, or where the lens is at a waypoint
 * fails here before anyone watches a frame.
 *
 * A phase that MEANS to change the film re-runs the script and reviews
 * the diff of the JSON; nothing else may.
 */
import { schedule } from '@cardstack/choreo/film';
import { module, test } from 'qunit';
import {
  BEATS as SAGRADA,
  CHAPTERS as SAGRADA_CHAPTERS,
} from 'test-app/lib/films/sagrada';
import {
  BEATS as TOWERS,
  CHAPTERS as TOWERS_CHAPTERS,
} from 'test-app/lib/films/towers';

import sagradaFixture from '../fixtures/film/sagrada.json';
import towersFixture from '../fixtures/film/towers.json';

module('Unit | film | schedule', function () {
  test('Sagrada Família: cue table, camera path and chapters are the fixture', function (assert) {
    const s = schedule(SAGRADA, SAGRADA_CHAPTERS, 'dip');
    assert.deepEqual(
      JSON.parse(JSON.stringify(s)),
      sagradaFixture,
      'the schedule equals tests/fixtures/film/sagrada.json'
    );
  });

  test('Towers: cue table, camera path and chapters are the fixture', function (assert) {
    const s = schedule(TOWERS, TOWERS_CHAPTERS, 'wipe');
    assert.deepEqual(
      JSON.parse(JSON.stringify(s)),
      towersFixture,
      'the schedule equals tests/fixtures/film/towers.json'
    );
  });

  test('the offset that keeps picture and type in step: a beat starts one tick after the table says', function (assert) {
    const s = schedule(SAGRADA, SAGRADA_CHAPTERS, 'dip');
    assert.strictEqual(s.beats[0]!.start, 0, 'cue 0 is exempt');
    for (const b of s.beats.slice(1)) {
      assert.strictEqual(
        b.start,
        b.secsBefore + b.lead * 2 + 2,
        `${b.id} starts at nominal + lead + TICK`
      );
    }
    const cues = s.cues.filter((c) => c.action === 'beat');
    assert.strictEqual(cues.length, s.beats.length, 'one beat cue per beat');
    cues.forEach((c, i) => {
      assert.strictEqual(
        c.delay,
        s.beats[i]!.start,
        `cue ${i} fires at its beat's start`
      );
    });
  });
});
