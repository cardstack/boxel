// How long before a session expires it is re-minted.
export const tokenRefreshPeriodSec = 5 * 60; // 5 minutes
// The shortest wait between two mints of one session, and the longest the
// doubling wait after a run of unusable mints grows to.
export const minTokenRefreshIntervalSec = 30;
export const maxTokenRefreshBackoffSec = 30 * 60;

// Decides when a session is re-minted, for every refresher that keeps a
// session alive: each realm's, and the realm server's.
//
// A session is re-minted `tokenRefreshPeriodSec` before it expires, going by
// `exp` alone. A session restored from storage that is already inside that
// period is re-minted at once. A freshly minted one that arrives inside it
// cannot be scheduled from its `exp` — every re-mint would land in the same
// place, and the refresher would loop — so the wait is
// `minTokenRefreshIntervalSec`, doubling with each such mint in a row up to
// `maxTokenRefreshBackoffSec`, and the first usable mint resets it.
export class TokenRefreshSchedule {
  // The last token minted, so a fresh session can be told apart from one
  // restored out of storage.
  private lastMintedToken: string | undefined;
  // Mints in a row whose token arrived already inside the refresh period.
  private unusableMints = 0;

  minted(token: string): void {
    this.lastMintedToken = token;
  }

  reset(): void {
    this.lastMintedToken = undefined;
    this.unusableMints = 0;
  }

  // The milliseconds to wait before re-minting `token`, whose expiry is `exp`
  // (unix seconds). `reportUnusable` hears the wait whenever a fresh mint
  // could not be scheduled from its `exp`.
  refreshDelayMs(
    token: string,
    exp: number,
    reportUnusable: (delayMs: number) => void,
  ): number {
    let refreshMs = exp * 1000 - Date.now() - tokenRefreshPeriodSec * 1000;
    if (token === this.lastMintedToken) {
      if (refreshMs < minTokenRefreshIntervalSec * 1000) {
        this.unusableMints++;
        refreshMs = Math.min(
          minTokenRefreshIntervalSec * 1000 * 2 ** (this.unusableMints - 1),
          maxTokenRefreshBackoffSec * 1000,
        );
        reportUnusable(refreshMs);
      } else {
        this.unusableMints = 0;
      }
    }
    return Math.max(refreshMs, 0);
  }
}
