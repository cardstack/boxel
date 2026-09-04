/**
 * The clip resolver is pure: a shot list, the beats' start times and a
 * film time in, the clip on screen out. These pin the compositor's
 * arithmetic as the film construct uses it — the window, the source time,
 * the three end policies, and a clip that outlives its beat.
 */
import type { FilmBeat } from 'glimmer-motion';
import type { ClipSpec } from 'glimmer-motion/film';
import { clipWindow, resolveClip, resolveClips } from 'glimmer-motion/film';
import { module, test } from 'qunit';

const cam = { dolly: 1, lookY: 0, pitch: 10, yaw: 30 };

function beat(id: string, ticks: number, clip?: ClipSpec): FilmBeat {
  return {
    cam,
    ch: 0,
    clips: clip ? [clip] : undefined,
    id,
    mode: 'lower',
    ticks,
  };
}

/* three beats of 4, 6 and 4 seconds; the second carries the clip */
const starts = [0, 4, 10];
const start = (i: number) => starts[i]!;
const TOTAL = 14;

module('Unit | film | clips', function () {
  test('a video clip is a source-time window over the film clock', function (assert) {
    const beats = [
      beat('a', 2),
      beat('b', 3, { at: 1, in: 10, kind: 'video', out: 13, src: 'x.mp4' }),
      beat('c', 2),
    ];
    assert.strictEqual(
      resolveClip(beats, start, 4.5, 1, TOTAL),
      null,
      'not yet'
    );
    const mid = resolveClip(beats, start, 6, 1, TOTAL)!;
    assert.strictEqual(mid.state, 'active');
    assert.strictEqual(mid.source, 11, 'in + (film − start) × rate');
    assert.strictEqual(mid.since, 1);
    assert.strictEqual(
      resolveClip(beats, start, 8.5, 1, TOTAL),
      null,
      'removed past its window (the default end)'
    );
  });

  test('rate scales the window and the source', function (assert) {
    const spec = { in: 2, kind: 'video' as const, out: 6, rate: 2 };
    assert.strictEqual(clipWindow(spec, 4, 10), 2, '(out − in) / rate');
    const beats = [beat('a', 2), beat('b', 3, spec), beat('c', 2)];
    const at = resolveClip(beats, start, 5, 1, TOTAL)!;
    assert.strictEqual(at.source, 4, 'two source seconds per film second');
  });

  test('hold keeps the last sample; freeze keeps the frame and writes nothing', function (assert) {
    const held = [
      beat('a', 2),
      beat('b', 3, { end: 'hold', for: 2, in: 1, kind: 'video', out: 3 }),
      beat('c', 2),
    ];
    const h = resolveClip(held, start, 9, 1, TOTAL)!;
    assert.strictEqual(h.state, 'held');
    assert.strictEqual(h.source, 3, 'standing at the out point');
    const frozen = [
      beat('a', 2),
      beat('b', 3, { end: 'freeze', for: 2, kind: 'freeze' }),
      beat('c', 2),
    ];
    const f = resolveClip(frozen, start, 9, 1, TOTAL)!;
    assert.strictEqual(f.state, 'frozen');
    assert.strictEqual(f.source, null);
  });

  test('a clip without a length runs to the end of its beat', function (assert) {
    const beats = [
      beat('a', 2),
      beat('b', 3, { at: 2, kind: 'image', src: 'p.jpg' }),
      beat('c', 2),
    ];
    assert.strictEqual(
      clipWindow(beats[1]!.clips![0]!, 4, 10),
      4,
      'the rest of the beat'
    );
    assert.strictEqual(
      resolveClip(beats, start, 9.9, 1, TOTAL)!.state,
      'active'
    );
    assert.strictEqual(resolveClip(beats, start, 10.1, 2, TOTAL), null);
  });

  test('a clip may outlive its beat: the window is on the film clock', function (assert) {
    const beats = [
      beat('a', 2),
      beat('b', 3, { at: 4, for: 5, kind: 'image', src: 'p.jpg' }),
      beat('c', 2),
    ];
    /* the third beat is in force at 11, and the second beat's clip is still up */
    const over = resolveClip(beats, start, 11, 2, TOTAL)!;
    assert.strictEqual(over.index, 1);
    assert.strictEqual(over.state, 'active');
    assert.strictEqual(over.since, 3);
  });

  test('the newest clip wins, and a removed one hides nothing behind it', function (assert) {
    const beats = [
      beat('a', 2, { end: 'hold', for: 1, kind: 'image', src: 'old.jpg' }),
      beat('b', 3, { for: 1, kind: 'image', src: 'new.jpg' }),
      beat('c', 2),
    ];
    assert.strictEqual(
      resolveClip(beats, start, 4.5, 1, TOTAL)!.spec.src,
      'new.jpg'
    );
    assert.strictEqual(
      resolveClip(beats, start, 6, 1, TOTAL),
      null,
      'the newer clip is removed; the held older one is not reached'
    );
  });
});

module('Unit | film | clips on lanes', function () {
  const start = (i: number) => [0, 4, 10][i]!;

  test('a beat carries as many clips as it declares', function (assert) {
    /* two clips on one beat: the second used to overwrite the first */
    const both: FilmBeat = {
      cam,
      ch: 0,
      clips: [
        { for: 3, kind: 'video', src: 'a.mp4' },
        { for: 3, kind: 'image', src: 'b.png' },
      ],
      id: 'both',
      mode: 'lower',
      ticks: 3,
    };
    const list = [beat('one', 2), both, beat('three', 2)];
    const on = resolveClips(list, start, 5, 1, 14);
    assert.strictEqual(on.length, 2, 'both are on screen');
    assert.deepEqual(
      on.map((c) => c.spec.src),
      ['a.mp4', 'b.png'],
      'in the order they were declared, which is paint order'
    );
    assert.deepEqual(
      on.map((c) => c.state),
      ['active', 'active'],
      'and both are running'
    );
  });

  test('a lane is what a later clip replaces; other lanes are left alone', function (assert) {
    const first: FilmBeat = {
      cam,
      ch: 0,
      clips: [
        /* a short window with an end policy: past it, this lane HOLDS */
        { end: 'hold', for: 3, kind: 'image', src: 'under.png' },
        { for: 2, kind: 'image', lane: 1, src: 'over.png' },
      ],
      id: 'first',
      mode: 'lower',
      ticks: 2,
    };
    /* a clip on lane 1 replaces the one that was there; lane 0 holds */
    const later: FilmBeat = {
      cam,
      ch: 0,
      clips: [{ for: 4, kind: 'image', lane: 1, src: 'next.png' }],
      id: 'later',
      mode: 'lower',
      ticks: 3,
    };
    const list = [first, later, beat('end', 2)];
    const on = resolveClips(list, start, 5, 1, 14);
    assert.deepEqual(
      on.map((c) => c.spec.src),
      ['under.png', 'next.png'],
      'lane 0 is still held, lane 1 has moved on'
    );
    assert.strictEqual(on[0]!.state, 'held', 'the one underneath is held');
    assert.strictEqual(on[1]!.state, 'active', 'the one over it is live');
  });

  test('an emptied lane leaves the others on screen', function (assert) {
    const b: FilmBeat = {
      cam,
      ch: 0,
      clips: [
        { end: 'hold', for: 20, kind: 'image', src: 'under.png' },
        { for: 1, kind: 'image', src: 'brief.png' },
      ],
      id: 'b',
      mode: 'lower',
      ticks: 4,
    };
    const list = [beat('a', 1), b, beat('c', 2)];
    const on = resolveClips(list, start, 8, 1, 14);
    assert.deepEqual(
      on.map((c) => c.spec.src),
      ['under.png'],
      'the brief one is gone and the held one is not'
    );
  });
});
