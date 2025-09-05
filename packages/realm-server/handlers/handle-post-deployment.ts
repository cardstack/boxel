import Koa from 'koa';
import { SupportedMimeType } from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware';
import { type CreateRoutesArgs } from '../routes';
import { compareCurrentBoxelUIChecksum } from '../lib/boxel-ui-change-checker';

export default function handlePostDeployment({}: CreateRoutesArgs): (
  ctxt: Koa.Context,
  next: Koa.Next,
) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    // TODO: add auth before this
    let boxelUiChangeCheckerResult = compareCurrentBoxelUIChecksum();

    // TODO: schedule a reindex job if the checksum has changed
    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(boxelUiChangeCheckerResult, null, 2), {
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  };
}
