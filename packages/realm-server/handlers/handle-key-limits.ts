import type Koa from 'koa';
import type { CreateRoutesArgs } from '../routes.ts';
import {
  setShareLimits,
  setUserKeyLimits,
  validateLimitChanges,
} from '../lib/key-limits.ts';
import type { KeyLimits } from '../lib/key-limit-settings.ts';
import { setUserKeyAnonymousUse, UserKeyError } from '../lib/user-keys.ts';
import { secureClientOf } from './handle-user-key-grants.ts';
import {
  keysHandler,
  ownerOf,
  readJSON,
  sendJSON,
} from './handle-user-keys.ts';

// Setting a share's or a personal key's limits: how much of the key anyone may
// spend. Only the key's owner sets them, and only from the secure window or
// the CLI, with a session signed in on the secure origin, as for approving a
// binding: limits are what keep a key a browser can reach from being spent
// without bound, so the app's session, which card code holds, can't raise
// them. See `lib/key-limits.ts`.
//
// The body is `{ data: { type: 'key-limits', attributes } }` with any of
// `rateBurst`, `rateRefillPerMinute`, `dailyBudget` and `monthlyBudget`, each a
// number or null for the platform's default; a limit left out keeps what it
// was. The answer is the limits in force afterwards, defaults filled in.

type Handler = (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;

async function readLimitChanges(ctxt: Koa.Context) {
  let body = await readJSON(ctxt);
  let data = body.data as
    | { type?: unknown; attributes?: Record<string, unknown> }
    | undefined;
  if (!data || typeof data !== 'object' || data.type !== 'key-limits') {
    throw new UserKeyError(400, `the resource type is 'key-limits'`);
  }
  let attributes = data.attributes;
  if (
    !attributes ||
    typeof attributes !== 'object' ||
    Array.isArray(attributes)
  ) {
    throw new UserKeyError(400, 'attributes must be an object');
  }
  return validateLimitChanges(attributes);
}

function serialize(id: string, limits: KeyLimits) {
  return { type: 'key-limits', id, attributes: limits };
}

export function handleSetKeyShareLimits(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let user = ownerOf(ctxt);
    await secureClientOf(ctxt, args, 'limits are changed');
    let changes = await readLimitChanges(ctxt);
    let shareId = ctxt.params.shareId;
    let limits = await setShareLimits(args.dbAdapter, {
      user,
      shareId,
      changes,
    });
    await sendJSON(ctxt, 200, { data: serialize(shareId, limits) });
  });
}

// Setting whether people who aren't signed in may use one of the user's keys,
// and the optional cap on their calls a day: like its limits, its owner's to
// set, from the secure window or the CLI only. The body is
// `{ data: { type: 'anonymous-use', attributes: { anonymous, anonymousDailyCap? } } }`,
// and the answer is the key.
export function handleSetUserKeyAnonymousUse(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    await secureClientOf(ctxt, args, 'anonymous use is changed');
    let body = await readJSON(ctxt);
    let data = body.data as
      | { type?: unknown; attributes?: Record<string, unknown> }
      | undefined;
    if (!data || typeof data !== 'object' || data.type !== 'anonymous-use') {
      throw new UserKeyError(400, `the resource type is 'anonymous-use'`);
    }
    let attributes = data.attributes ?? {};
    for (let name of Object.keys(attributes)) {
      if (name !== 'anonymous' && name !== 'anonymousDailyCap') {
        throw new UserKeyError(400, `'${name}' can't be set here`);
      }
    }
    let key = await setUserKeyAnonymousUse(args.dbAdapter, {
      owner,
      keyId: ctxt.params.keyId,
      anonymous: attributes.anonymous,
      anonymousDailyCap: attributes.anonymousDailyCap,
    });
    let { id, ...rest } = key;
    await sendJSON(ctxt, 200, {
      data: { type: 'user-key', id, attributes: rest },
    });
  });
}

export function handleSetUserKeyLimits(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    await secureClientOf(ctxt, args, 'limits are changed');
    let changes = await readLimitChanges(ctxt);
    let keyId = ctxt.params.keyId;
    let limits = await setUserKeyLimits(args.dbAdapter, {
      owner,
      keyId,
      changes,
    });
    await sendJSON(ctxt, 200, { data: serialize(keyId, limits) });
  });
}
