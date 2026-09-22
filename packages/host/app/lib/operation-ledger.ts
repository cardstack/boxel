import { Deferred, OperationsError } from '@cardstack/runtime-common';

import type {
  OperationsAnswer,
  OperationsEnvelope,
  ReconciledWriteResult,
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
  writeResult(answer: OperationsAnswer): ReconciledWriteResult | undefined;
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
  // The card's mutation lock, held for as long as anything is pending. See
  // `#holdLock`.
  lock: Deferred<void> | undefined;
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
    this.#holdLock(chain, this.#env.localId(instance));
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

  // Take the card's mutation lock for as long as anything is pending, rather
  // than around each send.
  //
  // An entry is applied to the live instance as soon as it is queued, so while
  // a chain is draining the instance carries effects the realm has not been
  // told about yet. An autosave that acquired the lock in between — triggered
  // by the user editing any field — would serialize the whole instance, those
  // effects included, and write them; the entries still to send would then run
  // their programs a second time on top of a card that already has them. A
  // relative program appends twice, and reconciliation cannot undo it: the base
  // check reports that the file moved, which is true and too late.
  //
  // Held once for the chain, an autosave waits for the last entry to settle and
  // then serializes state the realm already has.
  #holdLock(chain: Chain, key: string) {
    if (chain.lock) {
      return;
    }
    let released = new Deferred<void>();
    chain.lock = released;
    // Not awaited: this call's purpose is to occupy the lock until the chain
    // drains, and whoever queued behind it is released by `#releaseLock`.
    void this.#env.withLock(key, () => released.promise).then(ignore, ignore);
  }

  #releaseLock(chain: Chain) {
    if (chain.pending.length > 0 || !chain.lock) {
      return;
    }
    chain.lock.fulfill();
    chain.lock = undefined;
  }

  // Send one entry and reconcile what comes back. Runs after every entry
  // queued ahead of it on this card has settled, and under the lock the chain
  // is already holding.
  async #deliver(chain: Chain, entry: LedgerEntry): Promise<OperationsAnswer> {
    if (!chain.pending.includes(entry)) {
      // Cancelled while it waited its turn: something ahead of it failed, or
      // reconciled against a base the realm had moved past, and this entry's
      // local effect went with the re-read that followed. Its caller has
      // already been told; this is the send not happening.
      this.#releaseLock(chain);
      throw precedingFailed();
    }
    // A foreign re-read may be re-applying this very entry right now. Sending
    // while that is in flight would mark it sent behind the rebase's back, and
    // a re-application that then failed would reject a caller whose write is
    // already on its way to the realm.
    await chain.applying;
    if (!chain.pending.includes(entry)) {
      throw precedingFailed();
    }
    return await (async () => {
      // Read here rather than when the entry was queued: a foreign write in
      // between re-read the card and cleared the chain's version, and the
      // base this write names has to describe the bytes it was actually
      // computed over.
      let baseVersion = chain.version ?? this.#env.heldVersion(entry.instance);
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
        // The realm said nothing about what it now holds, so there is no
        // version the next operation could name.
        await this.#abort(chain, entry, undefined);
        throw err;
      }
      let result = this.#env.writeResult(answer);
      if (result?.baseMatched === true) {
        this.#settleAt(chain, entry, result.version);
        this.#retire(chain, entry);
        this.#releaseLock(chain);
        return answer;
      }
      // The write landed either way — a moved base is not a refusal — so
      // this entry's own call succeeds. What did not survive is the claim
      // that local state equals the result, so the card is re-read and the
      // entries queued behind it, which were computed on top of state that
      // is now gone, are rejected.
      //
      // The version rides through the re-read. A write that is not confirmed
      // still wrote, and the realm reported the version of the bytes it
      // stored — which is exactly what the re-read then brings back, since a
      // write resolves only once its indexing has settled. Dropping it would
      // leave the next operation with no base to name either, and a card
      // whose first unconfirmed write is its last confirmable one: the chain
      // could never start.
      await this.#abort(chain, entry, result?.version);
      return answer;
    })();
  }

  // Put the card back on authoritative state and fail everything still queued.
  //
  // `version` is what the card holds once the re-read lands, when this abort
  // followed a write that did land. Undefined where nothing is known — a send
  // that never got an answer — which leaves the next operation to name no base
  // and reconcile as unconfirmed, the honest answer.
  async #abort(
    chain: Chain,
    entry: LedgerEntry,
    version: string | undefined,
  ): Promise<void> {
    this.#retire(chain, entry);
    let stranded = chain.pending.splice(0, chain.pending.length);
    // Cleared before the re-read rather than after: until it lands, this
    // client cannot say what the card holds.
    chain.version = undefined;
    for (let queued of stranded) {
      queued.settled.reject(precedingFailed());
    }
    try {
      await this.#env.reload(entry.instance);
    } catch (err: unknown) {
      // The correction could not be fetched. Nothing here can put the card
      // right, and saying so is better than leaving the caller believing the
      // rollback happened — or letting the next operation name a base for
      // state this client never managed to read.
      console.error(
        `could not re-read ${entry.instance.id} after an operation reconciled against a base the realm had moved past`,
        err,
      );
      this.#releaseLock(chain);
      return;
    }
    if (version) {
      this.#settleAt(chain, entry, version);
    }
    // Released after the re-read rather than before it, so an autosave cannot
    // serialize the card in the window where local state is known wrong and
    // the correction has not landed.
    this.#releaseLock(chain);
  }

  // Record where the card now stands: on the chain, which is what the next
  // operation names as its base, and on the instance, which is what the
  // store's own rules read to recognize this write's echo.
  //
  // Both, and in this order, because a re-read replaces the instance's meta
  // wholesale with what the card+json GET carried — and that read reports no
  // version, so anything recorded before one is gone afterwards.
  #settleAt(chain: Chain, entry: LedgerEntry, version: string) {
    chain.version = version;
    this.#env.recordVersion(entry.instance, version);
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
    let reapplied = chain.applying.then(async () => {
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
          // failed here and the queue behind it goes with it. No version is
          // carried through: nothing of ours wrote this state, so there is
          // none this client could name.
          await this.#abort(chain, entry, undefined);
          entry.settled.reject(err as Error);
          return;
        }
      }
    }, ignore);
    // Swallowed the same way every other link in this chain is: the chain is
    // an ordering, and a rejection left on it is an unhandled one nobody is
    // positioned to answer. What went wrong has already reached the entry's
    // own caller.
    chain.applying = reapplied.then(ignore, ignore);
  }

  #chainFor(key: string): Chain {
    let chain = this.#chains.get(key);
    if (!chain) {
      chain = {
        pending: [],
        version: undefined,
        applying: settledPromise,
        sending: settledPromise,
        lock: undefined,
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
