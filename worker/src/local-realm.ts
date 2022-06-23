import { Realm } from '@cardstack/runtime-common';
import { getContents, getRecursiveDirectoryEntries } from './file-system';

export class LocalRealm implements Realm {
  url = 'http://local-realm';

  constructor(private fs: FileSystemDirectoryHandle) {}

  async *eachFile(): AsyncGenerator<{ path: string; contents: string }, void> {
    for (let { path, handle } of await getRecursiveDirectoryEntries(this.fs)) {
      if (handle.kind === 'directory') {
        continue;
      }
      let contents = await getContents(await handle.getFile());
      yield { path, contents };
    }
  }
}
