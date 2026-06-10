// `RealmClient` is the capability a portable realm-server behavior needs from
// its environment, injected the same transport-first way as `RealmAuthClient`.
// It lets a single piece of logic (a `RealmOperation`) run unchanged in the
// host (Ember) and in boxel-cli (Node): each environment builds a `RealmClient`
// from its own auth/config plumbing, and the operation only ever touches this
// interface.
//
// The single `authedFetch` covers two auth contexts and is expected to route by
// URL: realm-*server* endpoints (`{realmServerURL}_publish-realm`, etc.) carry
// the realm-server token, while per-*realm* endpoints (`{realmURL}_publishability`,
// `{publishedRealmURL}_readiness-check`) carry that realm's token (or none, for
// public readiness). Keeping the routing inside the injected `authedFetch` is
// what lets the operations stay environment-agnostic.
export interface RealmClient {
  // Base URL of the realm server, normalized with a trailing slash.
  realmServerURL: string;

  // Authenticated fetch that picks the right token for `url` (see above).
  authedFetch(url: string, init?: RequestInit): Promise<Response>;

  // Domains used to resolve publish targets. Sourced from host
  // `config/environment` or the CLI's config.
  config: { spaceDomain: string; siteDomain: string };

  // The caller's matrix username, used to form subdirectory Boxel Space URLs.
  // Only required for callers that resolve a 'subdirectory' target via
  // `resolvePublishedRealmUrl`; operations that take an already-resolved
  // published URL don't read it.
  matrixUsername?: string;
}

// A portable realm-server behavior: pure logic plus a `RealmClient`. `In`/`Out`
// are plain TS types (never card types), so each wrapper — a host command, a CLI
// handler — owns its own serialization to/from this boundary.
export type RealmOperation<In, Out> = (
  client: RealmClient,
  input: In,
) => Promise<Out>;
