// Reading `proxy[rawValues]` returns the underlying backing array with every
// slot intact — including the link sentinels that the index getter hides from
// userland. Only the link-aware modules in `packages/base` (card-api.gts,
// field-support.ts) read through this to inspect or swap sentinels; everything
// else sees the `Card | undefined` per-slot surface.
export const rawValues = Symbol.for('@cardstack/watched-array:raw-values');

// Return the raw backing array for a value that may be a `WatchedArray` proxy
// or an ordinary array. A plain array has no `rawValues` slot, so it is returned
// as-is; a `WatchedArray` returns its sentinel-bearing backing store.
export function rawArrayValues<T>(value: ArrayLike<T>): T[] {
  let raw = (value as any)?.[rawValues];
  return (raw ?? value) as T[];
}

interface WatchedArrayOptions<T> {
  // When provided, a numeric-index read whose backing value satisfies this
  // predicate resolves to `undefined` instead of the stored value. The value
  // remains in the backing array (so `length`, iteration count, and in-place
  // swaps are unaffected); it is simply never handed to userland through `[i]`.
  hideSlot?: (value: T) => boolean;
}

function arrayIndex(prop: string | symbol): number | undefined {
  if (typeof prop !== 'string') {
    return undefined;
  }
  let n = Number(prop);
  // Canonical array indices only: non-negative integers whose string form round
  // -trips (rules out '01', '1.0', '-1', 'length', etc.).
  if (Number.isInteger(n) && n >= 0 && String(n) === prop) {
    return n;
  }
  return undefined;
}

class WatchedArray<T> {
  constructor(
    subscriber: (oldArr: Array<T>, arr: Array<T>) => void,
    arr: T[] = [],
    opts: WatchedArrayOptions<T> = {},
  ) {
    this.#subscriber = subscriber;
    let { hideSlot } = opts;
    let clone = arr.slice();
    let self = this;
    return new Proxy(clone, {
      get(target, prop, receiver) {
        // Escape hatch for the link-aware base modules: hand back the raw
        // backing array so they can read/swap sentinels directly.
        if (prop === rawValues) {
          return target;
        }
        if (hideSlot !== undefined) {
          let index = arrayIndex(prop);
          if (index !== undefined) {
            let value = target[index];
            if (hideSlot(value)) {
              return undefined;
            }
          }
        }
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value /*, _receiver */) {
        let prevValues = [...target];
        (target as any)[prop] = value;

        // It seems the setter is called twice when adding or removing items from the array.
        // The first call is to add the item, and the second call is to update the length value.
        // When adding items, we need to notify the subscriber with the first call.
        // When removing items, we need the second call.
        if (
          prop !== 'length' ||
          (prop === 'length' && value !== prevValues.length)
        ) {
          let done: () => void;
          let notifyPromise = (self.#notifyPromise = new Promise<void>(
            (res) => (done = res),
          ));
          (async () => {
            await Promise.resolve();
            if (self.#notifyPromise === notifyPromise) {
              self.#subscriber(prevValues, [...target]);
            }
          })().then(done!);
        }

        return true;
      },
      getPrototypeOf() {
        return WatchedArray.prototype;
      },
    }) as WatchedArray<T>;
  }

  #notifyPromise: Promise<void> | undefined;

  #subscriber: (oldArr: Array<T>, arr: Array<T>) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface WatchedArray<T = unknown> extends Array<T> {}

export { WatchedArray };

// Ensure instanceof works correctly
Object.setPrototypeOf(WatchedArray.prototype, Array.prototype);
