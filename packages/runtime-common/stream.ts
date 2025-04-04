import { isNode, executableExtensions } from './index';
import type { FileRef } from './realm';
import type { LocalPath } from './paths';

export async function webStreamToText(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  let decoder = new TextDecoder();
  let pieces: string[] = [];
  let reader = stream.getReader();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let { done, value } = await reader.read();
    if (done) {
      pieces.push(decoder.decode(undefined, { stream: false }));
      break;
    }
    if (value) {
      pieces.push(decoder.decode(value, { stream: true }));
    }
  }
  return pieces.join('');
}

export async function fileContentToText({
  content,
}: Pick<FileRef, 'content'>): Promise<string> {
  if (typeof content === 'string') {
    return content;
  }
  if (content instanceof Uint8Array) {
    let decoder = new TextDecoder();
    return decoder.decode(content);
  } else if (content instanceof ReadableStream) {
    return await webStreamToText(content);
  } else {
    if (!isNode) {
      throw new Error(`cannot handle node-streams when not in node`);
    }

    // we're in a node-only branch, so this code isn't relevant to the worker
    // build, but the worker build will try to resolve the buffer polyfill and
    // blow up since we don't include that library. So we're hiding from
    // webpack.
    const B = (globalThis as any)['Buffer'];

    const chunks: (typeof B)[] = []; // Buffer is available from globalThis when in the node env, however tsc can't type check this for the worker
    // the types for Readable have not caught up to the fact these are async generators
    for await (const chunk of content as any) {
      chunks.push(B.from(chunk));
    }
    return B.concat(chunks).toString('utf-8');
  }
}

export interface TextFileRef {
  content: string;
  lastModified: number;
  created: number;
  path: string;
  isShimmed?: true;
}

export async function readFileAsText(
  path: LocalPath,
  openFile: (path: string) => Promise<FileRef | undefined>,
  opts: { withFallbacks?: true } = {},
): Promise<TextFileRef | undefined> {
  let ref: FileRef | undefined;
  if (opts.withFallbacks) {
    ref = await getFileWithFallbacks(path, openFile, executableExtensions);
  } else {
    ref = await openFile(path);
  }
  if (!ref) {
    return;
  }
  return {
    content: await fileContentToText(ref),
    lastModified: ref.lastModified,
    created: ref.created,
    path: ref.path,
    ...(Symbol.for('shimmed-module') in ref ? { isShimmed: true } : {}),
  };
}
// we bother with this because typescript is picky about allowing you to use
// explicit file extensions in your source code
export async function getFileWithFallbacks(
  path: LocalPath,
  openFile: (path: string) => Promise<FileRef | undefined>,
  fallbackExtensions: string[],
): Promise<FileRef | undefined> {
  let result = await openFile(path);
  if (result) {
    return result;
  }
  // if there is already an extension on the path, don't try fallbacks
  if (path.split('/').pop()!.includes('.')) {
    return undefined;
  }

  for (let extension of fallbackExtensions) {
    result = await openFile(path + extension);
    if (result) {
      return result;
    }
  }
  return undefined;
}
