import Service from '@ember/service';
import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

/**
 * The session lifecycle contract.
 *
 * Every piece of host state is either app-scoped (page-load → page-unload) or
 * session-scoped (login → logout). Logout stays in-app (a router transition,
 * not a page reload), so nothing gets a fresh page to re-initialize from. The
 * enforceable rule:
 *
 *   Anything you tear down in `resetState()` must be re-established in
 *   `sessionStarted()` or derived lazily; anything that should survive logout
 *   doesn't belong in `resetState()` at all.
 *
 * `SessionService` broadcasts both edges of the session so participants can
 * honor that contract without owning their own construction-time arming logic.
 *
 * Participants must be app-lifetime singletons (services). There is no
 * unregister: a shorter-lived registrant (component, resource) would leak and
 * keep receiving lifecycle callbacks after it is destroyed.
 */
export interface SessionParticipant {
  /** Tear down session-scoped state. Runs on logout (and between tests). */
  resetState(): void;
  /**
   * Re-establish session-scoped state that resetState() tears down and that
   * is not lazily derived. Guaranteed to run exactly once per participant per
   * established session, regardless of when the participant was constructed
   * (late registrants are replayed).
   */
  sessionStarted?(): void;
}

export default class SessionService extends Service {
  /**
   * Single tracked source of truth for "a session is established". Every
   * write is driven by MatrixService (the auth orchestrator) — directly via
   * its setPostLoginCompleted() and through the notify methods below; everyone
   * else reads.
   */
  @tracked isAuthenticated = false;

  private participants: SessionParticipant[] = [];

  // Test-only buffer of participant errors caught during a broadcast. See
  // surfaceInTests() / takeParticipantErrorsForTest().
  #participantErrorsForTest: unknown[] = [];

  register(participant: SessionParticipant) {
    this.participants.push(participant);
    if (this.isAuthenticated) {
      // Late joiner: the session it cares about already started (Ember
      // services are lazy singletons — first injection can happen mid-session).
      let errors: unknown[] = [];
      this.notifyOne(participant, errors);
      this.surfaceInTests(errors);
    }
  }

  /** Called by MatrixService when login completes. */
  notifySessionStarted() {
    this.isAuthenticated = true;
    let errors: unknown[] = [];
    // Iterate a snapshot: a participant's sessionStarted() can lazily
    // first-inject another participant service, whose constructor calls
    // register() and appends to `participants`. Iterating the live array would
    // then reach that late registrant here *and* it already ran via register()'s
    // replay — a double sessionStarted() in one broadcast.
    for (let p of [...this.participants]) {
      this.notifyOne(p, errors);
    }
    this.surfaceInTests(errors);
  }

  /** Called by MatrixService.logout() and by test teardown. */
  notifySessionEnded() {
    this.isAuthenticated = false;
    let errors: unknown[] = [];
    // Snapshot for the same mutation-during-iteration reason as
    // notifySessionStarted().
    for (let p of [...this.participants]) {
      // Per-participant isolation: one throwing resetState() must not skip the
      // rest of the registry.
      try {
        p.resetState();
      } catch (e) {
        console.error('SessionParticipant resetState failed', e);
        errors.push(e);
      }
    }
    this.surfaceInTests(errors);
  }

  private notifyOne(p: SessionParticipant, errors: unknown[]) {
    try {
      p.sessionStarted?.();
    } catch (e) {
      console.error('SessionParticipant sessionStarted failed', e);
      errors.push(e);
    }
  }

  // In production a broken participant must not break login/logout for the
  // rest of the registry, so its error is only logged. In tests that same
  // swallowing hides real failures. We can't rethrow synchronously here: both
  // broadcast sites (MatrixService.start()/logout()) call the notify methods
  // inside their own try/catch and would swallow it. Floating a rejection
  // dodges the try/catch but surfaces non-deterministically — it can be
  // attributed to the *next* test's unhandledrejection hook rather than the one
  // whose participant threw. So buffer instead: the test harness drains this in
  // afterEach and fails the responsible test deterministically.
  private surfaceInTests(errors: unknown[]) {
    if (errors.length > 0 && isTesting()) {
      this.#participantErrorsForTest.push(...errors);
    }
  }

  // Test-only. Returns the participant errors buffered since the last call and
  // clears them. The test harness (setup.ts afterEach) calls this after the
  // broadcast and fails the test if anything was buffered; unit tests read it
  // directly to assert a broken participant was surfaced.
  takeParticipantErrorsForTest(): unknown[] {
    let errors = this.#participantErrorsForTest;
    this.#participantErrorsForTest = [];
    return errors;
  }
}

declare module '@ember/service' {
  interface Registry {
    session: SessionService;
  }
}
