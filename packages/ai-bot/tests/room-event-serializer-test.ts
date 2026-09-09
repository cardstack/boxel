import QUnit from 'qunit';
const { module, test } = QUnit;
import { RoomEventSerializer } from '../lib/room-event-serializer.ts';

// Lets every pending microtask run, the way handlers started in one sync
// batch reach their first await before any of them continues.
async function settle() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

module('Room event serializer', () => {
  test('one event in an idle room goes ahead', async (assert) => {
    let serializer = new RoomEventSerializer();
    let release = await serializer.claim('!room', '$a');
    assert.ok(release, 'the event gets a release function');
    release!();
  });

  test('of several events delivered together for one room, only the newest goes ahead', async (assert) => {
    let serializer = new RoomEventSerializer();
    let [a, b, c] = await Promise.all([
      serializer.claim('!room', '$a'),
      serializer.claim('!room', '$b'),
      serializer.claim('!room', '$c'),
    ]);
    assert.strictEqual(a, undefined, 'the oldest event stands down');
    assert.strictEqual(b, undefined, 'the middle event stands down');
    assert.ok(c, 'the newest event goes ahead');
    c!();
  });

  test('an event that arrives while the room is busy waits for the release', async (assert) => {
    let serializer = new RoomEventSerializer();
    let releaseA = (await serializer.claim('!room', '$a'))!;

    let bDone = false;
    let bClaim = serializer.claim('!room', '$b').then((release) => {
      bDone = true;
      return release;
    });
    await settle();
    assert.false(bDone, 'the newer event waits while the older one runs');

    releaseA();
    let releaseB = await bClaim;
    assert.ok(releaseB, 'the newer event goes ahead once the room is free');
    releaseB!();
  });

  test('of several events that arrive while the room is busy, only the newest goes ahead', async (assert) => {
    let serializer = new RoomEventSerializer();
    let releaseA = (await serializer.claim('!room', '$a'))!;

    let bClaim = serializer.claim('!room', '$b');
    let cClaim = serializer.claim('!room', '$c');
    await settle();
    releaseA();

    let [b, c] = await Promise.all([bClaim, cClaim]);
    assert.strictEqual(b, undefined, 'the older waiting event stands down');
    assert.ok(c, 'the newest waiting event goes ahead');
    c!();
  });

  test('releasing more than once is harmless', async (assert) => {
    let serializer = new RoomEventSerializer();
    let releaseA = (await serializer.claim('!room', '$a'))!;
    releaseA();
    releaseA();
    let releaseB = await serializer.claim('!room', '$b');
    assert.ok(releaseB, 'the room is free for the next event');
    releaseB!();
  });

  test('rooms do not wait for each other', async (assert) => {
    let serializer = new RoomEventSerializer();
    let releaseA = (await serializer.claim('!room-1', '$a'))!;
    let releaseB = await serializer.claim('!room-2', '$b');
    assert.ok(releaseB, 'a different room goes ahead while the first is busy');
    releaseA();
    releaseB!();
  });
});
