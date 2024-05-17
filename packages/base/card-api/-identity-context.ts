import { initSharedState } from '../shared-state';
import { type BaseDef } from './-base-def';
import { type CardDef } from './-card-def';

export const identityContexts = initSharedState(
  'identityContexts',
  () => new WeakMap<BaseDef, IdentityContext>(),
);

export class IdentityContext {
  readonly identities = new Map<string, CardDef>();
}
