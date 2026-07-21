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
    // Capture the surfaced errors instead of letting them float as unhandled
    // rejections (which would fail this test). The production seam re-raises
    // asynchronously so the broadcast callers' try/catch can't swallow it.
    let surfaced: unknown[] = [];
    session.reraiseParticipantErrorsInTests = (errors) => {
      surfaced.push(...errors);
    };
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
    // In tests the participant error is surfaced (after the full broadcast) so
    // a broken participant fails loudly instead of being swallowed.
    assert.deepEqual(
      surfaced.map((e) => (e as Error).message),
      ['boom'],
      'the participant error is surfaced in the test environment',
    );
  });

  test('a throwing resetState() does not block later participants', function (assert) {
    let session = getSession(this);
    let surfaced: unknown[] = [];
    session.reraiseParticipantErrorsInTests = (errors) => {
      surfaced.push(...errors);
    };
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
      surfaced.map((e) => (e as Error).message),
      ['boom'],
      'the participant error is surfaced in the test environment',
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
    let surfaced: unknown[] = [];
    session.reraiseParticipantErrorsInTests = (errors) => {
      surfaced.push(...errors);
    };
    session.notifySessionStarted();

    let thrower: SessionParticipant = {
      resetState() {},
      sessionStarted() {
        throw new Error('boom');
      },
    };

    session.register(thrower);

    assert.deepEqual(
      surfaced.map((e) => (e as Error).message),
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
