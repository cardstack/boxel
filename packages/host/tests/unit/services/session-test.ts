import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import type SessionService from '@cardstack/host/services/session';
import type { SessionParticipant } from '@cardstack/host/services/session';

class RecordingParticipant implements SessionParticipant {
  resetCount = 0;
  startedCount = 0;
  resetState() {
    this.resetCount++;
  }
  sessionStarted() {
    this.startedCount++;
  }
}

module('Unit | Service | session', function (hooks) {
  setupTest(hooks);

  function getSession(context: { owner: any }) {
    return context.owner.lookup('service:session') as SessionService;
  }

  test('notifySessionStarted reaches every participant and sets isAuthenticated', function (assert) {
    let session = getSession(this);
    let a = new RecordingParticipant();
    let b = new RecordingParticipant();
    session.register(a);
    session.register(b);

    assert.false(session.isAuthenticated, 'starts unauthenticated');

    session.notifySessionStarted();

    assert.true(session.isAuthenticated, 'isAuthenticated flips true');
    assert.strictEqual(a.startedCount, 1, 'a.sessionStarted ran once');
    assert.strictEqual(b.startedCount, 1, 'b.sessionStarted ran once');
  });

  test('notifySessionEnded reaches every participant and clears isAuthenticated', function (assert) {
    let session = getSession(this);
    let a = new RecordingParticipant();
    let b = new RecordingParticipant();
    session.register(a);
    session.register(b);
    session.notifySessionStarted();

    session.notifySessionEnded();

    assert.false(session.isAuthenticated, 'isAuthenticated flips false');
    assert.strictEqual(a.resetCount, 1, 'a.resetState ran once');
    assert.strictEqual(b.resetCount, 1, 'b.resetState ran once');
  });

  test('a throwing sessionStarted() does not block later participants', function (assert) {
    let session = getSession(this);
    let thrower: SessionParticipant = {
      resetState() {},
      sessionStarted() {
        throw new Error('boom');
      },
    };
    let after = new RecordingParticipant();
    session.register(thrower);
    session.register(after);

    session.notifySessionStarted();

    assert.strictEqual(
      after.startedCount,
      1,
      'the participant after a throwing one still got sessionStarted',
    );
    assert.true(
      session.isAuthenticated,
      'the session is still marked established',
    );
    // The participant error is buffered (not thrown mid-broadcast) so a broken
    // participant fails loudly in afterEach instead of being swallowed.
    assert.deepEqual(
      session.takeParticipantErrorsForTest().map((e) => (e as Error).message),
      ['boom'],
      'the participant error is surfaced in the test environment',
    );
  });

  test('a throwing resetState() does not block later participants', function (assert) {
    let session = getSession(this);
    let thrower: SessionParticipant = {
      resetState() {
        throw new Error('boom');
      },
    };
    let after = new RecordingParticipant();
    session.register(thrower);
    session.register(after);

    session.notifySessionEnded();

    assert.strictEqual(
      after.resetCount,
      1,
      'the participant after a throwing one still got resetState',
    );
    assert.false(session.isAuthenticated, 'the session is still marked ended');
    // A broken resetState() surfaces so it fails the test that caused it
    // instead of leaking state into a later, unrelated test.
    assert.deepEqual(
      session.takeParticipantErrorsForTest().map((e) => (e as Error).message),
      ['boom'],
      'the participant error is surfaced in the test environment',
    );
  });

  test('a participant registered during a broadcast is not double-invoked', function (assert) {
    let session = getSession(this);
    let late = new RecordingParticipant();
    // `first`'s sessionStarted() lazily registers `late` mid-broadcast — the
    // shape that happens when a sessionStarted() hook first-injects another
    // participant service. register() replays sessionStarted() on `late`
    // immediately (session already established); the snapshot iteration in
    // notifySessionStarted() must then NOT reach `late` again from its loop.
    let first: SessionParticipant = {
      resetState() {},
      sessionStarted() {
        session.register(late);
      },
    };
    session.register(first);

    session.notifySessionStarted();

    assert.strictEqual(
      late.startedCount,
      1,
      'the mid-broadcast registrant got exactly one sessionStarted (the replay), not a second from the live loop',
    );
  });

  test('a participant registered during notifySessionEnded is not reset by the same broadcast', function (assert) {
    let session = getSession(this);
    let late = new RecordingParticipant();
    let first: SessionParticipant = {
      resetState() {
        session.register(late);
      },
    };
    session.register(first);

    session.notifySessionEnded();

    // register() replays only sessionStarted(), never resetState(), and the
    // snapshot iteration keeps the teardown loop from reaching a registrant
    // appended mid-broadcast — so `late` is not reset here.
    assert.strictEqual(
      late.resetCount,
      0,
      'the mid-teardown registrant is not reached by the same resetState broadcast',
    );
  });

  test('registering while a session is established replays sessionStarted() exactly once', function (assert) {
    let session = getSession(this);
    session.notifySessionStarted();

    let late = new RecordingParticipant();
    session.register(late);

    assert.strictEqual(
      late.startedCount,
      1,
      'late registrant is replayed once on register',
    );

    session.notifySessionStarted();
    assert.strictEqual(
      late.startedCount,
      2,
      'a subsequent broadcast fires it again (once per session)',
    );
  });

  test('a throwing replay on late registration resurfaces in tests', function (assert) {
    let session = getSession(this);
    session.notifySessionStarted();

    let thrower: SessionParticipant = {
      resetState() {},
      sessionStarted() {
        throw new Error('boom');
      },
    };

    session.register(thrower);

    assert.deepEqual(
      session.takeParticipantErrorsForTest().map((e) => (e as Error).message),
      ['boom'],
      'the replay error is surfaced in the test environment',
    );
  });

  test('registering while no session is established does not fire sessionStarted()', function (assert) {
    let session = getSession(this);
    let participant = new RecordingParticipant();

    session.register(participant);

    assert.strictEqual(
      participant.startedCount,
      0,
      'no replay when unauthenticated',
    );
  });
});
