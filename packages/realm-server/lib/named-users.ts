import { param } from '@cardstack/runtime-common';
import type { Querier } from '@cardstack/runtime-common/expression';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

// Whom `viewer` may be shown, by realm: their own id, and the ids of people
// who, with the viewer, are named by a permission row in that realm. A
// person's Matrix id is shown only to people who share a realm with them (ADR
// 011 §1.1, §1.2). A `*` or `users` row, or a policy grant, names no one; a row
// granting nothing is deleted, so any row names its user. The answer is a
// test of (realm, id).
export async function namedToViewer(
  txQuery: Querier,
  viewer: string,
  realms: string[],
  ids: string[],
): Promise<(realm: string, id: string) => boolean> {
  let others = [...new Set(ids.filter((id) => id !== viewer))];
  let uniqueRealms = [...new Set(realms)];
  if (others.length === 0 || uniqueRealms.length === 0) {
    return (_realm, id) => id === viewer;
  }
  let list = (values: string[]) =>
    values.flatMap((value, i) => [...(i > 0 ? [', '] : []), param(value)]);
  let named = new Set(
    (
      await txQuery([
        `SELECT realm_url, username FROM realm_user_permissions WHERE realm_url IN (`,
        ...list(uniqueRealms),
        `) AND username IN (`,
        ...list([viewer, ...others]),
        `)`,
      ])
    ).map((row) => `${row.realm_url}\n${row.username}`),
  );
  return (realm, id) =>
    id === viewer ||
    (named.has(`${realm}\n${viewer}`) && named.has(`${realm}\n${id}`));
}
