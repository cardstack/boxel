import { Resource, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { registerDestructor } from '@ember/destroyable';

interface Args {
  named: { dir: FileSystemDirectoryHandle | null };
}

async function getDirectoryEntries(
  directoryHandle: FileSystemDirectoryHandle,
  dir = ['.']
): Promise<Entry[]> {
  let entries: Entry[] = [];
  const EXCLUDED_DIRS = ['dist', 'tmp', 'node_modules', '.vscode', '.git'];
  const EXCLUDED_FILES = ['.gitkeep'];
  for await (let [name, handle] of directoryHandle as any as AsyncIterable<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  >) {
    if (EXCLUDED_DIRS.includes(name)) {
      continue;
    }
    entries.push({
      name,
      handle,
      path: [...dir, name].join('/'),
      indent: dir.length,
    });
    if (handle.kind === 'directory') {
      entries.push(...(await getDirectoryEntries(handle, [...dir, name])));
      entries = entries.filter((entry) => !EXCLUDED_FILES.includes(entry.name));
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export interface Entry {
  name: string;
  handle: FileSystemDirectoryHandle | FileSystemFileHandle;
  path: string;
  indent: number;
}

export class DirectoryResource extends Resource<Args> {
  private dir: FileSystemDirectoryHandle | null;

  @tracked entries: Entry[] = [];
  private interval: ReturnType<typeof setInterval>;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    registerDestructor(this, () => {
      clearInterval(this.interval);
    });
    this.dir = args.named.dir;
    this.interval = setInterval(() => this.readdir(), 1000);
    this.readdir();
  }

  private async readdir() {
    if (this.dir) {
      this.entries = await getDirectoryEntries(this.dir);
    } else {
      this.entries = [];
    }
  }
}

export function directory(
  parent: object,
  dir: () => FileSystemDirectoryHandle | null
) {
  return useResource(parent, DirectoryResource, () => ({
    named: { dir: dir() },
  }));
}
