// Limits how often a password sign-in can be tried, per account and per
// caller address. A password sign-in needs no session, and each attempt on a
// real account has the Matrix server mint and log out two tokens, so without
// a limit anyone could make the server do that work at will. The Matrix
// server's own limit on failed attempts still applies on top of this.
//
// Counts are kept per process, in fixed windows; with several realm-server
// processes each allows its own share.

export interface SignInLimits {
  windowMs: number;
  perAccount: number;
  perAddress: number;
}

export const DEFAULT_SIGN_IN_LIMITS: SignInLimits = {
  windowMs: 5 * 60 * 1000,
  perAccount: 5,
  perAddress: 30,
};

interface Window {
  startedAt: number;
  count: number;
}

export class SignInLimiter {
  private windows = new Map<string, Window>();
  private limits: SignInLimits;
  constructor(limits: SignInLimits = DEFAULT_SIGN_IN_LIMITS) {
    this.limits = limits;
  }

  // Counts an attempt for the account and the address, and says whether it
  // may go ahead. An attempt over either limit isn't counted.
  allow(account: string, address: string | undefined): boolean {
    let now = Date.now();
    this.sweep(now);
    let keys: [string, number][] = [
      [`account:${account.trim().toLowerCase()}`, this.limits.perAccount],
    ];
    if (address) {
      keys.push([`address:${address}`, this.limits.perAddress]);
    }
    let windows = keys.map(([key, limit]) => {
      let window = this.windows.get(key);
      if (!window || now - window.startedAt >= this.limits.windowMs) {
        window = { startedAt: now, count: 0 };
        this.windows.set(key, window);
      }
      return { window, limit };
    });
    if (windows.some(({ window, limit }) => window.count >= limit)) {
      return false;
    }
    for (let { window } of windows) {
      window.count++;
    }
    return true;
  }

  private sweep(now: number) {
    for (let [key, window] of this.windows) {
      if (now - window.startedAt >= this.limits.windowMs) {
        this.windows.delete(key);
      }
    }
  }
}
