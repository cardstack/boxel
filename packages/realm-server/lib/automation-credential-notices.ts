import {
  fetchDirectWriters,
  param,
  query,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { AutomationCredentialNotice } from '@cardstack/runtime-common/automation-notices';
import {
  CREDENTIAL_REJECTED_REASON,
  type AutomationRun,
} from '@cardstack/runtime-common/automation-runs';
import { matrixServerNameFromEnv } from '../utils/matrix-server-name.ts';
import { mintingFix } from './oauth.ts';

// Who is told about an automation run that ended on a refused credential,
// and what each of them fixes. A run records the credential it ended on
// (`automation_runs.credential_*`): the share its refused slot is filled
// from, or the personal key that fills it. Each notice is read from that
// against the key, its OAuth client and its share as they are now, so a
// notice stands only while what it reports does, and ends once someone has
// fixed it:
//
// - `reconnect`: the vendor no longer accepts the payer's OAuth connection
//   (or its access-only token expired). The payer signs in again from the
//   secure window, opened with `#reconnect=<keyId>` (`reconnectFragment`).
// - `connect-again`: the client the payer's connection signed in through
//   was deleted, so the connection can never mint again, and a reconnect,
//   which signs in through the same client, can't help. The payer connects
//   through a client that exists, from the secure window's connect page, and
//   approves the operation for the new connection.
// - `fix-client`: the OAuth client the credential mints through is broken.
//   Its owner replaces the client's secret.
// - `fix-share`: the realm's share is broken: suspended, unshared, holding no
//   key or another app, or holding a key the vendor refused, everywhere or at
//   a destination one of the share's own bindings sends it to. The realm's
//   direct writers resume it or swap a working key in.
//
// A platform client that is broken is the operators' to fix, and tells no
// one here. A personal key that isn't a connection, refused at its
// destination, is the payer's own key: its refusal already leaves its owner
// the key's own notice (`user_key_grant_notices`).

export type { AutomationCredentialNotice };

// The URL fragment that opens the secure window's connect page on a
// connection, to sign it in again.
export function reconnectFragment(keyId: string): string {
  return `reconnect=${encodeURIComponent(keyId)}`;
}

export async function automationCredentialNotices(
  dbAdapter: DBAdapter,
  run: AutomationRun,
): Promise<AutomationCredentialNotice[]> {
  let refusal = run.credentialRefusal;
  if (
    run.state !== 'error' ||
    run.errorReason !== CREDENTIAL_REJECTED_REASON ||
    !refusal
  ) {
    return [];
  }
  if (refusal.subject.kind === 'key') {
    return await noticesForKey(dbAdapter, run, refusal.subject.id);
  }
  return await noticesForShare(dbAdapter, refusal.subject.id);
}

async function noticesForKey(
  dbAdapter: DBAdapter,
  run: AutomationRun,
  keyId: string,
): Promise<AutomationCredentialNotice[]> {
  let fix = await mintingFix(dbAdapter, keyId);
  switch (fix?.kind) {
    case 'connection':
      return [{ kind: 'reconnect', recipients: [run.actsAs], keyId }];
    case 'client':
      return [
        {
          kind: 'fix-client',
          recipients: [fix.owner],
          clientKeyId: fix.clientKeyId,
        },
      ];
    case 'share':
      return [await shareNotice(dbAdapter, fix.shareId, fix.realmURL)];
    case 'gone':
      return [{ kind: 'connect-again', recipients: [run.actsAs], keyId }];
    default:
      return [];
  }
}

async function noticesForShare(
  dbAdapter: DBAdapter,
  shareId: string,
): Promise<AutomationCredentialNotice[]> {
  let [share] = await query(dbAdapter, [
    `SELECT s.realm_url, s.state, s.key_id, k.kind, k.state AS key_state,
            EXISTS (SELECT 1 FROM key_bindings b
                      JOIN user_key_grants g ON g.id = b.grant_id
                     WHERE b.share_id = s.id AND g.key_id = s.key_id
                       AND g.state = 'rejected') AS grant_rejected
       FROM key_shares s LEFT JOIN user_keys k ON k.id = s.key_id
      WHERE s.id = `,
    param(shareId),
  ]);
  if (!share) {
    return [];
  }
  let realmURL = share.realm_url as string;
  if (share.state !== 'active' || share.key_id == null) {
    return [await shareNotice(dbAdapter, shareId, realmURL)];
  }
  if (share.kind === 'oauth-client') {
    let fix = await mintingFix(dbAdapter, share.key_id as string);
    return fix?.kind === 'client'
      ? [
          {
            kind: 'fix-client',
            recipients: [fix.owner],
            clientKeyId: fix.clientKeyId,
          },
        ]
      : [];
  }
  if (share.key_state === 'rejected' || share.grant_rejected === true) {
    return [await shareNotice(dbAdapter, shareId, realmURL)];
  }
  return [];
}

async function shareNotice(
  dbAdapter: DBAdapter,
  shareId: string,
  realmURL: string,
): Promise<AutomationCredentialNotice> {
  return {
    kind: 'fix-share',
    recipients: await fetchDirectWriters(
      dbAdapter,
      new URL(realmURL),
      matrixServerNameFromEnv(),
    ),
    shareId,
  };
}
