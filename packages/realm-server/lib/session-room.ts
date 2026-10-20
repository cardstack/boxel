import {
  fetchSessionRoom,
  getOrCreateUser,
  upsertSessionRoom,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { addToCreditsLedger } from '@cardstack/billing/billing-queries';
import { getLowCreditThreshold } from './daily-credit-grant-config.ts';

// The room the realm server messages a user in, made on their first sign-in
// to Boxel along with their realm-server user and its first credit grant.
// Returns the room, existing or new.
export async function ensureSessionRoom(
  {
    dbAdapter,
    matrixClient,
  }: { dbAdapter: DBAdapter; matrixClient: MatrixClient },
  userId: string,
  registrationToken?: string,
): Promise<string> {
  let sessionRoom = await fetchSessionRoom(dbAdapter, userId);
  if (sessionRoom) {
    return sessionRoom;
  }
  let { user, created } = await getOrCreateUser(
    dbAdapter,
    userId,
    registrationToken,
  );
  if (created) {
    let lowCreditThreshold = getLowCreditThreshold();
    if (lowCreditThreshold != null) {
      await addToCreditsLedger(dbAdapter, {
        userId: user.id,
        creditAmount: lowCreditThreshold,
        creditType: 'daily_credit',
        subscriptionCycleId: null,
      });
    }
  }
  sessionRoom = await matrixClient.createDM(userId);
  await upsertSessionRoom(dbAdapter, userId, sessionRoom);
  return sessionRoom;
}
