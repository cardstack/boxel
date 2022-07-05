// TODO After our refactors are over, this file should not exist anymore

import { WorkerError } from '@cardstack/runtime-common/error';
import { formatRFC7231 } from 'date-fns';
import { Kind } from '@cardstack/runtime-common';

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

// we bother with this because typescript is picky about allowing you to use
// explicit file extensions in your source code
export async function getLocalFileWithFallbacks(
  fs: FileSystemDirectoryHandle,
  path: string,
  extensions: string[]
): Promise<FileSystemFileHandle> {
  // TODO refactor to use search index
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
    return await traverse(fs, path, 'file');
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

type HandleKind<T extends Kind> = T extends 'file'
  ? FileSystemFileHandle
  : FileSystemDirectoryHandle;

export async function traverse<Target extends Kind>(
  dirHandle: FileSystemDirectoryHandle,
  path: string,
  targetKind: Target,
  opts?: { create?: boolean }
): Promise<HandleKind<Target>> {
  // the leading and trailing "/" will result in a superflous items in our path segments
  if (path.startsWith('/')) {
    path = path.slice(1);
  }
  if (path.endsWith('/')) {
    path = path.slice(0, -1);
  }

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
    return (await handle.getFileHandle(
      pathSegments[0],
      opts
    )) as HandleKind<Target>;
  }
  return (await handle.getDirectoryHandle(
    pathSegments[0],
    opts
  )) as HandleKind<Target>;
}
