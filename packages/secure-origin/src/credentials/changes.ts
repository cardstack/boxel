import { trackedObject } from '@ember/reactive/collections';

// Counts the changes a `CredentialFrame` reports, so the components that read
// it render again when it changes. The frame is a plain module (ADR 008
// §1.6), so it can't hold tracked state itself.
export class Changes {
  private state = trackedObject({ count: 0 });

  // Called by whatever renders from the frame, so it renders again on the
  // next change.
  consume(): number {
    return this.state.count;
  }

  bump = () => {
    this.state.count++;
  };
}
