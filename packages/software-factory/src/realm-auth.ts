/**
 * Thin wrapper that returns an auth-aware fetch for a Boxel resource URL.
 *
 * Auth lives in `@cardstack/boxel-cli` (ProfileManager singleton). When the
 * resource URL is on the active profile's realm server, we extract the
 * containing realm URL (`{server}/{owner}/{realm}/`) from the card URL and
 * hand back `createRealmFetch(realmUrl)` so per-realm JWT attachment works
 * for any card-path under that realm. Otherwise the resource is treated as
 * public and the caller's plain fetch is returned unchanged.
 *
 * This file used to own the full Matrix login + realm-auth flow. That code
 * is gone; boxel-cli does it now.
 */

import {
  createRealmFetch,
  getActiveProfileSummary,
} from '@cardstack/boxel-cli';

export interface CreateBoxelRealmFetchOptions {
  fetch?: typeof globalThis.fetch;
}

export function createBoxelRealmFetch(
  resourceUrl: string,
  options?: CreateBoxelRealmFetchOptions,
): typeof globalThis.fetch {
  let fetchImpl = options?.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is not available');
  }

  let active;
  try {
    active = getActiveProfileSummary();
  } catch {
    return fetchImpl;
  }

  if (!sharesOrigin(resourceUrl, active.realmServerUrl)) {
    return fetchImpl;
  }

  // Extract the realm URL from the card URL. Boxel realms live at
  // `{realmServer}/{owner}/{realm}/`; per-realm JWTs from `_realm-auth`
  // are keyed by that URL. A card URL like
  // `{realmServer}/{owner}/{realm}/Card/instance.json` needs to be
  // resolved to its containing realm URL before we can look up its JWT.
  let realmUrl = extractRealmUrl(resourceUrl, active.realmServerUrl);
  if (!realmUrl) {
    return fetchImpl;
  }
  return createRealmFetch(realmUrl);
}

function sharesOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch (error) {
    throw new Error(
      `Invalid URL while setting up realm auth for ${left}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function extractRealmUrl(
  resourceUrl: string,
  realmServerUrl: string,
): string | undefined {
  try {
    let resource = new URL(resourceUrl);
    let server = new URL(realmServerUrl);
    let serverPath = server.pathname.endsWith('/')
      ? server.pathname
      : `${server.pathname}/`;
    let resourcePath = resource.pathname.startsWith(serverPath)
      ? resource.pathname.slice(serverPath.length)
      : resource.pathname.replace(/^\/+/, '');
    let segments = resourcePath.split('/').filter(Boolean);
    if (segments.length < 2) {
      return undefined;
    }
    return `${resource.origin}${serverPath}${segments[0]}/${segments[1]}/`;
  } catch {
    return undefined;
  }
}
