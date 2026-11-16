import {
  codeRefWithAbsoluteIdentifier,
  fetchRealmPermissions,
  isRealmArchived,
  isResolvedCodeRef,
  logger,
  param,
  query,
  type DBAdapter,
  type DefinitionLookup,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import type { OperationCore } from '@cardstack/runtime-common/card-operations';
import type {
  AccountStanding,
  AutomationAdmissionChecks,
} from '@cardstack/runtime-common/automation-admission';
import RealmPermissionChecker from '@cardstack/runtime-common/realm-permission-checker';
import { getMatrixAdminToken, resolveAdminCreds } from '../synapse.ts';
import { automationAdmission } from './key-bindings.ts';

const log = logger('automation-admission');

// What an automation run's admission asks of the realm server's side of the
// worker (see `automation-admission.ts` in runtime-common):
//
// - `accountStanding` asks the Matrix server's admin API about the account,
//   with the process's shared admin token. The admin credentials are
//   MATRIX_ADMIN_USERNAME and MATRIX_ADMIN_PASSWORD, or the dev admin on a
//   local homeserver (`resolveAdminCreds`). Without them, it throws, and
//   admission refuses every run as `account-unverifiable`.
// - `admitOperation` is `automationAdmission` over an operation core of the
//   worker's own, which reads from the database and the definition cache
//   (`workerOperationCore`), since the worker mounts no realm.
export function buildAutomationAdmissionChecks({
  dbAdapter,
  definitionLookup,
  virtualNetwork,
  matrixURL,
  matrixServerName,
  matrixAdminUsername,
  matrixAdminPassword,
}: {
  dbAdapter: DBAdapter;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
  matrixURL: URL;
  matrixServerName: string;
  matrixAdminUsername: string | undefined;
  matrixAdminPassword: string | undefined;
}): AutomationAdmissionChecks {
  let core = workerOperationCore({
    dbAdapter,
    definitionLookup,
    virtualNetwork,
    matrixServerName,
  });
  return {
    accountStanding: (user) =>
      matrixAccountStanding(
        { matrixURL, matrixAdminUsername, matrixAdminPassword },
        user,
      ),
    async admitOperation({ realmURL, operation, actsAs }) {
      let refused = await automationAdmission(dbAdapter, {
        core,
        realmURL,
        codeRef: operation.targetType,
        operation: operation.operation,
        payer: actsAs,
      });
      return refused?.error;
    },
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

// The operation core `automationAdmission` reads through, for a worker,
// which mounts no realm:
// - `resolveCodeRef` resolves a declared type against the automation's realm,
//   as the realm does.
// - `definitionLookup` is the worker's definition cache.
// - `readsRealmOf` finds the realm that holds a module among those this
//   server's permission rows name (the longest that contains it), and
//   whether the caller may read it, from the same rows a request is checked
//   against. An archived realm is read by no one.
export function workerOperationCore({
  dbAdapter,
  definitionLookup,
  virtualNetwork,
  matrixServerName,
}: {
  dbAdapter: DBAdapter;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
  matrixServerName: string;
}): Pick<
  OperationCore,
  'resolveCodeRef' | 'definitionLookup' | 'readsRealmOf'
> {
  return {
    definitionLookup,
    resolveCodeRef(codeRef, relativeTo) {
      let absolute = codeRefWithAbsoluteIdentifier(
        codeRef,
        relativeTo,
        undefined,
        virtualNetwork,
      );
      return isResolvedCodeRef(absolute) ? absolute : undefined;
    },
    async readsRealmOf(href, caller) {
      let url: string;
      try {
        url = virtualNetwork.toURLHref(href as any);
      } catch (e: any) {
        log.debug(`can't place module ${href} in a realm: ${e?.message ?? e}`);
        return undefined;
      }
      let [row] = await query(dbAdapter, [
        'SELECT realm_url FROM realm_user_permissions WHERE starts_with(',
        param(url),
        ', realm_url) ORDER BY length(realm_url) DESC LIMIT 1',
      ]);
      if (!row) {
        return undefined;
      }
      let realmURL = new URL(String(row.realm_url));
      if (await isRealmArchived(dbAdapter, realmURL)) {
        return { realm: realmURL.href, read: false };
      }
      let permissions = await fetchRealmPermissions(dbAdapter, realmURL);
      let read =
        caller.kind === 'user'
          ? await new RealmPermissionChecker(
              permissions,
              dbAdapter,
              matrixServerName,
            ).can(caller.actor, 'read')
          : Boolean(permissions['*']?.includes('read'));
      return { realm: realmURL.href, read };
    },
  };
}
