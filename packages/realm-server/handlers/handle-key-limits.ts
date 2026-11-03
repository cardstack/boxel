import type Koa from 'koa';
import { logger } from '@cardstack/runtime-common';
import { KEY_NOTICES_UPDATED_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type { CreateRoutesArgs } from '../routes.ts';
import {
  countUnreadLimitNotices,
  listLimitNotices,
  markLimitNoticesRead,
} from '../lib/key-limit-notices.ts';
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

const log = logger('realm-server:key-limits');

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
// and the optional caps on their calls a day and a month: like its limits, its
// owner's to set, from the secure window or the CLI only. The body is
// `{ data: { type: 'anonymous-use', attributes: { anonymous, anonymousDailyCap?, anonymousMonthlyCap? } } }`,
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
      if (
        name !== 'anonymous' &&
        name !== 'anonymousDailyCap' &&
        name !== 'anonymousMonthlyCap'
      ) {
        throw new UserKeyError(400, `'${name}' can't be set here`);
      }
    }
    let key = await setUserKeyAnonymousUse(args.dbAdapter, {
      owner,
      keyId: ctxt.params.keyId,
      anonymous: attributes.anonymous,
      anonymousDailyCap: attributes.anonymousDailyCap,
      anonymousMonthlyCap: attributes.anonymousMonthlyCap,
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

// `GET /_key-limit-notices`: the user's limit notices whose period hasn't
// ended, newest first, as a key's owner or a realm's direct writer (see
// `lib/key-limit-notices.ts`), with `meta.unread`, the app's badge count for
// them. The app's own session may read them.
export function handleListKeyLimitNotices({
  dbAdapter,
}: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let recipient = ownerOf(ctxt);
    let notices = await listLimitNotices(dbAdapter, recipient);
    await sendJSON(ctxt, 200, {
      data: notices.map(({ id, ...attributes }) => ({
        type: 'key-limit-notice',
        id,
        attributes,
      })),
      meta: { unread: await countUnreadLimitNotices(dbAdapter, recipient) },
    });
  });
}

// `POST /_key-limit-notices/read` marks the notices it names read, as the key
// page does once it has shown them: `{ "data": [{ "type": "key-limit-notice",
// "id": "<id>" }, ...] }`. Only a secure-origin session may, so the app page,
// where card code runs, can't clear the badge that tells a key's owner its use
// reached a limit.
export function handleMarkKeyLimitNoticesRead(args: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let recipient = ownerOf(ctxt);
    await secureClientOf(ctxt, args, 'notices are marked read');
    let body = await readJSON(ctxt);
    let data = body.data;
    if (
      !Array.isArray(data) ||
      !data.every(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          (entry as { type?: unknown }).type === 'key-limit-notice',
      )
    ) {
      throw new UserKeyError(
        400,
        `data must be a list of 'key-limit-notice' resources`,
      );
    }
    let marked = await markLimitNoticesRead(
      args.dbAdapter,
      recipient,
      data.map((entry) => (entry as { id?: unknown }).id),
    );
    if (marked > 0) {
      // The recipient's other sessions show the badge too; tell them it
      // changed.
      try {
        await args.sendEvent(recipient, KEY_NOTICES_UPDATED_EVENT_TYPE);
      } catch (err: unknown) {
        log.warn(
          `could not tell ${recipient} their key limit notices were read: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await sendJSON(ctxt, 200, {
      meta: {
        marked,
        unread: await countUnreadLimitNotices(args.dbAdapter, recipient),
      },
    });
  });
}
