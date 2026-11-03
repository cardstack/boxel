import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import type {
  HostedIdentityProof,
  HostedIdentityVerifier,
} from './hosted-identity.ts';

export interface LocalIdentityGrantPolicy {
  deviceId: string;
  stackId: string;
  localMatrixServerName: string;
  maxOfflineSeconds: number | null;
}

export interface LocalIdentityBinding {
  hostedUserId: string;
  localUserId: string;
}

interface Grant extends LocalIdentityBinding {
  version: 1;
  issuer: 'boxel-local-identity';
  deviceId: string;
  stackId: string;
  issuedAt: number;
  expiresAt: number | null;
}

function userServer(value: string): string | undefined {
  if (value.length > 255 || !/^@[^:\s]+:[^\s/]+$/.test(value)) return;
  return value.slice(value.indexOf(':') + 1);
}

function validatePolicy(policy: LocalIdentityGrantPolicy): void {
  if (
    !/^[A-Za-z0-9_-]{16,128}$/.test(policy.deviceId) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(policy.stackId) ||
    !policy.localMatrixServerName ||
    /[\s/@]/.test(policy.localMatrixServerName) ||
    (policy.maxOfflineSeconds !== null &&
      (!Number.isSafeInteger(policy.maxOfflineSeconds) ||
        policy.maxOfflineSeconds <= 0))
  )
    throw new Error('Invalid native identity grant policy');
}

function validBinding(
  binding: LocalIdentityBinding,
  policy: LocalIdentityGrantPolicy,
): boolean {
  const hostedServer = userServer(binding.hostedUserId);
  return Boolean(
    hostedServer &&
    hostedServer !== policy.localMatrixServerName &&
    userServer(binding.localUserId) === policy.localMatrixServerName,
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseGrant(value: unknown): Grant | undefined {
  if (
    !record(value) ||
    Object.keys(value).length !== 8 ||
    value.version !== 1 ||
    value.issuer !== 'boxel-local-identity' ||
    typeof value.hostedUserId !== 'string' ||
    typeof value.localUserId !== 'string' ||
    typeof value.deviceId !== 'string' ||
    typeof value.stackId !== 'string' ||
    typeof value.issuedAt !== 'number' ||
    !Number.isSafeInteger(value.issuedAt) ||
    value.issuedAt <= 0 ||
    !(
      value.expiresAt === null ||
      (typeof value.expiresAt === 'number' &&
        Number.isSafeInteger(value.expiresAt) &&
        value.expiresAt > value.issuedAt)
    )
  )
    return;
  return {
    version: 1,
    issuer: 'boxel-local-identity',
    hostedUserId: value.hostedUserId,
    localUserId: value.localUserId,
    deviceId: value.deviceId,
    stackId: value.stackId,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  };
}

export function createLocalIdentityGrantIssuer(options: {
  privateKey: KeyObject;
  policy: LocalIdentityGrantPolicy;
  hostedVerifier: HostedIdentityVerifier;
}) {
  const policy = { ...options.policy };
  validatePolicy(policy);
  if (
    options.privateKey.type !== 'private' ||
    options.privateKey.asymmetricKeyType !== 'ed25519'
  )
    throw new Error('Native identity grants require an Ed25519 private key');
  const privateKey = options.privateKey;
  const hostedVerifier = options.hostedVerifier;
  return {
    publicKey: createPublicKey(privateKey),
    async issue(
      binding: LocalIdentityBinding,
      proof: HostedIdentityProof,
      now: number,
    ): Promise<string> {
      const identity = { ...binding };
      const identityProof = { ...proof };
      if (
        !Number.isSafeInteger(now) ||
        now <= 0 ||
        !validBinding(identity, policy)
      )
        throw new Error('Cannot issue native identity grant');
      const subject = await hostedVerifier.verify(
        identityProof,
        identity.hostedUserId,
      );
      if (subject !== identity.hostedUserId)
        throw new Error('Cannot verify hosted identity');
      const expiresAt =
        policy.maxOfflineSeconds === null
          ? null
          : now + policy.maxOfflineSeconds;
      if (expiresAt !== null && !Number.isSafeInteger(expiresAt))
        throw new Error('Invalid native identity expiry');
      const grant: Grant = {
        version: 1,
        issuer: 'boxel-local-identity',
        hostedUserId: subject,
        localUserId: identity.localUserId,
        deviceId: policy.deviceId,
        stackId: policy.stackId,
        issuedAt: now,
        expiresAt,
      };
      const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
      return (
        payload +
        '.' +
        sign(null, Buffer.from(payload), privateKey).toString('base64url')
      );
    },
  };
}

export function createLocalIdentityGrantVerifier(options: {
  publicKey: KeyObject;
  policy: LocalIdentityGrantPolicy;
}) {
  const policy = { ...options.policy };
  validatePolicy(policy);
  const publicKey = options.publicKey;
  if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519')
    throw new Error('Native identity grants require an Ed25519 public key');
  return {
    verify(
      token: unknown,
      localUserId: string,
      now: number,
    ): LocalIdentityBinding | undefined {
      if (
        typeof token !== 'string' ||
        token.length > 4096 ||
        !Number.isSafeInteger(now) ||
        now <= 0
      )
        return;
      const pieces = token.split('.');
      if (pieces.length !== 2) return;
      const [payload, signature] = pieces;
      if (
        !payload ||
        !signature ||
        !/^[A-Za-z0-9_-]+$/.test(payload) ||
        !/^[A-Za-z0-9_-]{86}$/.test(signature)
      )
        return;
      try {
        const signatureBytes = Buffer.from(signature, 'base64url');
        if (
          signatureBytes.toString('base64url') !== signature ||
          !verify(null, Buffer.from(payload), publicKey, signatureBytes)
        )
          return;
        const bytes = Buffer.from(payload, 'base64url');
        if (bytes.toString('base64url') !== payload) return;
        const grant = parseGrant(JSON.parse(bytes.toString('utf8')));
        if (
          !grant ||
          grant.deviceId !== policy.deviceId ||
          grant.stackId !== policy.stackId ||
          grant.localUserId !== localUserId ||
          !validBinding(grant, policy) ||
          grant.issuedAt > now ||
          (grant.expiresAt !== null && grant.expiresAt <= now) ||
          (policy.maxOfflineSeconds !== null &&
            (grant.expiresAt === null ||
              grant.expiresAt - grant.issuedAt > policy.maxOfflineSeconds))
        )
          return;
        return {
          hostedUserId: grant.hostedUserId,
          localUserId: grant.localUserId,
        };
      } catch {
        return;
      }
    },
  };
}
