import type {
  AccountStanding,
  AutomationAdmissionChecks,
} from '@cardstack/runtime-common/automation-admission';
import type { DBAdapter } from '@cardstack/runtime-common';
import { getMatrixAdminToken, resolveAdminCreds } from '../synapse.ts';
import { buildAdmitSpending } from './automation-spending.ts';

// What an automation run's admission asks of the realm server's side of the
// worker (see `automation-admission.ts` in runtime-common): the Matrix
// server's admin API, asked about the account the run acts as with the
// process's shared admin token, and the run's spending, checked against the
// automation's credit caps and its identity's balance at this process's
// prices (`automation-spending.ts`). The admin credentials are
// MATRIX_ADMIN_USERNAME and MATRIX_ADMIN_PASSWORD, or the dev admin on a
// local homeserver (`resolveAdminCreds`). Without them `accountStanding`
// throws, and admission refuses every run as `account-unverifiable`. The
// declared operations are the realm's to check (`RUN_ADMISSION_PATH`).
export function buildAutomationAdmissionChecks({
  dbAdapter,
  matrixURL,
  matrixAdminUsername,
  matrixAdminPassword,
}: {
  dbAdapter: DBAdapter;
  matrixURL: URL;
  matrixAdminUsername: string | undefined;
  matrixAdminPassword: string | undefined;
}): AutomationAdmissionChecks {
  return {
    accountStanding: (user) =>
      matrixAccountStanding(
        { matrixURL, matrixAdminUsername, matrixAdminPassword },
        user,
      ),
    admitSpending: buildAdmitSpending({ dbAdapter }),
  };
}

// What the Matrix server's admin API says of `user`'s account. Throws when
// the server can't be asked.
export async function matrixAccountStanding(
  {
    matrixURL,
    matrixAdminUsername,
    matrixAdminPassword,
  }: {
    matrixURL: URL;
    matrixAdminUsername: string | undefined;
    matrixAdminPassword: string | undefined;
  },
  user: string,
): Promise<AccountStanding> {
  let creds = resolveAdminCreds(
    matrixURL,
    matrixAdminUsername,
    matrixAdminPassword,
  );
  if (!creds.ok) {
    throw new Error(creds.reason);
  }
  let admin = {
    matrixURL,
    adminUsername: creds.username,
    adminPassword: creds.password,
  };
  let url = new URL(
    `_synapse/admin/v2/users/${encodeURIComponent(user)}`,
    matrixURL,
  );
  let token = await getMatrixAdminToken(admin);
  let response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    // The shared admin token expired or was logged out; log in again once.
    token = await getMatrixAdminToken({ ...admin, stale: token });
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  if (response.status === 404) {
    return 'missing';
  }
  if (!response.ok) {
    throw new Error(
      `the Matrix server answered ${response.status} for ${user}'s account`,
    );
  }
  let account = (await response.json()) as {
    deactivated?: boolean;
    locked?: boolean;
  };
  if (account.deactivated) {
    return 'deactivated';
  }
  if (account.locked) {
    return 'locked';
  }
  return 'usable';
}
