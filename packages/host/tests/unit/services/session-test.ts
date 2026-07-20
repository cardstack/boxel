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

    // In tests the participant error is rethrown (after the full broadcast)
    // so a broken participant fails loudly instead of being swallowed.
    assert.throws(
      () => session.notifySessionStarted(),
      /boom/,
      'the participant error resurfaces in the test environment',
    );

    assert.strictEqual(
      after.startedCount,
      1,
      'the participant after a throwing one still got sessionStarted',
    );
    assert.true(
      session.isAuthenticated,
      'the session is still marked established',
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

    // In tests the participant error is rethrown (after the full broadcast)
    // so a broken resetState() fails the test that caused it instead of
    // leaking state into a later, unrelated test.
    assert.throws(
      () => session.notifySessionEnded(),
      /boom/,
      'the participant error resurfaces in the test environment',
    );

    assert.strictEqual(
      after.resetCount,
      1,
      'the participant after a throwing one still got resetState',
    );
    assert.false(session.isAuthenticated, 'the session is still marked ended');
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

    assert.throws(
      () => session.register(thrower),
      /boom/,
      'the replay error resurfaces in the test environment',
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
