import window from 'ember-window-mock';

import { inMemorySessions } from '@cardstack/runtime-common/in-memory-sessions';
import { presentsAsOAuthTabToken } from '@cardstack/runtime-common/oauth-tab-token';

import { SessionLocalStorageKey } from './local-storage-keys';

// The realm sessions this tab holds, as the raw JSON map from realm URL to
// session. An automation run's prerender tab, and the tab of a command or
// capture an OAuth app starts, hold them in memory (see `inMemorySessions`);
// every other tab holds them in local storage.
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
// one else, except that an OAuth app's tab answers its own auth service
// worker's ask with a tab token (`heldOAuthTabTokens`).
export function realmSessionsAreInMemory(): boolean {
  return inMemorySessions() !== undefined;
}

// The tab tokens an OAuth app's tab holds in memory (`oauth-tab-token.ts`),
// or undefined when the tab holds none. The tab hands one to its browser
// context's auth service worker for the one request the worker asks about,
// so its images draw (ADR 021 §1.5): that context serves no other render.
// A run's sessions are never among them, since a run's tab is not kept apart
// from other renders and its token stays in the page (ADR 026 §1.2).
export function heldOAuthTabTokens(): Record<string, string> | undefined {
  let sessions = inMemorySessions();
  if (!sessions) {
    return undefined;
  }
  let tokens = Object.fromEntries(
    Object.entries(sessions).filter(([, token]) =>
      presentsAsOAuthTabToken(token),
    ),
  );
  return Object.keys(tokens).length > 0 ? tokens : undefined;
}
