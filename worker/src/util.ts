export function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

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

export async function readFileAsText(
  handle: FileSystemFileHandle
): Promise<string> {
  let file = await handle.getFile();
  let reader = new FileReader();
  return await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
