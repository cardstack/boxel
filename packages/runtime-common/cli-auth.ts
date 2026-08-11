// The contract between the CLI's loopback listener and the browser page that
// authorizes it. Both sides need the same wait window: the CLI enforces it, and
// the page tells the person how long they have — so it lives here rather than in
// either one, where the two could disagree.

// Long enough to cover an interactive round-trip mid-flow: a password reset or a
// sign-up both link an email back to the page carrying the same port and nonce,
// so the authorization resumes only while the listener is still up, and checking
// email and clicking through comfortably exceeds a few minutes. The listener is
// bound to loopback and admits exactly one nonce-matching callback, so waiting
// longer costs little.
export const CLI_AUTH_TIMEOUT_MS = 30 * 60 * 1000;

// "30 minutes" rather than "1800s", since the wait is long enough that seconds
// stop being the unit anyone thinks in.
export function describeDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
