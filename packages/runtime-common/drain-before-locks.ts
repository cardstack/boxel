// How many times a writer drains and takes its locks before it stops handing
// them back. Each extra turn needs a module or config pass to register in the
// window between a drain settling and the locks being granted, so a second
// turn is rare and a third rarer still; the bound exists so a realm whose
// modules are being rewritten continuously cannot keep one writer cycling.
export const MAX_DRAIN_BEFORE_LOCK_ATTEMPTS = 3;

const handedBack = Symbol('handed-back');

// Runs `run` under the write locks `lock` takes, with the indexing `drain`
// names already settled — waited for *before* the locks are taken rather than
// while holding them.
//
// The file locks serialize the read-merge-write of the files they name, and
// nothing more. The drain waits on other writers' indexing, which needs no
// exclusivity over this writer's files; holding the locks across it makes
// every other writer of those files wait out whatever that indexing is waiting
// on, for as long as it takes. So the wait happens with nothing held, and the
// section holds only a synchronous re-check.
//
// The re-check is what keeps the guarantee the drain gives staging. A pass
// that registers between the drain settling and the locks being granted would
// otherwise slip past both. When the re-check finds one, the section returns
// before touching anything — giving the locks back — and the writer drains
// again outside them. After `MAX_DRAIN_BEFORE_LOCK_ATTEMPTS` turns it runs
// anyway, and `run`'s own in-lock gate waits for what is left, as it would
// with no drain ahead of it.
//
// `drain` follows the realm's gate contract: `undefined` when nothing it
// covers is in flight, so the re-check reads synchronously, otherwise a
// promise that settles (and never rejects) once those passes have.
//
// `screen`, when given, is a check that can answer the request without
// staging anything — a refusal decided by what is on disk. It runs under the
// locks ahead of the re-check on every turn, and the first turn takes the
// locks without draining, so a request it refuses is answered without waiting
// for indexing it would never have used. A defined result is returned as the
// answer; `undefined` lets the write go ahead, at the cost of one more turn
// when indexing is in flight, since that first turn did not drain.
export async function withLocksAfterDrain<T>({
  drain,
  lock,
  run,
  screen,
  onDrain,
  onLocked,
}: {
  drain: () => Promise<void> | undefined;
  lock: <R>(fn: (releaseLocks: () => void) => Promise<R>) => Promise<R>;
  run: (releaseLocks: () => void) => Promise<T>;
  screen?: () => Promise<T | undefined>;
  // Wraps each wait outside the locks, for a caller timing the drain as a
  // stage of its write.
  onDrain?: (pending: Promise<void>) => Promise<void>;
  // Called with how long each turn waited for its locks.
  onLocked?: (waitedMs: number) => void;
}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    let pending = attempt === 1 && screen ? undefined : drain();
    if (pending) {
      await (onDrain ? onDrain(pending) : pending);
    }
    let lockRequestedAt = Date.now();
    let outcome = await lock(
      async (releaseLocks): Promise<T | typeof handedBack> => {
        onLocked?.(Date.now() - lockRequestedAt);
        if (screen) {
          let answer = await screen();
          if (answer !== undefined) {
            return answer;
          }
        }
        if (attempt < MAX_DRAIN_BEFORE_LOCK_ATTEMPTS && drain() !== undefined) {
          return handedBack;
        }
        return await run(releaseLocks);
      },
    );
    if (outcome !== handedBack) {
      return outcome;
    }
  }
}
