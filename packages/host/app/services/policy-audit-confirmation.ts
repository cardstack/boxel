import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

import type { PolicyShareAudit } from '@cardstack/runtime-common';

// Asks the person saving a policy change to confirm the shared keys it opens
// to people who aren't signed in (see `policy-share-audit.ts` in
// runtime-common). A save the realm refuses for want of that confirmation
// comes here, from an autosave, a source save or a write the AI assistant
// makes, and is sent again carrying it only once the person confirms in the
// modal this service drives.
//
// One question is open at a time: an autosave that runs while the modal is up
// waits on the same answer, and a list the person declined isn't asked about
// again, so a card that keeps autosaving a change they turned down reports
// the save as refused rather than re-opening the modal on every keystroke.
export default class PolicyAuditConfirmationService extends Service {
  @tracked pending: PolicyShareAudit | undefined;

  #answer: Promise<boolean> | undefined;
  #resolve: ((confirmed: boolean) => void) | undefined;
  #declined = new Set<string>();

  confirm(audit: PolicyShareAudit): Promise<boolean> {
    if (this.#declined.has(audit.confirmation)) {
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
    if (!confirmed) {
      this.#declined.add(audit.confirmation);
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
