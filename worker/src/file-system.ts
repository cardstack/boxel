import { WorkerError } from './error';
import { readFileAsText } from './util';
import ignore from 'ignore';
import { formatRFC7231 } from 'date-fns';

export async function serveLocalFile(
  handle: FileSystemFileHandle
): Promise<Response> {
  let file = await handle.getFile();
  return new Response(file, {
    headers: {
      'Last-Modified': formatRFC7231(file.lastModified),
    },
  });
}

export async function write(
  fs: FileSystemDirectoryHandle,
  path: string,
  contents: string,
  create?: {
    create: boolean;
  }
): Promise<number> {
  let handle = (await traverse(
    fs,
    path,
    'file',
    create
  )) as FileSystemFileHandle;
  // TypeScript seems to lack types for the writable stream features
  let stream = await (handle as any).createWritable();
  await stream.write(contents);
  await stream.close();
  return (await handle.getFile()).lastModified;
}

// we bother with this because typescript is picky about allowing you to use
// explicit file extensions in your source code
export async function getLocalFileWithFallbacks(
  fs: FileSystemDirectoryHandle,
  path: string,
  extensions: string[]
): Promise<FileSystemFileHandle> {
  try {
    return await getLocalFile(fs, path);
  } catch (err) {
    if (!(err instanceof WorkerError) || err.response.status !== 404) {
      throw err;
    }
    for (let extension of extensions) {
      try {
        return await getLocalFile(fs, path + extension);
      } catch (innerErr) {
        if (
          !(innerErr instanceof WorkerError) ||
          innerErr.response.status !== 404
        ) {
          throw innerErr;
        }
      }
    }
    throw err;
  }
}

export async function getLocalFile(
  fs: FileSystemDirectoryHandle,
  path: string
): Promise<FileSystemFileHandle> {
  try {
    return (await traverse(fs, path, 'file')) as FileSystemFileHandle;
  } catch (err) {
    if ((err as DOMException).name === 'NotFoundError') {
      throw WorkerError.withResponse(
        new Response(`${path} not found in local realm`, {
          status: 404,
          headers: { 'content-type': 'text/html' },
        })
      );
    }
    if ((err as DOMException).name === 'TypeMismatchError') {
      throw WorkerError.withResponse(
        new Response(`${path} is a directory, but we expected a file`, {
          status: 404,
          headers: { 'content-type': 'text/html' },
        })
      );
    }
    throw err;
  }
}

type Kind = 'file' | 'directory';
type HandleKind<T extends Kind> = T extends 'file'
  ? FileSystemFileHandle
  : FileSystemDirectoryHandle;

export async function traverse(
  dirHandle: FileSystemDirectoryHandle,
  path: string,
  targetKind: Kind,
  opts?: { create?: boolean }
): Promise<HandleKind<typeof targetKind>> {
  let pathSegments = path.split('/');
  let create = opts?.create;
  async function nextHandle(
    handle: FileSystemDirectoryHandle,
    pathSegment: string
  ) {
    try {
      return await handle.getDirectoryHandle(pathSegment, { create });
    } catch (err: any) {
      if (err.name === 'NotFoundError') {
        console.error(`${path} was not found in the local realm`);
      }
      throw err;
    }
  }

  let handle = dirHandle;
  while (pathSegments.length > 1) {
    let segment = pathSegments.shift()!;
    handle = await nextHandle(handle, segment);
  }

  if (targetKind === 'file') {
    return (await handle.getFileHandle(pathSegments[0], opts)) as HandleKind<
      typeof targetKind
    >;
  }
  return (await handle.getDirectoryHandle(pathSegments[0], opts)) as HandleKind<
    typeof targetKind
  >;
}

export async function getContents(file: File): Promise<string> {
  let reader = new FileReader();
  return await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

interface Entry {
  handle: FileSystemDirectoryHandle | FileSystemFileHandle;
  path: string;
}

export async function getDirectoryEntries(
  directoryHandle: FileSystemDirectoryHandle,
  parentDir: string,
  ignoreFile = ''
): Promise<Entry[]> {
  let entries: Entry[] = [];
  if (!directoryHandle) {
    return [];
  }
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
    let path = `${parentDir}${handle.name}`;
    entries.push({
      handle,
      path: handle.kind === 'directory' ? `${path}/` : path,
    });
  }
  return filterIgnoredEntries(entries, ignoreFile);
}

export async function getRecursiveDirectoryEntries(
  directoryHandle: FileSystemDirectoryHandle,
  parentDir = '/',
  ignoreFile = ''
): Promise<Entry[]> {
  let entries: Entry[] = [];
  for (let entry of await getDirectoryEntries(
    directoryHandle,
    parentDir,
    ignoreFile
  )) {
    if (entry.handle.kind === 'file') {
      entries = [...entries, entry];
    } else {
      entries = [
        ...entries,
        ...(await getDirectoryEntries(
          entry.handle,
          `${parentDir}${entry.handle.name}/`,
          ignoreFile
        )),
      ];
    }
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

export async function getIgnorePatterns(fileDir: FileSystemDirectoryHandle) {
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
    entries.map((e) => e.path.slice(1)),
    patterns
  );
  return entries.filter((entry) => filteredPaths.includes(entry.path.slice(1)));
}

function filterIgnored(paths: string[], patterns: string): string[] {
  return ignore().add(patterns).filter(paths);
}
