/**
 * The render session: what a render tab holds when a realm renders its own
 * cards and modules, whose output is kept and served to others (indexing, the
 * HTML render, a module's definition render, skill validation). The tab runs
 * whatever code the realm holds, and anyone who may write the realm, an OAuth
 * app with `boxel:write` among them, can put code there. So what the tab holds
 * is no stronger than a render needs:
 *
 * - It reads, and nothing else. A realm refuses it for anything that needs
 *   more than read, whatever the user it reads as may do, and never lets it
 *   assume another user. Its `permissions` claim is only what the host reads
 *   to decide what it shows, and no verifier reads it.
 * - It is signed under its own key (`renderSessionSecret`), so every verifier
 *   of ordinary sessions refuses it on its signature: it can't be exchanged
 *   for a session at `/_realm-auth` or any other realm-server route that acts
 *   as its user. It is accepted only where a verifier asks for it by name: a
 *   realm's reads, and the federated read endpoints.
 * - It expires when the work it was minted for would be given up on, not a
 *   day later.
 *
 * Its scope is the owner's read set: every realm the user it reads as may read
 * when the session is used, which is what a render may link to. The claim
 * names the scope rather than listing the realms, so a session's size does not
 * grow with the read set.
 *
 * Deliberately a leaf module with no imports, so the realm, the realm server
 * and the host can share it without pulling in the runtime-common barrel.
 */

export const RENDER_SESSION_SCOPE = 'render-session';

export interface RenderSessionClaim {
  // `owner-read-set`: any realm the user the session reads as may read.
  scope: RenderSessionScope;
}

export type RenderSessionScope = 'owner-read-set';

/**
 * The signing key for this family: the realm secret seed under a
 * family-specific suffix, never the bare seed.
 */
export function renderSessionSecret(realmSecretSeed: string): string {
  return `${realmSecretSeed}:${RENDER_SESSION_SCOPE}`;
}

/**
 * Whether a token presents itself as a render session, read from its payload
 * without verifying it. It decides only which key to verify the token
 * against; a token that lies about it fails that verification.
 */
export function presentsAsRenderSession(token: string): boolean {
  let payload = token.split('.')[1];
  if (!payload) {
    return false;
  }
  try {
    let claims = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as unknown;
    return (
      typeof claims === 'object' && claims !== null && 'renderSession' in claims
    );
  } catch {
    return false;
  }
}

/**
 * The claim of a verified render session when it is well formed; otherwise
 * undefined. The signature and expiry are the verifier's to check before
 * this, and the read permission of the user it reads as after.
 */
export function acceptedRenderSessionClaim(claims: {
  renderSession?: unknown;
}): RenderSessionClaim | undefined {
  let { renderSession } = claims;
  if (typeof renderSession !== 'object' || renderSession === null) {
    return undefined;
  }
  let { scope } = renderSession as Record<string, unknown>;
  return scope === 'owner-read-set' ? { scope } : undefined;
}
