class WatchedArray<T, K> {
  constructor(
    subscriber: (arr: WatchedArray<T, K>, context: K | undefined) => void,
    arr: T[] = [],
    contextPromise?: Promise<K>
  ) {
    this.#subscriber = subscriber;
    let clone = arr.slice();
    let self = this;
    return new Proxy(clone, {
      set(target, prop, value /*, _receiver */) {
        (target as any)[prop] = value;

        let done: () => void;
        let notifyPromise = (self.#notifyPromise = new Promise<void>(
          (res) => (done = res)
        ));
        (async () => {
          await Promise.resolve();
          let context = await contextPromise;
          if (self.#notifyPromise === notifyPromise) {
            self.#subscriber(self, context);
          }
        })().then(done!);
        return true;
      },
      getPrototypeOf() {
        return WatchedArray.prototype;
      },
    }) as WatchedArray<T, K>;
  }

  #notifyPromise: Promise<void> | undefined;

  #subscriber: (arr: WatchedArray<T, K>, context: K | undefined) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface WatchedArray<T = unknown, K = unknown> extends Array<T> {}

export { WatchedArray };

// Ensure instanceof works correctly
Object.setPrototypeOf(WatchedArray.prototype, Array.prototype);
