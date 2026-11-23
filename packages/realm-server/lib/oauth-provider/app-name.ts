// How Boxel's pages name an app that asks to connect (ADR 021 §1.4). Anyone
// can register under any name, so a page names an app by what Boxel can
// check: a client ID metadata document's client ID is a URL its owner serves,
// so it is named by that URL's registrable domain; a client that registered
// itself is named by the registrable domain of the redirect URI it uses, beside
// the name it gave itself, marked unverified. A loopback redirect URI could be
// any program on the user's computer. A pre-registered client is one of
// Boxel's own apps, named by the name its entry in code gives
// (`pre-registered-clients.ts`).

import { registrableDomain } from '../secure-window.ts';
import type { PreRegisteredClients } from './pre-registered-clients.ts';
import { isLoopbackRedirect } from './redirect-uris.ts';

export const LOOPBACK_APP_NAME = 'an app on this computer';
// A client that registered itself, named without a redirect URI to go by.
export const UNKNOWN_APP_NAME = 'an unknown app';

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
  // Set when `shown` is a phrase standing in for a name Boxel doesn't have:
  // an app on the user's own computer, or one with no redirect URI to go by.
  // A page that words the app itself reads this, never the phrase.
  standIn?: AppStandIn;
  // Where a pre-registered app runs, from its entry in code: on the user's
  // own computer, which the page says.
  place?: 'this-computer';
}

export type AppStandIn = 'loopback' | 'unknown';

// A client ID metadata document's client ID is an HTTPS URL. A client that
// registered itself gets an ID Boxel generated, never a URL.
export function clientKind(
  clientId: string,
  preRegistered: PreRegisteredClients,
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
  preRegistered = new Map(),
}: {
  clientId: string;
  clientName?: string;
  // The redirect URI the flow uses, which a client that registered itself is
  // named by.
  redirectUri?: string;
  preRegistered?: PreRegisteredClients;
}): AppName {
  let kind = clientKind(clientId, preRegistered);
  switch (kind) {
    case 'pre-registered': {
      // Named by its entry in code. Boxel chose the name, but can't check
      // that the program asking is that app (`pre-registered-clients.ts`).
      let { metadata, place } = preRegistered.get(clientId)!;
      return { kind, shown: metadata.client_name, verified: true, place };
    }
    case 'metadata-document':
      return {
        kind,
        shown: registrableDomain(new URL(clientId).hostname),
        verified: true,
      };
    case 'dynamic':
      return {
        kind,
        ...shownForRedirect(redirectUri),
        verified: false,
        ...(clientName ? { claimedName: clientName } : {}),
      };
  }
}

function shownForRedirect(
  redirectUri: string | undefined,
): Pick<AppName, 'shown' | 'standIn'> {
  let url = parseURL(redirectUri);
  if (!url) {
    return { shown: UNKNOWN_APP_NAME, standIn: 'unknown' };
  }
  if (isLoopbackRedirect(url)) {
    return { shown: LOOPBACK_APP_NAME, standIn: 'loopback' };
  }
  return { shown: registrableDomain(url.hostname) };
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
