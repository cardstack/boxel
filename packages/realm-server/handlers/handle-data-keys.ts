import type Koa from 'koa';
import { SupportedMimeType } from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware/index.ts';
import {
  dataKeyStatus,
  ResealPass,
  secretsKeyring,
  type ResealOptions,
} from '../lib/secrets-at-rest/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';

// The operator endpoints for rotating the data key, reached with an operator
// token for `data-keys`. They report key ids and row counts, never a value.

let resealPass = new ResealPass();
let resealOptions: Omit<ResealOptions, 'signal'> = {};

// Test affordances: tune or hold the pass, and stop it between tests.
export function configureResealPass(
  options: Omit<ResealOptions, 'signal'>,
): void {
  resealOptions = options;
}

export async function resetResealPass(): Promise<void> {
  await resealPass.stop();
  resealPass = new ResealPass();
  resealOptions = {};
}

export function currentResealPass(): ResealPass {
  return resealPass;
}

async function respond(
  ctxt: Koa.Context,
  status: number,
  body: unknown,
): Promise<void> {
  await setContextResponse(
    ctxt,
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { 'content-type': SupportedMimeType.JSON },
    }),
  );
}

// Where the rotation stands: the data keys this process loaded, the rows each
// one sealed, which keys can be retired, and this process's re-seal pass.
export function handleDataKeyStatus({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context) {
    let status = await dataKeyStatus(dbAdapter, secretsKeyring());
    await respond(ctxt, 200, { ...status, pass: resealPass.state });
  };
}

// Starts a re-seal pass in the background on this process, unless one is
// running, and answers straight away. The caller names the data key it expects
// to be current (`?currentKeyId=`). A process whose current key differs, such
// as one still on the previous revision mid-deploy, answers 409 rather than
// re-sealing rows under the key the rotation is moving away from.
export function handleDataKeyReseal({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context) {
    let keyring = secretsKeyring();
    let expected = ctxt.URL.searchParams.get('currentKeyId');
    if (!expected) {
      await respond(ctxt, 400, {
        errors: ['name the data key expected to be current as ?currentKeyId='],
      });
      return;
    }
    if (expected !== keyring.currentKeyId) {
      await respond(ctxt, 409, {
        errors: [
          `this server's current data key is ${keyring.currentKeyId}, not ${expected}`,
        ],
        currentKeyId: keyring.currentKeyId,
      });
      return;
    }
    let started = resealPass.start(dbAdapter, keyring, resealOptions);
    await respond(ctxt, 202, { started, pass: resealPass.state });
  };
}
