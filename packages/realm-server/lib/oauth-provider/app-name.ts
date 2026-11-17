// How Boxel's pages name an app that asks to connect (ADR 021 §1.4). Anyone
// can register under any name, so a page names an app by what Boxel can
// check: a client ID metadata document's client ID is a URL its owner serves,
// so it is named by that URL's registrable domain; a client that registered
// itself is named by the registrable domain of the redirect URI it uses, beside
// the name it gave itself, marked unverified. A loopback redirect URI could be
// any program on the user's computer. A pre-registered client is one of
// Boxel's own apps, named in code.

import {
  LOOPBACK_APP_NAME,
  UNKNOWN_APP_NAME,
} from '@cardstack/secure-origin/security/oauth-error-states.js';
import { registrableDomain } from '../secure-window.ts';
import { isLoopbackRedirect } from './redirect-uris.ts';

// The secure origin's pages read these names, so they are defined there.
// `UNKNOWN_APP_NAME` names a client that registered itself, without a
// redirect URI to go by.
export { LOOPBACK_APP_NAME, UNKNOWN_APP_NAME };

export type OAuthClientKind =
  | 'pre-registered'
  | 'metadata-document'
  | 'dynamic';

export interface AppName {
  kind: OAuthClientKind;
  // What the page names the app by, and what "Return to …" names.
  shown: string;
  // Whether Boxel vouches for `shown`. A client that registered itself is
  // shown as unverified.
  verified: boolean;
  // The name a client that registered itself gave, shown only as unverified.
  claimedName?: string;
}

// A client ID metadata document's client ID is an HTTPS URL. A client that
// registered itself gets an ID Boxel generated, never a URL.
export function clientKind(
  clientId: string,
  preRegistered: ReadonlySet<string>,
): OAuthClientKind {
  if (preRegistered.has(clientId)) {
    return 'pre-registered';
  }
  return clientId.startsWith('https://') ? 'metadata-document' : 'dynamic';
}

export function appName({
  clientId,
  clientName,
  redirectUri,
  preRegistered = new Set(),
}: {
  clientId: string;
  clientName?: string;
  // The redirect URI the flow uses, which a client that registered itself is
  // named by.
  redirectUri?: string;
  preRegistered?: ReadonlySet<string>;
}): AppName {
  let kind = clientKind(clientId, preRegistered);
  switch (kind) {
    case 'pre-registered':
      return { kind, shown: clientName ?? clientId, verified: true };
    case 'metadata-document':
      return {
        kind,
        shown: registrableDomain(new URL(clientId).hostname),
        verified: true,
      };
    case 'dynamic':
      return {
        kind,
        shown: shownForRedirect(redirectUri),
        verified: false,
        ...(clientName ? { claimedName: clientName } : {}),
      };
  }
}

function shownForRedirect(redirectUri: string | undefined): string {
  let url = parseURL(redirectUri);
  if (!url) {
    return UNKNOWN_APP_NAME;
  }
  if (isLoopbackRedirect(url)) {
    return LOOPBACK_APP_NAME;
  }
  return registrableDomain(url.hostname);
}

function parseURL(value: string | undefined): URL | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
