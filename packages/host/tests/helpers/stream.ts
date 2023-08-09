import { Deferred } from '@cardstack/runtime-common/deferred';

const closeHandlers: WeakMap<ReadableStream, () => void> = new WeakMap();
export function messageCloseHandler(stream: ReadableStream, fn: () => void) {
  closeHandlers.set(stream, fn);
}

export class WebMessageStream {
  private pendingWrite: { chunk: string; deferred: Deferred<void> } | undefined;
  private pendingRead:
    | { controller: ReadableStreamDefaultController; deferred: Deferred<void> }
    | undefined;

  readable: ReadableStream = new ReadableStream(this);
  writable: WritableStream = new WritableStream(this);

  async pull(controller: ReadableStreamDefaultController) {
    if (this.pendingRead) {
      throw new Error(
        'bug: did not expect node to call read until after we push data from the prior read',
      );
    }
    if (this.pendingWrite) {
      let { chunk, deferred } = this.pendingWrite;
      this.pendingWrite = undefined;
      // TODO: better way to handle encoding
      controller.enqueue(Uint8Array.from(chunk, (x) => x.charCodeAt(0)));
      deferred.fulfill();
    } else {
      this.pendingRead = { controller, deferred: new Deferred() };
      await this.pendingRead.deferred.promise;
    }
  }

  async write(chunk: string, _controller: WritableStreamDefaultController) {
    if (this.pendingWrite) {
      throw new Error(
        'bug: did not expect node to call write until after we call the callback',
      );
    }
    if (this.pendingRead) {
      let { controller, deferred } = this.pendingRead;
      this.pendingRead = undefined;
      try {
        // TODO: better way to handle encoding
        controller.enqueue(Uint8Array.from(chunk, (x) => x.charCodeAt(0)));
      } catch (err) {
        let cleanup = closeHandlers.get(this.readable);
        if (!cleanup) {
          throw new Error('no cleanup function found');
        }
        cleanup();
      }
      deferred.fulfill();
    } else {
      this.pendingWrite = { chunk, deferred: new Deferred() };
      await this.pendingWrite.deferred.promise;
    }
  }
}
