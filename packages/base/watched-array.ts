class WatchedArray<T> {
  constructor(subscriber: (oldArr: Array<T>, arr: Array<T>) => void, arr: T[] = []) {
    this.#subscriber = subscriber;
    let clone = arr.slice();
    let self = this;
    return new Proxy(clone, {
      set(target, prop, value /*, _receiver */) {
        let prevValues = [...target];
        (target as any)[prop] = value;

        // It seems the setter is called twice when adding or removing items from the array.
        // The first call is to add the item, and the second call is to update the length value.
        // When adding items, we need to notify the subscriber with the first call.
        // When removing items, we need the second call.
        if (prop !== 'length' || (prop === 'length' && value !== prevValues.length)) {
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
