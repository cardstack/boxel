import type Koa from 'koa';
import { randomUUID } from 'node:crypto';
import {
  CLIENT_IP_HEADER,
  DIAGNOSTIC_SESSION_LIFETIME_SEC,
  DIAGNOSTIC_SESSION_LOG_CHANNEL,
  diagnosticSessionSecret,
  ensureTrailingSlash,
  fetchUserPermissions,
  logger,
  SupportedMimeType,
  type DiagnosticSessionClaim,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import { ensureRealmOwnerPermissions } from '@cardstack/runtime-common/tasks/indexer';
import { createJWT } from '../jwt.ts';
import { findOrMountRealm } from '../lib/realm-routing.ts';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForNotFound,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import type { OperatorTokenClaim } from '../utils/operator-token.ts';

// The operator endpoint that issues diagnostic sessions (see
// `diagnostic-session.ts` in runtime-common): what an operator renders a live
// card under to see it as the indexer does. It is reached with an operator
// token for `diagnostic-render`.
//
// The sessions read as the realm owner, with realm authority, in the realm
// that holds the card and — unless the request asks for that realm alone —
// in every realm the owner may read, which is the set the indexer's render
// carries. One session is minted per realm, keyed as the render tab looks
// them up, and each names its scope rather than listing the realms, so its
// size does not grow with the owner's read set. Each is read-only and lives
// for minutes. Every session of one mint shares an id, and the mint and each
// use of its sessions log on the diagnostic channel with that id and the
// operator's note.
//
// Body: `card` (the card's URL), `note` (who is asking and why), and
// `realmOnly` (issue a session for the card's own realm alone).
//
// Answers with the `boxel-session` map the render tab reads, the host app the
// render route is served from, and what the mint covers.

// The note travels in every session of a mint, so it is kept short: who is
// asking and why fits, and the session map stays small for a large read set.
export const MAX_DIAGNOSTIC_NOTE_LENGTH = 300;

const log = logger(DIAGNOSTIC_SESSION_LOG_CHANNEL);

export function handleDiagnosticRenderToken({
  dbAdapter,
  realms,
  reconciler,
  realmSecretSeed,
  serverURL,
  hostURL,
  virtualNetwork,
}: CreateRoutesArgs) {
  return async function (ctxt: Koa.Context) {
    let body: Record<string, unknown>;
    try {
      body = await (await fetchRequestFromContext(ctxt)).json();
    } catch {
      await sendResponseForBadRequest(ctxt, 'the body is not JSON');
      return;
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      await sendResponseForBadRequest(ctxt, 'the body must be a JSON object');
      return;
    }
    let { card, note, realmOnly } = body;
    if (typeof note !== 'string' || !note.trim()) {
      await sendResponseForBadRequest(
        ctxt,
        'a note saying who is asking and why is required',
      );
      return;
    }
    if (note.length > MAX_DIAGNOSTIC_NOTE_LENGTH) {
      await sendResponseForBadRequest(
        ctxt,
        `the note is longer than ${MAX_DIAGNOSTIC_NOTE_LENGTH} characters`,
      );
      return;
    }
    if (realmOnly !== undefined && typeof realmOnly !== 'boolean') {
      await sendResponseForBadRequest(ctxt, 'realmOnly must be a boolean');
      return;
    }
    let cardURL: URL;
    try {
      cardURL = new URL(String(card));
    } catch {
      await sendResponseForBadRequest(ctxt, 'card must be a URL');
      return;
    }
    let realm = await findOrMountRealm(cardURL, {
      realms,
      reconciler,
      dbAdapter,
    });
    if (!realm) {
      await sendResponseForNotFound(
        ctxt,
        `no realm on this server holds ${cardURL.href}`,
      );
      return;
    }

    // The indexer's render carries a session for every realm the owner may
    // read, and is always given read on the realm it renders.
    let owner = await realm.getRealmOwnerUserId();
    let ownerPermissions: RealmPermissions = realmOnly
      ? { [realm.url]: ['read'] }
      : ensureRealmOwnerPermissions(
          await fetchUserPermissions(dbAdapter, {
            userId: owner,
            includePublicRealms: true,
          }),
          realm.url,
        );
    // Permission maps key a realm by its id, which may be a prefix-form
    // identifier; the session map keeps that key, as the render tab looks
    // sessions up by it, and the claim records the URL it resolves to, which
    // is what a realm checks it against.
    let issued: { key: string; url: string }[] = [];
    for (let [key, actions] of Object.entries(ownerPermissions)) {
      if (!actions?.includes('read')) {
        continue;
      }
      try {
        issued.push({
          key,
          url: ensureTrailingSlash(virtualNetwork.toURL(key).href),
        });
      } catch (e: any) {
        log.warn(
          `not issuing a diagnostic session for realm ${key}: it does not resolve to a URL: ${e?.message ?? e}`,
        );
      }
    }

    let claim: DiagnosticSessionClaim = {
      id: randomUUID(),
      note,
      card: cardURL.href,
      scope: realmOnly ? 'realm' : 'owner-read-set',
      realm: ensureTrailingSlash(realm.url),
    };
    let issuedRealms = issued.map(({ url }) => url);
    let secret = diagnosticSessionSecret(realmSecretSeed);
    let realmServerURL = ensureTrailingSlash(serverURL);
    let sessions: Record<string, string> = {};
    for (let { key } of issued) {
      sessions[key] = createJWT(
        {
          user: owner,
          realm: key,
          permissions: ['read'],
          sessionRoom: '',
          realmServerURL,
          realmAuthority: true,
          diagnostic: claim,
        },
        DIAGNOSTIC_SESSION_LIFETIME_SEC,
        secret,
      );
    }
    let mintedAt = new Date();
    let expiresAt = new Date(
      mintedAt.getTime() + DIAGNOSTIC_SESSION_LIFETIME_SEC * 1000,
    );

    let address = ctxt.req.headers[CLIENT_IP_HEADER];
    let operatorToken = ctxt.state.operatorToken as
      | OperatorTokenClaim
      | undefined;
    log.info(
      `diagnostic session ${claim.id} minted for card ${claim.card} as ${owner}, scoped to ${claim.scope === 'realm' ? `its realm ${claim.realm}` : `the owner's read set (${issuedRealms.join(', ')} at the mint)`} until ${expiresAt.toISOString()}; operator note: ${JSON.stringify(note)}; from ${typeof address === 'string' && address ? address : 'an unknown address'}, operator token signed ${operatorToken ? new Date(operatorToken.iat * 1000).toISOString() : 'at an unknown time'}`,
    );

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify(
          {
            id: claim.id,
            card: claim.card,
            realm: realm.url,
            user: owner,
            scope: claim.scope,
            realms: issuedRealms,
            hostURL: ensureTrailingSlash(hostURL.href),
            mintedAt: mintedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            session: JSON.stringify(sessions),
          },
          null,
          2,
        ),
        {
          status: 201,
          headers: { 'content-type': SupportedMimeType.JSON },
        },
      ),
    );
  };
}
