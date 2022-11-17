export class Deferred<T> {
  promise: Promise<T>;
  resolve!: (result: T) => void;
  reject!: (err: unknown) => void;
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
  fulfill(result: T | Promise<T>): void {
    Promise.resolve(result).then(this.resolve, this.reject);
  }
}
