import type { CompiledOperationGrant } from './policy.ts';
import type { ActingUserFailure } from './types.ts';

// A request that authenticated nobody, as its grants judge it.
//
// The realm admits such a request only through grants whose `where` names the
// caller who isn't signed in, and of those only the ones whose blocklist and
// rate limit let the caller's address in (see `AnonymousAdmission`). This
// holds which those are for the request, so every invocation it makes is
// judged by them alone, and records which grant admitted it, so the request is
// counted against that grant's limit.
//
// It also settles who the request's writes are made as. A grant on a write
// names that user with its `actingUser` expression, which reads the governed
// realm's `realm.json` `config`, the policy card's fields, and the card the
// write is made to. The expression is evaluated when the write is decided,
// not when the policy compiles, so changing the config, the user losing
// write, or the target changing takes effect on the next write without the
// policy card changing. The index job a write starts, and every record of
// it, name that user.
//
// A grant whose acting user doesn't resolve to a Matrix user who may write
// the realm admits nothing. The caller is refused as though the grant weren't
// there, rather than let through as nobody, and why is kept for the request's
// records.

export type { ActingUserFailure };

// Who a grant's `actingUser` names for one write, or why no write may be made
// as anyone through it.
export type ActingUserResolution =
  | { user: string }
  | { failure: ActingUserFailure };

// Evaluates a grant's `actingUser` for a write to `instance`, the card the
// write is judged by, and checks what it names.
export type ActingUserResolver = (
  grant: CompiledOperationGrant,
  instance: Record<string, unknown> | undefined,
) => Promise<ActingUserResolution>;

export class AnonymousRequest {
  #resolve: ActingUserResolver;
  #eligible: ReadonlySet<string> | undefined;
  // An expression that doesn't read the target names the same user for every
  // write of the request, so it is resolved once per grant.
  #resolved = new Map<string, Promise<ActingUserResolution>>();
  // An expression that reads the target is settled once for each target while
  // its write is being decided. The gate uses that same resolution to admit
  // the write and to record the user it is made as.
  #resolvedForInstance = new WeakMap<
    Record<string, unknown>,
    Map<string, Promise<ActingUserResolution>>
  >();
  #lastResolved = new Map<string, ActingUserResolution>();
  #admitted: string[] = [];
  #admittedGrants: string[] = [];
  #failures: { grant: string; failure: ActingUserFailure }[] = [];

  // `eligible` holds the ids of the grants the caller's address may be
  // admitted through. Without it, every grant that opens anything to such
  // callers may admit them.
  constructor(resolve: ActingUserResolver, eligible?: ReadonlySet<string>) {
    this.#resolve = resolve;
    this.#eligible = eligible;
  }

  // Whether `grant` may admit this request.
  admits(grant: CompiledOperationGrant): boolean {
    let id = grant.anonymous?.id;
    return (
      id !== undefined &&
      (this.#eligible === undefined || this.#eligible.has(id))
    );
  }

  async actingUser(
    grant: CompiledOperationGrant,
    instance: Record<string, unknown> | undefined,
  ): Promise<ActingUserResolution> {
    let expression = grant.anonymous?.actingUser;
    let key = expression ? grant.path : undefined;
    let readsInstance = expression?.readsInstance ?? false;
    let resolved =
      key && !readsInstance
        ? this.#resolved.get(key)
        : key && instance
          ? this.#resolvedForInstance.get(instance)?.get(key)
          : undefined;
    if (!resolved) {
      resolved = this.#resolve(grant, instance).then((resolution) => {
        this.#lastResolved.set(grant.path, resolution);
        if (
          'failure' in resolution &&
          !this.#failures.some(({ grant: path }) => path === grant.path)
        ) {
          this.#failures.push({
            grant: grant.path,
            failure: resolution.failure,
          });
        }
        return resolution;
      });
      if (key && !readsInstance) {
        this.#resolved.set(key, resolved);
      } else if (key && instance) {
        let perInstance = this.#resolvedForInstance.get(instance);
        if (!perInstance) {
          perInstance = new Map();
          this.#resolvedForInstance.set(instance, perInstance);
        }
        perInstance.set(key, resolved);
      }
    }
    return await resolved;
  }

  // Records that `grant` admitted one of the request's invocations, and for a
  // write, the user it is made as.
  async admittedThrough(
    grant: CompiledOperationGrant,
    instance?: Record<string, unknown>,
  ): Promise<void> {
    let id = grant.anonymous?.id;
    if (id !== undefined && !this.#admittedGrants.includes(id)) {
      this.#admittedGrants.push(id);
    }
    if (grant.anonymous?.actingUser) {
      let resolution = await this.actingUser(grant, instance);
      if ('user' in resolution) {
        this.#admitted.push(resolution.user);
      }
    }
  }

  // The users the request's admitted writes were made as, first admitted
  // first, each once.
  get admitted(): string[] {
    return [...new Set(this.#admitted)];
  }

  // The ids of the grants that admitted the request's invocations, first
  // admitted first.
  get admittedGrants(): readonly string[] {
    return this.#admittedGrants;
  }

  // Why grants that would otherwise have admitted one of the request's
  // writes didn't, each grant once, by its path in the policy card.
  get failures(): readonly { grant: string; failure: ActingUserFailure }[] {
    return this.#failures;
  }

  // What `grant`'s acting user last resolved to for this request, where it
  // was asked.
  lastActingUser(
    grant: CompiledOperationGrant,
  ): ActingUserResolution | undefined {
    return this.#lastResolved.get(grant.path);
  }
}

// Unresolvable: a realm that supplies no way to resolve acting users admits no
// write by a caller who isn't signed in.
export const NO_ACTING_USER: ActingUserResolver = async () => ({
  failure: 'expression-failed',
});
