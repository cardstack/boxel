/**
 * THE SEAM'S GATE. A cut whose still cannot be painted yet must not move
 * the lens: Chris filmed the alternative at 60 fps — three frames of the
 * incoming shot, then the freeze of the outgoing one, then the wipe — and
 * the seam read backwards. `Seam.hold` is the gate that fixed it, and
 * these are its three promises.
 */
import { Seam } from 'glimmer-motion/film';
import { module, test } from 'qunit';

/** a real one-pixel GIF, so the browser has something to actually decode */
const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** a second one, a different colour, so the two are not one cache entry */
const OTHER =
  'data:image/gif;base64,R0lGODlhAQABAIABAP8AAAAAACH5BAEAAAEALAAAAAABAAEAAAICTAEAOw==';

module('Unit | film | the seam gate', function () {
  test('a seam with no still cuts on the spot', function (assert) {
    const seam = new Seam();
    let cut = 0;
    seam.hold('', () => (cut += 1));
    assert.strictEqual(cut, 1, 'nothing to decode, nothing to wait for');
  });

  test('a seam with a still waits for it, then cuts once', async function (assert) {
    const seam = new Seam();
    let cut = 0;
    seam.hold(PIXEL, () => (cut += 1));
    assert.strictEqual(cut, 0, 'the lens does not move on the frame it read');
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(cut, 1, 'it moves once the frame can be painted');
  });

  test('a later cut retires the one still waiting', async function (assert) {
    const seam = new Seam();
    const cuts: string[] = [];
    seam.hold(PIXEL, () => cuts.push('first'));
    seam.hold(OTHER, () => cuts.push('second'));
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(cuts, ['second'], 'one seam at a time, the newest');
  });

  test('a decode that never comes back is not waited on past the cap', async function (assert) {
    const seam = new Seam();
    let cut = 0;
    /* a truncated capture: a data URL that will never decode */
    seam.hold('data:image/jpeg;base64,////', () => (cut += 1), 30);
    await new Promise((r) => setTimeout(r, 220));
    assert.strictEqual(cut, 1, 'the film cuts anyway rather than stalling');
  });
});
