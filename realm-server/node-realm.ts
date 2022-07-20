import { RealmAdapter, Kind, FileRef } from "@cardstack/runtime-common";
import {
  readdirSync,
  existsSync,
  writeFileSync,
  statSync,
  ensureDirSync,
} from "fs-extra";
import { open, FileHandle } from "node:fs/promises";
import { join } from "path";

export class NodeRealm implements RealmAdapter {
  constructor(private realmDir: string) {}

  async *readdir(
    path: string,
    opts?: { create?: true }
  ): AsyncGenerator<{ name: string; path: string; kind: Kind }, void> {
    if (opts?.create) {
      ensureDirSync(path);
    }
    let absolutePath = join(this.realmDir, path);
    let entries = readdirSync(absolutePath, { withFileTypes: true });
    for await (let entry of entries) {
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (!isDirectory && !isFile) {
        continue;
      }
      let { name } = entry;
      yield {
        name,
        path: join(path, name),
        kind: isDirectory ? "directory" : "file",
      };
    }
  }

  async openFile(path: string): Promise<FileRef | undefined> {
    let absolutePath = join(this.realmDir, path);
    if (!existsSync(absolutePath)) {
      return undefined;
    }
    let { mtime } = statSync(absolutePath);
    let content = createReadWebStream(absolutePath);
    return {
      path,
      content,
      lastModified: mtime.getTime(),
    };
  }

  async write(
    path: string,
    contents: string
  ): Promise<{ lastModified: number }> {
    let absolutePath = join(this.realmDir, path);
    writeFileSync(absolutePath, contents);
    let { mtime } = statSync(absolutePath);
    return { lastModified: mtime.getTime() };
  }
}

// This creates a readable web-stream (the new style whatwg stream that our
// Realm API expects) from a file. Eventually node:stream.Readable.toWeb() will
// exist to support this. This is based off of the whatwg reference
// implementation here https://streams.spec.whatwg.org/#example-rbs-pull
const DEFAULT_CHUNK_SIZE = 65536;
function createReadWebStream(
  path: string,
  start = 0,
  stop = Number.MAX_SAFE_INTEGER
): ReadableStream {
  let fileHandle: FileHandle;
  return new ReadableStream({
    //@ts-ignore the type for ReadableStream is no up-to-date, type is allowed to be "bytes" or undefined
    type: "bytes",
    autoAllocateChunkSize: DEFAULT_CHUNK_SIZE,
    async start() {
      fileHandle = await open(path, "r");
    },
    async pull(ctrl) {
      // ctrl is a ReadableByteStreamController which has a byobRequest
      // property--the type seems to be missing for this.
      const byobRequest = (ctrl as any).byobRequest;
      const v = byobRequest.view;
      const { bytesRead } = await fileHandle.read(
        v,
        0,
        Math.min(v.byteLength, stop - start),
        start
      );
      if (bytesRead === 0) {
        await fileHandle.close();
        ctrl.close();
        byobRequest.respond(0);
      } else {
        start += bytesRead;
        byobRequest.respond(bytesRead);
      }
    },
    cancel() {
      return fileHandle.close();
    },
  });
}
