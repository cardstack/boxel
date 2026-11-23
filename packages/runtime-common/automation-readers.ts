import type {
  BroadReadGrant,
  CompiledRealmPolicy,
} from './card-operations/policy.ts';
import type { RealmPermissions } from './index.ts';

// Who beyond the people a realm's direct writers name can read what an
// automation writes into the realm. A script's writes are readable by whoever
// can read the realm, so a realm holding a sensitive source, such as HR data,
// should have none of these. The switch-on screen warns when any is present.
//
// - `anyone`: the realm's permissions let anyone read it, signed in or not
//   (the `*` row).
// - `everySignedInUser`: the realm's permissions let every signed-in user
//   read it (the `users` row).
// - `policyGrants`: grants in the realm's policy that let a caller read the
//   cards they admit, and admit callers by something other than who they are
//   (`BroadReadGrant`), each with where it is in the policy card.
//
// A grant whose `where` names particular callers isn't listed: the people it
// admits are the ones its author chose, as with a permission row naming them.
export interface AutomationBroadReaders {
  anyone: boolean;
  everySignedInUser: boolean;
  policyGrants: BroadReadGrant[];
  // The policy card the grants are in, when the realm names one.
  policy: string | null;
}

export function broadReadersOf(
  permissions: RealmPermissions,
  policy: CompiledRealmPolicy | undefined,
): AutomationBroadReaders {
  return {
    anyone: permissions['*']?.includes('read') ?? false,
    everySignedInUser: permissions['users']?.includes('read') ?? false,
    policyGrants: policy?.broadReadGrants ?? [],
    policy: policy?.card ?? null,
  };
}
