// Who a request that authenticated nobody writes as.
//
// A grant that opts a write in to callers who aren't signed in names a key in
// the governed realm's `realm.json` `config` (`CompiledOperationGrant
// .anonymous.actingUserKey`), and the user that key holds is who the write is
// made as: the index job it starts, and every record of it, name that user.
// The key is read when the write is decided, not when the policy compiles, so
// changing the config, removing the key, or the user losing write takes effect
// on the next write, without the policy card changing.
//
// A grant whose key doesn't resolve to a Matrix user who may write the realm
// admits nothing. The caller is refused as though the grant weren't there,
// rather than let through as nobody, and why is kept for the request's records.

// What a grant's acting-user key resolves to: the user, or why no write may be
// made as anyone through it.
export type ActingUserResolution =
  | { user: string }
  | { failure: ActingUserFailure };

// - `key-missing`: the realm's config holds no string under the key.
// - `not-a-matrix-id`: it holds something that isn't a Matrix user id.
// - `no-write`: the user it names may not write the realm.
export type ActingUserFailure = 'key-missing' | 'not-a-matrix-id' | 'no-write';

// The acting users of one request, resolved once per key however many of its
// writes name it, and the users its admitted writes were made as, in the order
// they were admitted.
export class ActingUsers {
  #resolve: (key: string) => Promise<ActingUserResolution>;
  #resolved = new Map<string, Promise<ActingUserResolution>>();
  #admitted: string[] = [];
  #failures: { key: string; failure: ActingUserFailure }[] = [];

  constructor(resolve: (key: string) => Promise<ActingUserResolution>) {
    this.#resolve = resolve;
  }

  async resolve(key: string): Promise<ActingUserResolution> {
    let resolved = this.#resolved.get(key);
    if (!resolved) {
      resolved = this.#resolve(key).then((resolution) => {
        if ('failure' in resolution) {
          this.#failures.push({ key, failure: resolution.failure });
        }
        return resolution;
      });
      this.#resolved.set(key, resolved);
    }
    return await resolved;
  }

  // Records that a write was admitted through a grant naming `key`.
  async admittedThrough(key: string): Promise<void> {
    let resolution = await this.resolve(key);
    if ('user' in resolution) {
      this.#admitted.push(resolution.user);
    }
  }

  // The users the request's admitted writes were made as, first admitted
  // first, each once.
  get admitted(): string[] {
    return [...new Set(this.#admitted)];
  }

  // Why grants that would otherwise have admitted one of the request's
  // writes didn't, each key once.
  get failures(): readonly { key: string; failure: ActingUserFailure }[] {
    return this.#failures;
  }
}

// Unresolvable: a realm that supplies no way to resolve acting users admits no
// write by a caller who isn't signed in.
export const NO_ACTING_USER = async (): Promise<ActingUserResolution> => ({
  failure: 'key-missing',
});
