/**
 * The compiler is pure: a timeline tree and a changeset in, a cue list out.
 * These pin the placement math the constructs proposal specifies —
 * anchors (§4.2), repeat, keyframe values, stagger — without a render.
 */
import { after, at } from 'glimmer-motion';
import Changeset from 'glimmer-motion/choreo/changeset';
import compile from 'glimmer-motion/choreo/compile';
import type {
  ChoreoNode,
  Sprite,
  TimelineNode,
} from 'glimmer-motion/choreo/types';
import { module, test } from 'qunit';

function sprite(id: string): Sprite {
  const element = document.createElement('div');
  const node: ChoreoNode = {
    element,
    exitComplete() {},
    id,
    isPresent: true,
    layoutKey: id,
    release() {},
    role: null,
  };
  return { element, id, node, role: null, type: 'kept' };
}

function changeset(...ids: string[]): Changeset {
  return new Changeset([], [], ids.map(sprite));
}

const fade = (over: Partial<TimelineNode> = {}): TimelineNode =>
  ({
    kind: 'tween',
    ms: 500,
    of: { id: 'a' },
    props: { opacity: 0 },
    ...over,
  }) as TimelineNode;

module('Unit | choreo | compile', function () {
  test('an anchored step starts against the named one and is lifted from the flow', function (assert) {
    const cs = changeset('a', 'b', 'c');
    const cues = compile(
      [
        {
          children: [
            fade({ name: 'first' }),
            fade({ at: at('first', 0.4), ms: 100, of: { id: 'b' } }),
            fade({ ms: 200, of: { id: 'c' } }),
          ],
          kind: 'sequence',
        },
      ],
      cs,
    );
    const [first, anchored, next] = cues;
    assert.strictEqual(first!.start, 0);
    assert.strictEqual(anchored!.start, 200, 'at 40% of a 500ms step');
    assert.strictEqual(
      next!.start,
      500,
      'the anchored step did not push the sequence',
    );
  });

  test("after 'name' is the step's end plus seconds", function (assert) {
    const cs = changeset('a', 'b');
    const cues = compile(
      [
        {
          children: [
            fade({ name: 'first' }),
            fade({ at: after('first', 0.2), ms: 100, of: { id: 'b' } }),
          ],
          kind: 'sequence',
        },
      ],
      cs,
    );
    assert.strictEqual(cues[1]!.start, 700, '500ms end + 0.2s');
  });

  test('a named step records its start with its delay spent', function (assert) {
    const cs = changeset('a', 'b');
    const cues = compile(
      [
        {
          children: [
            fade({ delay: 100, name: 'first' }),
            fade({ at: at('first', 1), ms: 100, of: { id: 'b' } }),
          ],
          kind: 'sequence',
        },
      ],
      cs,
    );
    assert.strictEqual(cues[1]!.start, 600, 'at(name, 1) is the real end');
  });

  test('duplicate names and forward references fail, named', function (assert) {
    const cs = changeset('a', 'b');
    assert.throws(
      () =>
        compile(
          [fade({ name: 'x' }), fade({ name: 'x', of: { id: 'b' } })],
          cs,
        ),
      /two steps named 'x'/,
    );
    assert.throws(
      () => compile([fade({ at: at('later') })], cs),
      /anchors point up the score/,
    );
  });

  test('an anchored hold must carry its own duration', function (assert) {
    const cs = changeset('a', 'b');
    assert.throws(
      () =>
        compile(
          [
            {
              children: [
                fade({ name: 'x' }),
                {
                  at: at('x'),
                  kind: 'hold',
                  of: { id: 'b' },
                  props: { zIndex: 2 },
                } as TimelineNode,
              ],
              kind: 'sequence',
            },
          ],
          cs,
        ),
      /anchored hold/,
    );
  });

  test('repeat multiplies the schedule; Infinity occupies one cycle and marks the cue', function (assert) {
    const cs = changeset('a', 'b');
    const cues = compile(
      [
        {
          children: [
            fade({ repeat: 2 }),
            fade({ ms: 100, of: { id: 'b' } }),
          ],
          kind: 'sequence',
        },
      ],
      cs,
    );
    assert.strictEqual(cues[0]!.duration, 1500, 'three plays of 500ms');
    assert.strictEqual(cues[1]!.start, 1500);

    const looped = compile([fade({ repeat: Infinity })], cs);
    assert.true(looped[0]!.loop, 'an ambient loop is marked');
    assert.strictEqual(
      looped[0]!.duration,
      500,
      'and occupies one cycle of the schedule',
    );
  });

  test('a keyframe array is the from-and-to; springs take exactly two', function (assert) {
    const cs = changeset('a');
    const cues = compile([fade({ props: { opacity: [0, 1, 0] } })], cs);
    assert.deepEqual(cues[0]!.target!['opacity'], [0, 1, 0]);
    assert.throws(
      () =>
        compile(
          [
            {
              kind: 'spring',
              of: { id: 'a' },
              props: { opacity: [0, 1, 0] },
            } as TimelineNode,
          ],
          cs,
        ),
      /two keyframes/,
    );
  });

  test('stagger ladders the matched sprites and stretches the step', function (assert) {
    const cs = changeset('a', 'b', 'c');
    const cues = compile(
      [
        {
          children: [
            fade({ of: {}, stagger: 150 }),
            fade({ ms: 100, of: { id: 'a' } }),
          ],
          kind: 'sequence',
        },
      ],
      cs,
    );
    assert.deepEqual(
      cues.slice(0, 3).map((c) => c.start),
      [0, 150, 300],
    );
    assert.strictEqual(cues[3]!.start, 800, 'the ladder stretches the step');
  });
});
