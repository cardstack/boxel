import Service from '@ember/service';
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
   * Single tracked source of truth for "a session is established". Written
   * ONLY by MatrixService (the auth orchestrator); everyone else reads.
   */
  @tracked isAuthenticated = false;

  private participants: SessionParticipant[] = [];

  register(participant: SessionParticipant) {
    this.participants.push(participant);
    if (this.isAuthenticated) {
      // Late joiner: the session it cares about already started (Ember
      // services are lazy singletons — first injection can happen mid-session).
      this.notifyOne(participant);
    }
  }

  /** Called by MatrixService when login completes. */
  notifySessionStarted() {
    this.isAuthenticated = true;
    for (let p of this.participants) {
      this.notifyOne(p);
    }
  }

  /** Called by MatrixService.logout() and by test teardown. */
  notifySessionEnded() {
    this.isAuthenticated = false;
    for (let p of this.participants) {
      // Per-participant isolation: one throwing resetState() must not skip the
      // rest of the registry.
      try {
        p.resetState();
      } catch (e) {
        console.error('SessionParticipant resetState failed', e);
      }
    }
  }

  private notifyOne(p: SessionParticipant) {
    try {
      p.sessionStarted?.();
    } catch (e) {
      console.error('SessionParticipant sessionStarted failed', e);
    }
  }
}

declare module '@ember/service' {
  interface Registry {
    session: SessionService;
  }
}
