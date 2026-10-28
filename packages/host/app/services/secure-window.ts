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
export default class SecureWindowService extends Service {
  @tracked blocked: BlockedSecureWindow | undefined;

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
    return true;
  }
}

declare module '@ember/service' {
  interface Registry {
    'secure-window': SecureWindowService;
  }
}
