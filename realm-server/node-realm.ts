import { RealmAdapter, Kind, FileRef } from "@cardstack/runtime-common";
import { LocalPath } from "@cardstack/runtime-common/paths";

import {
  readdirSync,
  existsSync,
  writeFileSync,
  statSync,
  ensureDirSync,
  ensureFileSync,
  createReadStream,
  removeSync,
} from "fs-extra";
import { join } from "path";

export class NodeAdapter implements RealmAdapter {
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

  async exists(path: string): Promise<boolean> {
    let absolutePath = join(this.realmDir, path);
    return existsSync(absolutePath);
  }

  async openFile(path: string): Promise<FileRef | undefined> {
    let absolutePath = join(this.realmDir, path);
    if (!existsSync(absolutePath)) {
      return undefined;
    }
    let { mtime } = statSync(absolutePath);
    let content = createReadStream(absolutePath);
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
    ensureFileSync(absolutePath);
    writeFileSync(absolutePath, contents);
    let { mtime } = statSync(absolutePath);
    return { lastModified: mtime.getTime() };
  }

  async remove(path: LocalPath): Promise<void> {
    let absolutePath = join(this.realmDir, path);
    removeSync(absolutePath);
  }
}
