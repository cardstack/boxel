import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

import type { PolicyShareAudit } from '@cardstack/runtime-common';

// How long a confirmed list stays confirmed. A source save returns before its
// index pass lands, and until it does the realm audits the next save against
// the policy it replaced; that save is the same change, so it is sent with
// the confirmation the person just gave rather than asking again.
export const CONFIRMED_LIST_REUSE_MS = 60_000;

// Asks the person saving a policy change to confirm the shared keys it opens
// to people who aren't signed in (see `policy-share-audit.ts` in
// runtime-common). A save the realm refuses for want of that confirmation
// comes here, from an autosave, a source save or a write the AI assistant
// makes, and is sent again carrying it only once the person confirms in the
// modal this service drives.
//
// One question is open at a time: a save that runs while the modal is up
// waits on the same answer. A declined list is asked about again the next
// time a save is refused for it. Where no modal is mounted to ask with (a
// command run without the app, say), nobody can confirm, so the answer is no
// at once and the save reports the refusal.
export default class PolicyAuditConfirmationService extends Service {
  @tracked pending: PolicyShareAudit | undefined;

  #answer: Promise<boolean> | undefined;
  #resolve: ((confirmed: boolean) => void) | undefined;
  #confirmed = new Map<string, number>();
  #askers = 0;

  // The modal registers while it is mounted.
  registerAsker(): () => void {
    this.#askers++;
    return () => {
      this.#askers--;
      if (this.#askers === 0) {
        this.answer(false);
      }
    };
  }

  confirm(audit: PolicyShareAudit): Promise<boolean> {
    let confirmedAt = this.#confirmed.get(audit.confirmation);
    if (
      confirmedAt !== undefined &&
      Date.now() - confirmedAt < CONFIRMED_LIST_REUSE_MS
    ) {
      return Promise.resolve(true);
    }
    if (this.#askers === 0) {
      return Promise.resolve(false);
    }
    if (this.pending?.confirmation === audit.confirmation && this.#answer) {
      return this.#answer;
    }
    // A different list supersedes the one on screen, which is left unsaved.
    this.#resolve?.(false);
    this.pending = audit;
    this.#answer = new Promise<boolean>((resolve) => {
      this.#resolve = resolve;
    });
    return this.#answer;
  }

  answer(confirmed: boolean) {
    let audit = this.pending;
    if (!audit) {
      return;
    }
    if (confirmed) {
      this.#confirmed.set(audit.confirmation, Date.now());
    }
    let resolve = this.#resolve;
    this.pending = undefined;
    this.#answer = undefined;
    this.#resolve = undefined;
    resolve?.(confirmed);
  }
}

declare module '@ember/service' {
  interface Registry {
    'policy-audit-confirmation': PolicyAuditConfirmationService;
  }
}
