import { isNode, executableExtensions } from "./index";
import type { FileRef } from "./realm";
import type { LocalPath } from "./paths";
import { Deferred } from "./deferred";

export async function webStreamToText(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  let decoder = new TextDecoder();
  let pieces: string[] = [];
  let reader = stream.getReader();
  while (true) {
    let { done, value } = await reader.read();
    if (done) {
      pieces.push(decoder.decode(undefined, { stream: false }));
      break;
    }
    if (value) {
      pieces.push(decoder.decode(value, { stream: true }));
    }
  }
  return pieces.join("");
}

export async function fileContentToText({ content }: FileRef): Promise<string> {
  if (typeof content === "string") {
    return content;
  }
  if (content instanceof Uint8Array) {
    let decoder = new TextDecoder();
    return decoder.decode(content);
  } else if (content instanceof ReadableStream) {
    return await webStreamToText(content);
  } else {
    if (!isNode) {
      throw new Error(`cannot handle node-streams when not in node`);
    }

    // we're in a node-only branch, so this code isn't relevant to the worker
    // build, but the worker build will try to resolve the buffer polyfill and
    // blow up since we don't include that library. So we're hiding from
    // webpack.
    const B = (globalThis as any)["Buffer"];

    const chunks: typeof B[] = []; // Buffer is available from globalThis when in the node env, however tsc can't type check this for the worker
    // the types for Readable have not caught up to the fact these are async generators
    for await (const chunk of content as any) {
      chunks.push(B.from(chunk));
    }
    return B.concat(chunks).toString("utf-8");
  }
}

export async function readFileAsText(
  path: LocalPath,
  openFile: (path: string) => Promise<FileRef | undefined>,
  opts: { withFallbacks?: true } = {}
): Promise<{ content: string; lastModified: number } | undefined> {
  let ref: FileRef | undefined;
  if (opts.withFallbacks) {
    ref = await getFileWithFallbacks(path, openFile);
  } else {
    ref = await openFile(path);
  }
  if (!ref) {
    return;
  }
  return {
    content: await fileContentToText(ref),
    lastModified: ref.lastModified,
  };
}
// we bother with this because typescript is picky about allowing you to use
// explicit file extensions in your source code
export async function getFileWithFallbacks(
  path: LocalPath,
  openFile: (path: string) => Promise<FileRef | undefined>
): Promise<FileRef | undefined> {
  let result = await openFile(path);
  if (result) {
    return result;
  }

  for (let extension of executableExtensions) {
    result = await openFile(path + extension);
    if (result) {
      return result;
    }
  }
  return undefined;
}

let writers = new WeakMap<WritableStream, WritableStreamDefaultWriter>();

export async function writeToStream(
  stream: WritableStream,
  chunk: string
): Promise<void> {
  if (typeof stream.getWriter === "function") {
    let writer = writers.get(stream);
    if (!writer) {
      writer = stream.getWriter();
      writers.set(stream, writer);
    }
    return writer.write(chunk);
  } else {
    if (!isNode) {
      throw new Error(`cannot handle node-streams when not in node`);
    }
    return new Promise<void>((resolve, reject) => {
      (stream as any).write(chunk, null, (err: unknown) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

export async function waitForClose(stream: WritableStream): Promise<void> {
  if (typeof stream.getWriter === "function") {
    let writer = writers.get(stream);
    if (!writer) {
      writer = stream.getWriter();
      writers.set(stream, writer);
    }
    await writer.closed;
  } else {
    if (!isNode) {
      throw new Error(`cannot handle node-streams when not in node`);
    }
    return new Promise((resolve, reject) => {
      (stream as any).on("close", () => resolve());
      (stream as any).on("error", (err: unknown) => reject(err));
    });
  }
}

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
        "bug: did not expect node to call read until after we push data from the prior read"
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
        "bug: did not expect node to call write until after we call the callback"
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
          throw new Error("no cleanup function found");
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
