import { Resource, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { registerDestructor } from '@ember/destroyable';
import ignore from 'ignore';
import { readFileAsText } from '@cardstack/worker/src/util';

interface Args {
  named: { dir: FileSystemDirectoryHandle | null };
}

async function getDirectoryEntries(
  directoryHandle: FileSystemDirectoryHandle,
  dir: string[] = [],
  ignoreFile = ''
): Promise<Entry[]> {
  let entries: Entry[] = [];
  for await (let [name, handle] of directoryHandle as any as AsyncIterable<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  >) {
    if (
      handle.kind === 'directory' &&
      filterIgnored([`${name}/`], ignoreFile).length === 0
    ) {
      // without this, trying to open large root dirs causes the browser to hang
      continue;
    }
    let path = [...dir, name].join('/');
    entries.push({
      name,
      handle,
      path: handle.kind === 'directory' ? `${path}/` : path,
      indent: dir.length,
    });
    if (handle.kind === 'directory') {
      entries.push(
        ...(await getDirectoryEntries(handle, [...dir, name], ignoreFile))
      );
    }
  }
  let filteredEntries = filterIgnoredEntries(entries, ignoreFile);
  return filteredEntries.sort((a, b) => a.path.localeCompare(b.path));
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
      let ignoreFile = await getIgnorePatterns(this.dir);
      this.entries = await getDirectoryEntries(this.dir, [], ignoreFile);
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

async function getIgnorePatterns(fileDir: FileSystemDirectoryHandle) {
  let fileHandle;
  try {
    fileHandle = await fileDir.getFileHandle('.monacoignore');
  } catch (e) {
    try {
      fileHandle = await fileDir.getFileHandle('.gitignore');
    } catch (e) {
      return '';
    }
  }
  return await readFileAsText(fileHandle);
}

function filterIgnoredEntries(entries: Entry[], patterns: string): Entry[] {
  let filteredPaths = filterIgnored(
    entries.map((e) => e.path),
    patterns
  );
  return entries.filter((entry) => filteredPaths.includes(entry.path));
}

function filterIgnored(paths: string[], patterns: string): string[] {
  return ignore().add(patterns).filter(paths);
}
