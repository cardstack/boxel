import { RealmAdapter, Kind, FileRef } from "@cardstack/runtime-common";
import {
  readdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  ensureDirSync,
} from "fs-extra";
import { join } from "path";
// import { Readable } from "stream";

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
    // looks like ReadStream is not compatible with ReadableStream
    // let stream = fs.createReadStream(absolutePath);
    return {
      path,
      content: readFileSync(absolutePath, { encoding: "utf8" }),
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
