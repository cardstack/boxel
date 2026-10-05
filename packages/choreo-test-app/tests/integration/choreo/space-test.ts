/**
 * The coordinate contract (docs/planes-and-cameras.md): toPage/toLocal
 * over CameraState are pure, exact inverses, and need no DOM — which is
 * the entire point. Every cross-plane flight, hit test, and drag reduces
 * to these two functions, so they are proven here as arithmetic, not as
 * pixels.
 */
import { appliedCamera, toLocal, toPage } from '@cardstack/choreo';
import { module, test } from 'qunit';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

module('Integration | choreo | space', function () {
  test('an unpanned camera is exactly the identity', function (assert) {
    const cam = { x: 0, y: 0, zoom: 1 };
    const box = { height: 40, width: 80, x: 120, y: 60 };
    assert.deepEqual(toPage(box, cam), box, 'toPage is identity at rest');
    assert.deepEqual(toLocal(box, cam), box, 'toLocal is identity at rest');
    assert.deepEqual(
      appliedCamera(cam, { x: 500, y: 300 }),
      { x: 0, y: 0 },
      'at z = 1 the aim term vanishes'
    );
  });

  test('toLocal inverts toPage exactly, aim and scroll included', function (assert) {
    const cam = { x: -180, y: 42, zoom: 1.6 };
    const aim = { x: 260, y: 140 };
    const scroll = { x: 35, y: 0 };
    const box = { height: 24, width: 64, x: 300, y: 210 };
    const there = toPage(box, cam, aim, scroll);
    const back = toLocal(there, cam, aim, scroll);
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      assert.true(
        near(back[key], box[key]),
        `${key} survives the round trip (${String(back[key])})`
      );
    }
  });

  test('a zoomed plane maps sizes and positions by the algebra, not the DOM', function (assert) {
    // zoom 2 about aim (100, 100), no pan: applied = (1−2)·aim = (−100, −100)
    const cam = { x: 0, y: 0, zoom: 2 };
    const aim = { x: 100, y: 100 };
    // the aim point itself must not move
    const there = toPage({ height: 0, width: 0, x: 100, y: 100 }, cam, aim);
    assert.true(
      near(there.x, 100) && near(there.y, 100),
      `the aim point is the fixed point of the zoom (${String(there.x)})`
    );
    // a box at the origin doubles away from the aim
    const page = toPage({ height: 10, width: 10, x: 0, y: 0 }, cam, aim);
    assert.true(
      near(page.x, -100) && near(page.width, 20),
      `geometry scales about the aim (${String(page.x)}, ${String(page.width)})`
    );
  });
});
