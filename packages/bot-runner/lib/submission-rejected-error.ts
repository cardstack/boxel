// A bot command that failed because of what the user submitted, not because
// of a fault in the bot runner or the services it calls. The handler has
// already shown the reason to the user, so the failure is logged but not
// reported to Sentry.
export class SubmissionRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubmissionRejectedError';
  }
}

// True when the error, or an error in its `cause` chain, is a
// SubmissionRejectedError.
export function isSubmissionRejection(err: unknown): boolean {
  let seen = new Set<unknown>();
  let current: unknown = err;
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof SubmissionRejectedError) {
      return true;
    }
    seen.add(current);
    current = current.cause;
  }
  return false;
}
