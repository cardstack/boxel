import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service from '@ember/service';

import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';

import { SECURE_WINDOW_FEATURES } from '@cardstack/host/lib/secure-window';

export type SecureWindowOpenStatus = 'opened' | 'blocked';

export interface BlockedSecureWindow {
  url: string;
}

// Opens the secure window, and when the browser blocks the popup, holds it
// for the app to offer a button that opens it on the user's click instead
// (`SecureWindowFallback`).
//
// The window is opened with an opener so that a blocked popup can be told
// apart from an opened one (a `noopener` open answers null either way). The
// popup's `opener` is cut before the secure page loads, and the secure
// origin's `Cross-Origin-Opener-Policy` severs the two windows as it arrives,
// so the secure page can't reach the app page and the app learns what happened
// there only by asking the realm server. The app keeps no handle to the
// popup. Card code runs in this page, though, and could open a window itself
// or replace `window.open`, so what protects a key from card code is the
// secure page's own origin: the user types a key only where the address bar
// shows it.
//
// Since the app holds no handle to the popup, it can't see it close either.
// What it can see is the user coming back: each time this page takes focus
// again within `RETURN_WINDOW_MS` of a secure window opening, it tells
// whoever asked (`onReturn`), so what the window may have changed — a key
// added, an operation approved — is asked of the realm server again. Past
// that, a focus is the user switching windows, not coming back from this one.
// How long after a secure window opens a return to this page counts as coming
// back from it: long enough to add a key or approve a batch of operations.
const RETURN_WINDOW_MS = 10 * 60_000;

export default class SecureWindowService extends Service {
  @tracked blocked: BlockedSecureWindow | undefined;
  #openedAt: number | undefined;
  #onReturn: Set<() => void> = new Set();

  constructor(owner: Owner) {
    super(owner);
    let returned = () => this.#returned();
    window.addEventListener('focus', returned);
    registerDestructor(this, () =>
      window.removeEventListener('focus', returned),
    );
  }

  // Calls `callback` each time the user comes back to this page after a
  // secure window opened. Answers the function that stops it.
  onReturn(callback: () => void): () => void {
    this.#onReturn.add(callback);
    return () => this.#onReturn.delete(callback);
  }

  open(url: string): SecureWindowOpenStatus {
    if (this.openPopup(url)) {
      this.blocked = undefined;
      return 'opened';
    }
    this.blocked = { url };
    return 'blocked';
  }

  // The fallback button's action, on the user's click.
  openBlocked = () => {
    let blocked = this.blocked;
    if (blocked && this.openPopup(blocked.url)) {
      this.blocked = undefined;
    }
  };

  dismissBlocked = () => {
    this.blocked = undefined;
  };

  private openPopup(url: string): boolean {
    let popup = window.open(url, '_blank', SECURE_WINDOW_FEATURES);
    if (!popup) {
      return false;
    }
    popup.opener = null;
    this.#openedAt = Date.now();
    return true;
  }

  #returned(): void {
    if (
      this.#openedAt === undefined ||
      Date.now() - this.#openedAt > RETURN_WINDOW_MS
    ) {
      return;
    }
    for (let callback of [...this.#onReturn]) {
      callback();
    }
  }
}

declare module '@ember/service' {
  interface Registry {
    'secure-window': SecureWindowService;
  }
}
