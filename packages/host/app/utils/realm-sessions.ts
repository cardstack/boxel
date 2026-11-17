import window from 'ember-window-mock';

import { inMemorySessions } from '@cardstack/runtime-common/in-memory-sessions';

import { SessionLocalStorageKey } from './local-storage-keys';

// The realm sessions this tab holds, as the raw JSON map from realm URL to
// session. An automation run's prerender tab holds them in memory (see
// `inMemorySessions`); every other tab holds them in local storage.
export function readRealmSessionsString(): string | null {
  let sessions = inMemorySessions();
  if (sessions) {
    return JSON.stringify(sessions);
  }
  return window.localStorage.getItem(SessionLocalStorageKey);
}

export function readRealmSessions(): Record<string, string> | undefined {
  let sessions = inMemorySessions();
  if (sessions) {
    return sessions;
  }
  let sessionsString = window.localStorage.getItem(SessionLocalStorageKey);
  return sessionsString ? JSON.parse(sessionsString) : undefined;
}

// Replaces the tab's realm sessions where the tab holds them.
export function writeRealmSessions(sessions: Record<string, string>): void {
  let held = inMemorySessions();
  if (held) {
    for (let realmURL of Object.keys(held)) {
      delete held[realmURL];
    }
    Object.assign(held, sessions);
    return;
  }
  window.localStorage.setItem(SessionLocalStorageKey, JSON.stringify(sessions));
}

// Whether the tab holds its sessions in memory. Such a tab hands them to no
// one else, the auth service worker included.
export function realmSessionsAreInMemory(): boolean {
  return inMemorySessions() !== undefined;
}
