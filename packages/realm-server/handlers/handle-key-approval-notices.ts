import type Koa from 'koa';
import { logger } from '@cardstack/runtime-common';
import { KEY_NOTICES_UPDATED_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type { CreateRoutesArgs } from '../routes.ts';
import {
  countUnreadKeyApprovalNotices,
  listKeyApprovalNotices,
  markKeyApprovalNoticesRead,
} from '../lib/automation-key-approval-notices.ts';
import { UserKeyError } from '../lib/user-keys.ts';
import { secureClientOf } from './handle-user-key-grants.ts';
import {
  keysHandler,
  ownerOf,
  readJSON,
  sendJSON,
} from './handle-user-keys.ts';

type Handler = (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;

const log = logger('realm-server:key-approval-notices');

// `GET /_key-approval-notices`: the user's notices about automations that
// wait for their key approval, or for a key to be shared into a realm they
// directly write, newest first (see `lib/automation-key-approval-notices.ts`),
// with `meta.unread`, the app's badge count for them. The app's own session
// may read them.
export function handleListKeyApprovalNotices({
  dbAdapter,
}: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let recipient = ownerOf(ctxt);
    let notices = await listKeyApprovalNotices(dbAdapter, recipient);
    await sendJSON(ctxt, 200, {
      data: notices.map(({ id, ...attributes }) => ({
        type: 'key-approval-notice',
        id,
        attributes,
      })),
      meta: { unread: notices.filter((notice) => !notice.readAt).length },
    });
  });
}

// `POST /_key-approval-notices/read` marks the notices it names read, as the
// key page does once it has shown them: `{ "data": [{ "type":
// "key-approval-notice", "id": "<id>" }, ...] }`. Only a secure-origin session
// may, so the app page, where card code runs, can't clear the badge that
// tells a key's owner an automation waits for their approval.
export function handleMarkKeyApprovalNoticesRead(
  args: CreateRoutesArgs,
): Handler {
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
          (entry as { type?: unknown }).type === 'key-approval-notice',
      )
    ) {
      throw new UserKeyError(
        400,
        `data must be a list of 'key-approval-notice' resources`,
      );
    }
    let marked = await markKeyApprovalNoticesRead(
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
          `could not tell ${recipient} their key approval notices were read: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await sendJSON(ctxt, 200, {
      meta: {
        marked,
        unread: await countUnreadKeyApprovalNotices(args.dbAdapter, recipient),
      },
    });
  });
}
