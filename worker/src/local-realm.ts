import { Realm, Kind } from '@cardstack/runtime-common';
import { traverse } from './file-system';

export class LocalRealm extends Realm {
  constructor(private fs: FileSystemDirectoryHandle) {
    super('http://local-realm');
  }

  protected async *readdir(
    path: string,
    opts?: { create?: true }
  ): AsyncGenerator<{ name: string; path: string; kind: Kind }, void> {
    let dirHandle = isTopPath(path)
      ? this.fs
      : await traverse(this.fs, path, 'directory', opts);
    for await (let [name, handle] of dirHandle as unknown as AsyncIterable<
      [string, FileSystemDirectoryHandle | FileSystemFileHandle]
    >) {
      // note that the path of a directory always ends in "/"
      let innerPath = isTopPath(path) ? name : `${path}${name}`;
      yield { name, path: innerPath, kind: handle.kind };
    }
  }

  protected async openFile(path: string): Promise<ReadableStream<Uint8Array>> {
    let fileHandle = await traverse(this.fs, path, 'file');
    let file = await fileHandle.getFile();
    return file.stream() as unknown as ReadableStream<Uint8Array>;
  }
}

function isTopPath(path: string): boolean {
  return path === '';
}
