class WatchedArray<T> {
  constructor(subscriber: (arr: Array<T>) => void, arr: T[] = []) {
    this.#subscriber = subscriber;
    let clone = arr.slice();
    let self = this;
    return new Proxy(clone, {
      set(target, prop, value /*, _receiver */) {
        (target as any)[prop] = value;

        let done: () => void;
        let notifyPromise = (self.#notifyPromise = new Promise<void>(
          (res) => (done = res),
        ));
        (async () => {
          await Promise.resolve();
          if (self.#notifyPromise === notifyPromise) {
            self.#subscriber([...target]);
          }
        })().then(done!);
        return true;
      },
      getPrototypeOf() {
        return WatchedArray.prototype;
      },
    }) as WatchedArray<T>;
  }

  #notifyPromise: Promise<void> | undefined;

  #subscriber: (arr: Array<T>) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface WatchedArray<T = unknown> extends Array<T> {}

export { WatchedArray };

// Ensure instanceof works correctly
Object.setPrototypeOf(WatchedArray.prototype, Array.prototype);
