import Service from '@ember/service';

import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';

import { SECURE_WINDOW_FEATURES } from '@cardstack/host/lib/secure-window';

export type SecureWindowOpenStatus = 'opened' | 'blocked';

export interface BlockedSecureWindow {
  url: string;
  reason?: string;
}

// Opens the secure window, and when the browser blocks the popup, holds it
// for the app to offer a button that opens it on the user's click instead
// (`SecureWindowFallback`).
//
// The app keeps no handle to the window. The window is opened with an opener
// so that a blocked popup can be told apart from an opened one (a `noopener`
// open answers null either way), and the opener is cut before the secure page
// loads; the secure origin's `Cross-Origin-Opener-Policy` cuts it again as the
// page arrives. So nothing in the app page, card code included, can read,
// navigate or message the window, and the app learns what happened there only
// by asking the realm server.
export default class SecureWindowService extends Service {
  @tracked blocked: BlockedSecureWindow | undefined;

  open(url: string, reason?: string): SecureWindowOpenStatus {
    if (this.openPopup(url)) {
      this.blocked = undefined;
      return 'opened';
    }
    this.blocked = { url, ...(reason ? { reason } : {}) };
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
