import type {
  HostedIdentityProof,
  HostedIdentityVerifier,
} from './hosted-identity.ts';
import type { LocalIdentityBinding } from './local-identity-grant.ts';
import type { LocalIdentityStore } from './local-identity-store.ts';

export type LocalIdentityResolution =
  | { kind: 'unlinked'; localUserId: string }
  | { kind: 'verified'; binding: LocalIdentityBinding }
  | { kind: 'requires-verification'; localUserId: string };

function localAccount(
  value: unknown,
  fields: string[],
): { localUserId: string; proof: HostedIdentityProof } {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((key) => !fields.includes(key)) ||
    !('localUserId' in value) ||
    typeof value.localUserId !== 'string' ||
    !('localProof' in value) ||
    !value.localProof ||
    typeof value.localProof !== 'object' ||
    Array.isArray(value.localProof) ||
    !('matrixServerName' in value.localProof) ||
    typeof value.localProof.matrixServerName !== 'string' ||
    !('openIdToken' in value.localProof) ||
    typeof value.localProof.openIdToken !== 'string' ||
    Object.keys(value.localProof).length !== 2 ||
    !/^@[^:\s]+:[^\s/]+$/.test(value.localUserId) ||
    value.localUserId.length > 255 ||
    !value.localProof.openIdToken ||
    value.localProof.openIdToken.length > 8192
  )
    throw new Error('Invalid local identity proof');
  return {
    localUserId: value.localUserId,
    proof: {
      matrixServerName: value.localProof.matrixServerName,
      openIdToken: value.localProof.openIdToken,
    },
  };
}

export function createLocalIdentityBroker(options: {
  store: LocalIdentityStore;
  localVerifier: HostedIdentityVerifier;
}) {
  const { store, localVerifier } = options;
  async function resolveVerifiedLocalAccount(
    localUserId: string,
    now: number,
  ): Promise<LocalIdentityResolution> {
    if (!(await store.isLinked(localUserId)))
      return { kind: 'unlinked', localUserId };
    const binding = await store.resolve(localUserId, now);
    return binding
      ? { kind: 'verified', binding }
      : { kind: 'requires-verification', localUserId };
  }
  return {
    resolveVerifiedLocalAccount,
    async link(request: unknown, now: number): Promise<LocalIdentityBinding> {
      const { localUserId, proof } = localAccount(request, [
        'localUserId',
        'localProof',
        'hostedUserId',
        'hostedProof',
      ]);
      if (
        !request ||
        typeof request !== 'object' ||
        !('hostedUserId' in request) ||
        typeof request.hostedUserId !== 'string' ||
        !('hostedProof' in request) ||
        !request.hostedProof ||
        typeof request.hostedProof !== 'object' ||
        Array.isArray(request.hostedProof) ||
        !('matrixServerName' in request.hostedProof) ||
        typeof request.hostedProof.matrixServerName !== 'string' ||
        !('openIdToken' in request.hostedProof) ||
        typeof request.hostedProof.openIdToken !== 'string' ||
        Object.keys(request.hostedProof).length !== 2 ||
        !/^@[^:\s]+:[^\s/]+$/.test(request.hostedUserId) ||
        request.hostedUserId.length > 255 ||
        !request.hostedProof.openIdToken ||
        request.hostedProof.openIdToken.length > 8192
      )
        throw new Error('Invalid hosted identity proof');
      const binding = { localUserId, hostedUserId: request.hostedUserId };
      const hostedProof = {
        matrixServerName: request.hostedProof.matrixServerName,
        openIdToken: request.hostedProof.openIdToken,
      };
      if ((await localVerifier.verify(proof, localUserId)) !== localUserId)
        throw new Error('Cannot verify local identity');
      return store.link(binding, hostedProof, now);
    },
    async resolve(
      request: unknown,
      now: number,
    ): Promise<LocalIdentityResolution> {
      const { localUserId, proof } = localAccount(request, [
        'localUserId',
        'localProof',
      ]);
      if ((await localVerifier.verify(proof, localUserId)) !== localUserId)
        throw new Error('Cannot verify local identity');
      return resolveVerifiedLocalAccount(localUserId, now);
    },
  };
}
