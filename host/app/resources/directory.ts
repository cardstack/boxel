import { Resource, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { registerDestructor } from '@ember/destroyable';
import { parse } from 'parse-gitignore';
import { readFile } from '@cardstack/worker/src/util';

interface Args {
  named: { dir: FileSystemDirectoryHandle | null };
}

async function getDirectoryEntries(
  directoryHandle: FileSystemDirectoryHandle,
  dir = ['.'],
  ignoredNames: string[] = []
): Promise<Entry[]> {
  let entries: Entry[] = [];
  for await (let [name, handle] of directoryHandle as any as AsyncIterable<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  >) {
    if (ignoredNames.includes(name)) {
      continue;
    }
    entries.push({
      name,
      handle,
      path: [...dir, name].join('/'),
      indent: dir.length,
    });
    if (handle.kind === 'directory') {
      entries.push(
        ...(await getDirectoryEntries(handle, [...dir, name], ignoredNames))
      );
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
      let ignoredNames = await getIgnoredNames(this.dir);
      this.entries = await getDirectoryEntries(this.dir, ['.'], ignoredNames);
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

async function getIgnoredNames(
  fileDir: FileSystemDirectoryHandle
): Promise<string[] | []> {
  let fileHandle;

  try {
    fileHandle = await fileDir.getFileHandle('.monacoignore');
  } catch (e) {
    try {
      fileHandle = await fileDir.getFileHandle('.gitignore');
    } catch (e) {
      return [];
    }
  }

  let content = await readFile(fileHandle);
  return parse(content).patterns.map((name) =>
    name.replace(/^\/?(.*?)\/?$/, '$1')
  );
}
