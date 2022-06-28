import { Realm } from '@cardstack/runtime-common';
import { getContents, getRecursiveDirectoryEntries } from './file-system';

export class LocalRealm extends Realm {
  constructor(private fs: FileSystemDirectoryHandle) {
    super('http://local-realm');
  }

  async *eachFile(): AsyncGenerator<{ path: string; contents: string }, void> {
    for (let { path, handle } of await getRecursiveDirectoryEntries(this.fs)) {
      if (handle.kind === 'directory') {
        continue;
      }
      let contents = await getContents(await handle.getFile());
      yield { path, contents };
    }
  }

  async loadFile(_path: string): Promise<ArrayBuffer> {
    throw new Error('Not implemented');
  }
}
