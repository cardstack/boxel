import { WorkerError } from './error';
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

export async function write(
  fs: FileSystemDirectoryHandle,
  path: string,
  contents: string,
  create?: {
    create: boolean;
  }
): Promise<number> {
  let handle = await traverse(fs, path, 'file', create);
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

export async function getContents(file: File): Promise<string> {
  let reader = new FileReader();
  return await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
