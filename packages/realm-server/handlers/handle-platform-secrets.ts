import type Koa from 'koa';
import {
  handle as handleOperatorRoute,
  operatorCaller,
  readJSONBody,
} from './handle-system-keys.ts';
import {
  deletePlatformSecret,
  getPlatformSecret,
  listPlatformSecrets,
  PlatformSecretError,
  setPlatformSecret,
} from '../lib/platform-secrets.ts';
import type { CreateRoutesArgs } from '../routes.ts';

// The operator endpoints for platform secrets, reached with an operator token
// for `platform-secrets`. A value goes in on a set and never comes back out:
// they report a secret's name, its data key and who last set it and when.

function handle(
  fn: (ctxt: Koa.Context) => Promise<{ status: number; body: unknown }>,
) {
  return handleOperatorRoute(fn, [PlatformSecretError]);
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
