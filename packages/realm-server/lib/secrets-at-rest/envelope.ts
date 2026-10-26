import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

// Seals a secret with AES-256-GCM under a data key the process holds in
// memory, so sealing and opening never leave the process. Each sealed value is
// bound to where it is stored and where it goes: the field it lives in, the
// owner, the row id and, for a secret sent to one place, the destination it
// is sent to go into the additional authenticated data, and, for a copy of a
// secret held in another row, that row's id. A database writer who moves a
// ciphertext to another column or row, re-pairs it with another destination,
// or points a copy at another original, gets a value that no longer opens.

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

// Changing what goes into the additional authenticated data changes this
// label, so a value sealed under one layout can never open under another. A
// binding that names a parent is laid out under its own label.
const AAD_LABEL = 'boxel-secret/v1';
const AAD_LABEL_WITH_PARENT = 'boxel-secret/v2-parent';

export interface DataKey {
  keyId: string;
  key: Buffer;
}

// What a sealed value is bound to. `field` names the column the value lives
// in, as `<table>.<column>`, so two secrets on one row (an OAuth client secret
// and its refresh token, say) can't be swapped for each other. `destination`
// is the place the secret is sent (for example an endpoint's URL); a secret
// with no destination of its own, such as a user's key, is bound to field,
// owner and id only. `parentId` names the row a copy was made from when the
// secret is held in two rows: a grant's copy of a user's key names the key, so
// it is bound to both the grant (`id`) and the key, and opens only on that
// grant of that key.
export interface SecretBinding {
  field: string;
  owner: string;
  id: string;
  parentId?: string;
  destination?: string;
}

// The owner of a secret the platform itself holds rather than a user or a
// realm, such as a vendor key `_request-forward` attaches. Matrix user ids
// start with `@` and realms are named by URL, so no user- or realm-owned
// secret can share this owner.
export const PLATFORM_SECRET_OWNER = 'boxel-platform';

// What a table stores for one secret.
export interface SealedSecret {
  keyId: string;
  nonce: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

// The context a sealed value is bound to. The destination appears only as its
// SHA-256, so the context is safe to log or to hand to a service that records
// it, such as CloudTrail.
export interface SecretEncryptionContext {
  field: string;
  owner: string;
  id: string;
  parent_id?: string;
  destination_sha256?: string;
}

export function secretEncryptionContext(
  binding: SecretBinding,
): SecretEncryptionContext {
  let context: SecretEncryptionContext = {
    field: binding.field,
    owner: binding.owner,
    id: binding.id,
  };
  if (binding.parentId !== undefined) {
    context.parent_id = binding.parentId;
  }
  if (binding.destination !== undefined) {
    context.destination_sha256 = createHash('sha256')
      .update(binding.destination, 'utf8')
      .digest('hex');
  }
  return context;
}

// Thrown whenever a value can't be opened: an unknown data key, a value moved
// to another binding, or tampered bytes. GCM can't tell those apart, and the
// message names none of the inputs.
export class SecretDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretDecryptionError';
  }
}

export class SecretsKeyring {
  #keys = new Map<string, Buffer>();
  #currentKeyId: string;

  constructor(keys: DataKey[], currentKeyId: string) {
    for (let { keyId, key } of keys) {
      if (key.length !== KEY_BYTES) {
        throw new Error(
          `Data key ${keyId} is ${key.length} bytes; AES-256-GCM needs ${KEY_BYTES}`,
        );
      }
      if (this.#keys.has(keyId)) {
        throw new Error(`Data key ${keyId} is listed more than once`);
      }
      this.#keys.set(keyId, Buffer.from(key));
    }
    if (!this.#keys.has(currentKeyId)) {
      throw new Error(
        `The current data key ${currentKeyId} is not among the loaded keys`,
      );
    }
    this.#currentKeyId = currentKeyId;
  }

  get currentKeyId(): string {
    return this.#currentKeyId;
  }

  get keyIds(): string[] {
    return [...this.#keys.keys()];
  }

  // Seals under the current data key with a fresh random nonce.
  seal(plaintext: string, binding: SecretBinding): SealedSecret {
    if (!binding.field) {
      throw new Error('A secret binding must name the field it is stored in');
    }
    let keyId = this.#currentKeyId;
    let nonce = randomBytes(NONCE_BYTES);
    let cipher = createCipheriv(ALGORITHM, this.#keys.get(keyId)!, nonce, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(additionalData(keyId, binding));
    let ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return { keyId, nonce, ciphertext, tag: cipher.getAuthTag() };
  }

  // Opens a value only under the binding it was sealed with.
  open(sealed: SealedSecret, binding: SecretBinding): string {
    let key = this.#keys.get(sealed.keyId);
    if (!key) {
      throw new SecretDecryptionError(
        `The secret was sealed under data key ${sealed.keyId}, which this process has not loaded`,
      );
    }
    if (
      sealed.nonce.length !== NONCE_BYTES ||
      sealed.tag.length !== TAG_BYTES
    ) {
      throw new SecretDecryptionError(
        'The secret could not be decrypted: its nonce or tag has the wrong length',
      );
    }
    try {
      let decipher = createDecipheriv(ALGORITHM, key, sealed.nonce, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(additionalData(sealed.keyId, binding));
      decipher.setAuthTag(sealed.tag);
      return Buffer.concat([
        decipher.update(sealed.ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new SecretDecryptionError(
        'The secret could not be decrypted: it was altered, or it is bound to a different field, owner, row, parent or destination',
      );
    }
  }

  // Opens a value under the binding it was sealed with and seals it again
  // under `to` with the current data key. Used to bind a secret to its
  // destination once it has one, and to move it onto a new data key.
  reseal(
    sealed: SealedSecret,
    from: SecretBinding,
    to: SecretBinding,
  ): SealedSecret {
    return this.seal(this.open(sealed, from), to);
  }
}

function additionalData(keyId: string, binding: SecretBinding): Buffer {
  let context = secretEncryptionContext(binding);
  return Buffer.from(
    JSON.stringify(
      context.parent_id === undefined
        ? [
            AAD_LABEL,
            keyId,
            context.field,
            context.owner,
            context.id,
            context.destination_sha256 ?? null,
          ]
        : [
            AAD_LABEL_WITH_PARENT,
            keyId,
            context.field,
            context.owner,
            context.id,
            context.parent_id,
            context.destination_sha256 ?? null,
          ],
    ),
    'utf8',
  );
}
