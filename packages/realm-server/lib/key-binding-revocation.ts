import { randomUUID } from 'node:crypto';
import {
  param,
  type Expression,
  type Querier,
} from '@cardstack/runtime-common';
import type { SecureSessionClient } from './secure-session.ts';

// Revokes the bindings `where` selects: each is removed, and its history gains
// a `revoked` row carrying the request as it was last approved, so the owner
// can still read what was revoked once the binding itself is gone. Every row
// one call writes shares a batch. Answers with the revoked bindings' ids.
//
// Kept apart from the bindings module because removing a grant and deleting a
// key revoke bindings too, and the bindings module reads grants.
export async function revokeBindingsIn(
  txQuery: Querier,
  {
    where,
    actor,
    via,
  }: {
    where: Expression;
    actor: string;
    // The client of the secure-origin session that revoked them; null when the
    // realm server revoked them because the key behind them was deleted.
    via: SecureSessionClient | null;
  },
): Promise<string[]> {
  let rows = await txQuery([
    `WITH gone AS (DELETE FROM key_bindings WHERE `,
    ...where,
    ` RETURNING id, grant_id, interactive, anonymous, fingerprint, approval_id)
    INSERT INTO key_binding_approvals (id, binding_id, batch_id, grant_id, action, interactive, anonymous, realm_url, definition_url, export_name, operation_name, instance_url, slot, key_id, share_id, destination, method, path_template, headers_template, placement, placement_name, transform, body_template, fingerprint, actor, via)
    SELECT gen_random_uuid(), gone.id, `,
    param(randomUUID()),
    `, gone.grant_id, 'revoked', gone.interactive, gone.anonymous, last.realm_url, last.definition_url, last.export_name, last.operation_name, last.instance_url, last.slot, last.key_id, last.share_id, last.destination, last.method, last.path_template, last.headers_template, last.placement, last.placement_name, last.transform, last.body_template, gone.fingerprint, `,
    param(actor),
    `, `,
    param(via),
    ` FROM gone JOIN key_binding_approvals last ON last.id = gone.approval_id
    RETURNING binding_id`,
  ]);
  return rows.map((row) => row.binding_id as string).sort();
}
