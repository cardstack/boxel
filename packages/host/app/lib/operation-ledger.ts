import { Deferred, OperationsError } from '@cardstack/runtime-common';

import type {
  OperationsAnswer,
  OperationsEnvelope,
  OperationWriteResult,
  OptimisticCandidate,
} from '@cardstack/runtime-common';

import type { CardDef } from '@cardstack/base/card-api';

// ============================================================================
// Applying an operation before the realm has answered, and putting it right
// when the realm disagrees.
//
// A named operation that rearranges a card's own stored values — append this
// comment, set that status — can be carried out locally the moment it is
// invoked, because the work is a BXL program and the client can run the very
// program the realm will run, over the very document the realm will read. That
// is the whole basis for showing the result at once: not a guess about what
// the server will do, but the same computation over the same input.
//
// Which is also the basis for how it is taken back. The realm reports whether
// it executed from the source version the client named (`baseMatched`). Same
// program, same base, deterministic program ⇒ same result, so the entry is
// retired and nothing is re-read. Anything else — a different base, a refusal,
// or a realm that reported nothing at all — means the local state is not
// something this client can vouch for, so the card is re-read from the realm
// and the operations queued behind it are rejected rather than replayed.
//
// The rule that makes it safe is that only `true` confirms. An absent
// `baseMatched` is a realm that was asked nothing (the client had no version
// to name) or a realm that does not answer; neither is agreement, and reading
// silence as agreement is the one failure mode here with no symptom — local
// state quietly diverging from the realm with nothing left to correct it.
//
// Nothing here decides *whether* a call is eligible on its own. The client
// core rules out everything it can see from the call (see `OptimisticCandidate`);
// this adds what only the session knows — that a store is holding the target,
// that the declaration lowers, and that what it lowers to is deterministic —
// and answers `undefined` when any of it fails, which sends the batch exactly
// as it would have been sent before this file existed.
// ============================================================================

// What the ledger cannot do for itself. The store, the loader and the BXL
// adapter are all the host's; what is here is the ordering and the
// reconciliation, which is the part worth being able to test without any of
// them.
export interface LedgerEnvironment {
  // The card this session is holding for an id, or nothing. Synchronous
  // deliberately: it is the first thing asked, and a call for a card nobody is
  // holding should cost no more than a map lookup before falling through.
  held(id: string): CardDef | undefined;
  // How the store names this instance for locking. The same key a save takes,
  // so an operation and an autosave of one card queue against each other.
  localId(instance: CardDef): string;
  // The operation as the realm stored it, lowered here from the same
  // declaration by the same function. `undefined` when it cannot be lowered,
  // which is a reason to send pessimistically and never a reason to fail.
  lower(instance: CardDef, name: string): Promise<LoweredOperation | undefined>;
  // Run the program over the instance's own stored source and put the result
  // back on the instance. Throws when the program cannot run here — which is
  // how a program that reads what only the realm's index overlay can supply
  // takes the pessimistic path instead of inventing a value.
  applyLocally(
    instance: CardDef,
    operation: LoweredOperation,
    params: Record<string, unknown> | undefined,
  ): Promise<void>;
  // Re-read the card from the realm, discarding local state.
  reload(instance: CardDef): Promise<void>;
  // The version this session believes the card's stored bytes carry, and how
  // to record a new one. Both go through the store, which is where the rules
  // that read a version to suppress a reload also live.
  heldVersion(instance: CardDef): string | undefined;
  recordVersion(instance: CardDef, version: string): void;
  // Serializes against the store's own writes of the same card.
  withLock<T>(localId: string, fn: () => Promise<T>): Promise<T>;
  // The realm round trip.
  send(
    realmURL: string,
    envelope: OperationsEnvelope,
    clientRequestId: string,
  ): Promise<OperationsAnswer>;
  // Names the base version on an envelope's single entry.
  stamp(envelope: OperationsEnvelope, baseVersion: string): OperationsEnvelope;
  // Reads the write result out of an answer, or nothing when the answer does
  // not carry one.
  writeResult(answer: OperationsAnswer): OperationWriteResult | undefined;
  // Fires when the store re-reads a card, whoever caused it. What a foreign
  // write looks like from here.
  onReload(cb: (instance: CardDef) => void): () => void;
}

// The part of a lowered operation the ledger reads.
export interface LoweredOperation {
  deterministic: boolean;
  invalid?: true;
  program?: { source: string; syntax: 'readable' | 'solidified' };
}

interface LedgerEntry {
  clientRequestId: string;
  realmURL: string;
  envelope: OperationsEnvelope;
  operation: LoweredOperation;
  params: Record<string, unknown> | undefined;
  instance: CardDef;
  // Whether this entry has gone to the realm. Only an unsent entry is rebased
  // onto a foreign write; a sent one is answered by its own `baseMatched`.
  sent: boolean;
  settled: Deferred<OperationsAnswer>;
}

// One card's pending work.
//
// Two orderings, and they are deliberately different promises. Local
// application is ordered so that three appends land in the order they were
// asked for and the card shows all three at once; sending is ordered so that
// each write names its predecessor's returned version. Folding them into one
// chain would make the second append appear only after the first had been
// written and answered, which is the latency this exists to hide.
interface Chain {
  // Entries applied locally and not yet retired, oldest first. Membership is
  // also what says an entry is still live: an abort takes every entry it
  // cancels out of this list, and the send chain refuses anything it no longer
  // holds. A flag would have to be cleared, and clearing it correctly means
  // knowing when the last cancelled entry has drained off the send chain —
  // which is the same question membership answers directly.
  pending: LedgerEntry[];
  // The version the next entry writes on top of: the last one the realm
  // reported for this card. Cleared when the card is re-read, since a version
  // this client was told no longer describes what the card now holds.
  version: string | undefined;
  applying: Promise<unknown>;
  sending: Promise<unknown>;
}

const settledPromise = Promise.resolve();
const ignore = () => {};

export default class OperationLedger {
  #env: LedgerEnvironment;
  // One chain per card this session has ever run an operation against. Kept
  // rather than deleted when it empties: the two promises are what order a
  // later operation against the ones still draining, and dropping the entry
  // while either is unsettled would let the next call overtake them. What is
  // retained is an empty array and two settled promises per card operated on.
  #chains: Map<string, Chain> = new Map();
  #unsubscribe: () => void;

  constructor(env: LedgerEnvironment) {
    this.#env = env;
    this.#unsubscribe = env.onReload((instance) => this.#rebase(instance));
  }

  teardown() {
    this.#unsubscribe();
  }

  // Carry this call optimistically, or answer `undefined` to say it should be
  // sent the way it always has been.
  //
  // Everything that decides eligibility happens before anything is applied or
  // sent, and the program runs against a *copy* of the card's source — so
  // every way this can decline leaves the instance untouched and the realm
  // unasked. There is no partial state to unwind.
  async attempt(args: {
    realmURL: string;
    envelope: OperationsEnvelope;
    candidate: OptimisticCandidate;
    clientRequestId: string;
  }): Promise<OperationsAnswer | undefined> {
    let instance = this.#env.held(args.candidate.id);
    if (!instance) {
      return undefined;
    }
    let key = this.#env.localId(instance);
    let chain = this.#chainFor(key);
    // Reserved synchronously, before the first `await` below, so the order
    // entries are applied in is the order the calls were made in rather than
    // the order their lowering happened to resolve in.
    let prepared = chain.applying.then(() =>
      this.#prepare(chain, instance, args),
    );
    chain.applying = prepared.then(ignore, ignore);
    let entry = await prepared;
    if (!entry) {
      return undefined;
    }
    return await entry.settled.promise;
  }

  // Decide the rest of eligibility, apply the program locally, and take a
  // place in the send order. Runs one card at a time.
  async #prepare(
    chain: Chain,
    instance: CardDef,
    args: {
      realmURL: string;
      envelope: OperationsEnvelope;
      candidate: OptimisticCandidate;
      clientRequestId: string;
    },
  ): Promise<LedgerEntry | undefined> {
    let operation: LoweredOperation | undefined;
    try {
      operation = await this.#env.lower(instance, args.candidate.name);
    } catch (err: unknown) {
      // Deciding whether this *can* be optimistic is not work the caller asked
      // for, so a failure in it is not a failure of their operation. Nothing
      // has been applied or sent at this point, so declining costs the call
      // only the pessimistic path it would have taken anyway.
      console.debug(
        `could not decide optimistic eligibility for "${args.candidate.name}", so it is sent and awaited`,
        err,
      );
      return undefined;
    }
    if (
      !operation ||
      operation.invalid ||
      !operation.program ||
      // A program whose value moves between runs would land one answer here
      // and another on the realm, and `baseMatched` would then confirm a
      // result that does not match — a conflict reported on a card nobody
      // else touched. Refused rather than reconciled.
      !operation.deterministic
    ) {
      return undefined;
    }
    let entry: LedgerEntry = {
      clientRequestId: args.clientRequestId,
      realmURL: args.realmURL,
      envelope: args.envelope,
      operation,
      params: args.candidate.params,
      instance,
      sent: false,
      settled: new Deferred<OperationsAnswer>(),
    };
    try {
      await this.#env.applyLocally(instance, operation, entry.params);
    } catch (err: unknown) {
      // The program could not run here — most often because it reads a value
      // only the realm's index overlay supplies. Nothing was applied, so this
      // is simply not an optimistic call.
      console.debug(
        `operation "${args.candidate.name}" is not applied locally, so it is sent and awaited: ${
          (err as Error)?.message ?? String(err)
        }`,
      );
      return undefined;
    }
    chain.pending.push(entry);
    let sent = chain.sending.then(() => this.#deliver(chain, entry));
    chain.sending = sent.then(ignore, ignore);
    // Nothing awaits `sent` here: the caller awaits the entry's own deferred,
    // and an entry rejected by a predecessor's failure settles through the
    // cascade rather than through this chain.
    sent.then(
      (answer) => entry.settled.fulfill(answer),
      (err) => entry.settled.reject(err),
    );
    return entry;
  }

  // Send one entry and reconcile what comes back. Runs after every entry
  // queued ahead of it on this card has settled.
  async #deliver(chain: Chain, entry: LedgerEntry): Promise<OperationsAnswer> {
    if (!chain.pending.includes(entry)) {
      // Cancelled while it waited its turn: something ahead of it failed, or
      // reconciled against a base the realm had moved past, and this entry's
      // local effect went with the re-read that followed. Its caller has
      // already been told; this is the send not happening.
      throw precedingFailed();
    }
    return await this.#env.withLock(
      this.#env.localId(entry.instance),
      async () => {
        // Read here rather than when the entry was queued: a foreign write in
        // between re-read the card and cleared the chain's version, and the
        // base this write names has to describe the bytes it was actually
        // computed over.
        let baseVersion =
          chain.version ?? this.#env.heldVersion(entry.instance);
        let envelope = baseVersion
          ? this.#env.stamp(entry.envelope, baseVersion)
          : entry.envelope;
        entry.sent = true;
        let answer: OperationsAnswer;
        try {
          answer = await this.#env.send(
            entry.realmURL,
            envelope,
            entry.clientRequestId,
          );
        } catch (err: unknown) {
          await this.#abort(chain, entry);
          throw err;
        }
        let result = this.#env.writeResult(answer);
        if (result?.baseMatched === true) {
          chain.version = result.version;
          this.#env.recordVersion(entry.instance, result.version);
          this.#retire(chain, entry);
          return answer;
        }
        // The write landed either way — a moved base is not a refusal — so
        // this entry's own call succeeds. What did not survive is the claim
        // that local state equals the result, so the card is re-read and the
        // entries queued behind it, which were computed on top of state that
        // is now gone, are rejected.
        await this.#abort(chain, entry);
        return answer;
      },
    );
  }

  // Put the card back on authoritative state and fail everything still queued.
  async #abort(chain: Chain, entry: LedgerEntry): Promise<void> {
    this.#retire(chain, entry);
    let stranded = chain.pending.splice(0, chain.pending.length);
    // Cleared before the re-read rather than after: a version this client was
    // told describes bytes the card is about to stop holding.
    chain.version = undefined;
    for (let queued of stranded) {
      queued.settled.reject(precedingFailed());
    }
    try {
      await this.#env.reload(entry.instance);
    } catch (err: unknown) {
      // The correction could not be fetched. Nothing here can put the card
      // right, and saying so is better than leaving the caller believing the
      // rollback happened.
      console.error(
        `could not re-read ${entry.instance.id} after an operation reconciled against a base the realm had moved past`,
        err,
      );
    }
  }

  #retire(chain: Chain, entry: LedgerEntry) {
    let at = chain.pending.indexOf(entry);
    if (at !== -1) {
      chain.pending.splice(at, 1);
    }
  }

  // A card was re-read. Whatever it now holds is the realm's, so every unsent
  // entry's local effect went with it and has to be applied again — they are
  // relative programs, so an append still appends — and the version chain
  // starts over from whatever the fresh state carries.
  //
  // An entry already in flight is left alone. It is answered by its own
  // `baseMatched`, which is the only thing that can say whether the realm ran
  // it before or after the write that caused this.
  #rebase(instance: CardDef) {
    let chain = this.#chains.get(this.#env.localId(instance));
    if (!chain || chain.pending.length === 0) {
      return;
    }
    chain.version = undefined;
    let unsent = chain.pending.filter((entry) => !entry.sent);
    if (unsent.length === 0) {
      return;
    }
    chain.applying = chain.applying.then(async () => {
      for (let entry of unsent) {
        if (entry.sent || !chain.pending.includes(entry)) {
          // Sent while the re-read was being applied, or cancelled by
          // something ahead of it. Either way this is not an entry whose local
          // effect is this chain's to restore.
          continue;
        }
        try {
          await this.#env.applyLocally(instance, entry.operation, entry.params);
        } catch (err: unknown) {
          // The program no longer runs against what the card now holds — an
          // assertion this state does not satisfy, say. It cannot be shown
          // locally and it must not be sent as though it had been, so it is
          // failed here and the queue behind it goes with it.
          await this.#abort(chain, entry);
          entry.settled.reject(err as Error);
          return;
        }
      }
    }, ignore);
  }

  #chainFor(key: string): Chain {
    let chain = this.#chains.get(key);
    if (!chain) {
      chain = {
        pending: [],
        version: undefined,
        applying: settledPromise,
        sending: settledPromise,
      };
      this.#chains.set(key, chain);
    }
    return chain;
  }
}

// What an operation queued behind a failed one reports. Named rather than
// generic because it says something a caller can act on: this operation was
// never carried out, nothing was written for it, and re-invoking it is a
// decision for the caller rather than something the client does on its own.
function precedingFailed(): OperationsError {
  return new OperationsError({
    status: 409,
    code: 'preceding-operation-failed',
    title: 'Preceding operation failed',
    detail:
      `an operation queued ahead of this one against the same card failed or ` +
      `was computed on a version the realm had moved past, so this one was ` +
      `not sent — the card has been re-read, and re-invoking is the caller's`,
  });
}
