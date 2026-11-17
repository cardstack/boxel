import type Koa from 'koa';
import {
  BodyTooLarge,
  MAX_SYSTEM_KEY_BODY_BYTES,
  operatorCaller,
  readJSONBody,
  respond,
} from './handle-system-keys.ts';
import {
  deletePlatformSecret,
  getPlatformSecret,
  listPlatformSecrets,
  PlatformSecretError,
  setPlatformSecret,
} from '../lib/platform-secrets.ts';
import { SystemKeyError } from '../lib/system-keys.ts';
import type { CreateRoutesArgs } from '../routes.ts';

// The operator endpoints for platform secrets, reached with an operator token
// for `platform-secrets`. A value goes in on a set and never comes back out:
// they report a secret's name, its data key and who last set it and when.

function handle(
  fn: (ctxt: Koa.Context) => Promise<{ status: number; body: unknown }>,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context) {
    try {
      let { status, body } = await fn(ctxt);
      await respond(ctxt, status, body);
    } catch (e) {
      if (e instanceof PlatformSecretError || e instanceof SystemKeyError) {
        await respond(ctxt, e.status, { errors: [e.message] });
        return;
      }
      if (e instanceof BodyTooLarge) {
        await respond(ctxt, 413, {
          errors: [
            `the body is larger than ${MAX_SYSTEM_KEY_BODY_BYTES} bytes`,
          ],
        });
        return;
      }
      throw e;
    }
  };
}

export function handleListPlatformSecrets({ dbAdapter }: CreateRoutesArgs) {
  return handle(async () => ({
    status: 200,
    body: { secrets: await listPlatformSecrets(dbAdapter) },
  }));
}

export function handleShowPlatformSecret({ dbAdapter }: CreateRoutesArgs) {
  return handle(async (ctxt) => ({
    status: 200,
    body: { secret: await getPlatformSecret(dbAdapter, ctxt.params.name) },
  }));
}

// Body: `value` and `note`. Answers 201 when it added the secret and 200 when
// it replaced the value of one that was set.
export function handleSetPlatformSecret({ dbAdapter }: CreateRoutesArgs) {
  return handle(async (ctxt) => {
    let body = await readJSONBody(ctxt);
    let { secret, added } = await setPlatformSecret(dbAdapter, {
      name: ctxt.params.name,
      value: body.value,
      note: body.note,
      caller: operatorCaller(ctxt),
    });
    return { status: added ? 201 : 200, body: { secret } };
  });
}

// Body: `note`.
export function handleDeletePlatformSecret({ dbAdapter }: CreateRoutesArgs) {
  return handle(async (ctxt) => {
    let body = await readJSONBody(ctxt);
    let secret = await deletePlatformSecret(dbAdapter, ctxt.params.name, {
      note: body.note,
      caller: operatorCaller(ctxt),
    });
    return { status: 200, body: { deleted: secret } };
  });
}
