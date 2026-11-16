import type Koa from 'koa';
import { logger } from '@cardstack/runtime-common';
import {
  countUnreadAutomationNotices,
  listAutomationNotices,
  markAutomationNoticesRead,
  MAX_MARKED_AUTOMATION_NOTICES,
} from '@cardstack/runtime-common/automation-notices';
import { KEY_NOTICES_UPDATED_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type { CreateRoutesArgs } from '../routes.ts';
import { UserKeyError } from '../lib/user-keys.ts';
import { secureClientOf } from './handle-user-key-grants.ts';
import {
  keysHandler,
  ownerOf,
  readJSON,
  sendJSON,
} from './handle-user-keys.ts';

// The notices a person is owed about automation runs admission refused over
// something they fix in the secure window, such as an operation whose binding
// they haven't approved (see `automation-notices.ts` in runtime-common). The
// secure origin's key page lists them, beside the key notices, and marks the
// ones it shows read.

type Handler = (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;

const log = logger('realm-server:automation-notices');

// `GET /_automation-notices`: the user's automation notices, newest first, for
// the realms they still directly write, with `meta.unread`, the app's badge
// count for them. The app's own session may read them.
export function handleListAutomationNotices({
  dbAdapter,
  virtualNetwork,
  matrixClient,
}: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let recipient = ownerOf(ctxt);
    let notices = await listAutomationNotices(dbAdapter, recipient, {
      virtualNetwork,
      matrixServerName: matrixClient.serverName,
    });
    await sendJSON(ctxt, 200, {
      data: notices.map(({ id, ...attributes }) => ({
        type: 'automation-notice',
        id,
        attributes,
      })),
      meta: { unread: notices.filter((notice) => !notice.readAt).length },
    });
  });
}

// `POST /_automation-notices/read` marks the notices it names read, as the key
// page does once it has shown them: `{ "data": [{ "type":
// "automation-notice", "id": "<id>" }, ...] }`. Only a secure-origin session
// may, so the app page, where card code runs, can't clear the badge that
// tells a person an automation stopped for want of their approval.
export function handleMarkAutomationNoticesRead(
  args: CreateRoutesArgs,
): Handler {
  return keysHandler(async (ctxt) => {
    let recipient = ownerOf(ctxt);
    await secureClientOf(ctxt, args, 'notices are marked read');
    let body = await readJSON(ctxt);
    let data = body.data;
    let ids =
      Array.isArray(data) &&
      data.length <= MAX_MARKED_AUTOMATION_NOTICES &&
      data.every(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          (entry as { type?: unknown }).type === 'automation-notice' &&
          typeof (entry as { id?: unknown }).id === 'string' &&
          /^[0-9]{1,18}$/.test((entry as { id: string }).id),
      )
        ? data.map((entry) => (entry as { id: string }).id)
        : undefined;
    if (!ids) {
      throw new UserKeyError(
        400,
        `data must be a list of at most ${MAX_MARKED_AUTOMATION_NOTICES} 'automation-notice' resources`,
      );
    }
    let marked = await markAutomationNoticesRead(
      args.dbAdapter,
      recipient,
      ids,
    );
    if (marked > 0) {
      // The recipient's other sessions show the badge too; tell them it
      // changed.
      try {
        await args.sendEvent(recipient, KEY_NOTICES_UPDATED_EVENT_TYPE);
      } catch (err: unknown) {
        log.warn(
          `could not tell ${recipient} their automation notices were read: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await sendJSON(ctxt, 200, {
      meta: {
        marked,
        unread: await countUnreadAutomationNotices(args.dbAdapter, recipient, {
          virtualNetwork: args.virtualNetwork,
          matrixServerName: args.matrixClient.serverName,
        }),
      },
    });
  });
}
