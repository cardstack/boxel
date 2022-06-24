import { formatRFC7231 } from 'date-fns';
import { isCardJSON, ResourceObjectWithId } from '@cardstack/runtime-common';
import { WorkerError } from './error';
import {
  write,
  getLocalFileWithFallbacks,
  traverse,
  getContents,
  getIgnorePatterns,
  getDirectoryEntries,
  serveLocalFile,
} from './file-system';
import { DirectoryEntryRelationship } from '@cardstack/runtime-common';
import merge from 'lodash/merge';
import { SearchIndex } from '@cardstack/runtime-common/search-index';

// TODO there is a potential for namespace collision for these paths. We should sort this out
const reservedPathNames = ['/type-of', '/cards-of'];

interface Route<T> {
  path: string | RegExp;
  method: 'GET' | 'POST' | 'PATCH'; // add others as necessary
  middlewares: Middleware<T>[];
}
interface Context<T> {
  request: Request;
  opts: T;
}
type Middleware<T> = (cxt: Context<T>, next: () => void) => Promise<void>;
export class JSONAPIRouter<T> {
  private routes: Route<T>[] = [];
  constructor(
    private fs: FileSystemDirectoryHandle,
    private searchIndex: SearchIndex
  ) {}

  get(path: Route<T>['path'], ...middleware: Middleware<T>[]) {}
  post(path: Route<T>['path'], ...middleware: Middleware<T>[]) {}
  patch(path: Route<T>['path'], ...middleware: Middleware<T>[]) {}
}

/*
  Directory listing is a JSON-API document that looks like:

  with this file system

  /
  /cards
  /cards/file1.ts
  /cards/file2.ts
  /cards/nested/
  /cards/nested-file1.json
  /cards/nested-file2.json

  if you request http://local-realm/, then this is the response:

  {
    data: {
      type: "directory",
      id: "http://local-realm/",
      relationships: {
        "cards": {
          links: {
            related: "http://local-realm/cards/"
          },
          meta: {
            kind: "directory"
          }
        },
        "file1.ts": {
          links: {
            related: "http://local-realm/file1.ts"
          },
          meta: {
            kind: "file"
          }
        },
        "file2.ts": {
          links: {
            related: "http://local-realm/file1.ts"
          },
          meta: {
            kind: "file"
          }
        },

      }
    }
  }
*/

// TODO let's refactor this method so it's not a huge pile of if's. maybe use a
// strategy pattern
export async function handle(
  fs: FileSystemDirectoryHandle,
  searchIndex: SearchIndex,
  request: Request,
  url: URL
): Promise<Response> {
  // create card data
  if (request.method === 'POST') {
    if (reservedPathNames.includes(url.pathname)) {
      return methodNotAllowed(request);
    }
    if (url.pathname !== '/') {
      return new Response(
        JSON.stringify({ errors: [`Can't POST to ${url.href}`] }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/vnd.api+json' },
        }
      );
    }
    let json = await request.json();
    if (!isCardJSON(json)) {
      return new Response(
        JSON.stringify({
          errors: [`Request body is not valid card JSON-API`],
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/vnd.api+json' },
        }
      );
    }

    let dirHandle: FileSystemDirectoryHandle | undefined;
    let dirName = json.data.meta.adoptsFrom.name;
    try {
      dirHandle = await fs.getDirectoryHandle(dirName);
    } catch (err: any) {
      if ((err as DOMException).name === 'TypeMismatchError') {
        throw WorkerError.withResponse(
          new Response(
            `/${dirName} is already file, but we expected a directory (so that we can make a new file in this directory)`,
            {
              status: 404,
              headers: { 'Content-Type': 'text/html' },
            }
          )
        );
      }
      if ((err as DOMException).name !== 'NotFoundError') {
        throw err;
      }
    }
    let index = 0;
    if (dirHandle) {
      let entries = await getDirectoryEntries(dirHandle, '/');
      for (let entry of entries) {
        if (entry.handle.kind === 'directory') {
          continue;
        }
        if (!/^[\d]+\.json$/.test(entry.handle.name)) {
          continue;
        }
        let num = parseInt(entry.handle.name.replace('.json', ''));
        index = Math.max(index, num);
      }
    }
    let pathname = `${dirName}/${++index}.json`;
    let lastModified = await write(
      fs,
      pathname,
      JSON.stringify(json, null, 2),
      { create: true }
    );
    let newURL = new URL(pathname, url.origin).href.replace(/\.json$/, '');
    (json.data as any).id = newURL;
    (json.data as any).links = { self: newURL };
    return new Response(JSON.stringify(json, null, 2), {
      status: 201,
      headers: {
        'Last-Modified': formatRFC7231(lastModified),
        'Content-Type': 'application/vnd.api+json',
      },
    });
  }

  // Update card data
  if (request.method === 'PATCH') {
    if (reservedPathNames.includes(url.pathname)) {
      return methodNotAllowed(request);
    }
    let handle = await getLocalFileWithFallbacks(fs, url.pathname.slice(1), [
      '.json',
    ]);
    if (!handle.name.endsWith('.json')) {
      return methodNotAllowed(request);
    }

    let file = await handle.getFile();
    let original = JSON.parse(await getContents(file));
    if (!isCardJSON(original)) {
      return methodNotAllowed(request);
    }

    let patch = await request.json();
    delete patch.data.meta;
    delete patch.data.id;
    delete patch.data.type;
    let contents = merge(original, patch);
    let path = url.pathname.endsWith('.json')
      ? url.pathname
      : url.pathname + '.json';
    let lastModified = await write(
      fs,
      path.slice(1),
      JSON.stringify(contents, null, 2)
    );
    contents.data.id = url.pathname.replace(/\.json$/, '');
    return new Response(JSON.stringify(contents, null, 2), {
      headers: {
        'Last-Modified': formatRFC7231(lastModified),
        'Content-Type': 'application/vnd.api+json',
      },
    });
  }

  if (request.method === 'GET') {
    if (url.pathname === '/cards-of') {
      return await getCardsOf(searchIndex, request);
    }
    if (url.pathname === '/type-of') {
      return await getTypeOf(searchIndex, request);
    }

    // Get directory listing
    if (url.pathname.endsWith('/')) {
      let jsonapi = await getDirectoryListing(fs, url);
      if (!jsonapi) {
        return new Response(
          JSON.stringify({ errors: [`Could not find directory ${url.href}`] }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/vnd.api+json' },
          }
        );
      }

      return new Response(JSON.stringify(jsonapi, null, 2), {
        headers: { 'Content-Type': 'application/vnd.api+json' },
      });
    }

    let handle = await getLocalFileWithFallbacks(fs, url.pathname.slice(1), [
      '.json',
    ]);
    if (handle.name.endsWith('.json')) {
      let file = await handle.getFile();
      let json: object | undefined;
      try {
        json = JSON.parse(await getContents(file));
      } catch (err: unknown) {
        console.log(`The file ${url.href} is not parsable JSON`);
      }
      if (isCardJSON(json)) {
        // the only JSON API thing missing from the file serialization for our
        // card data is the ID
        (json as any).data.id = url.href.replace(/\.json$/, '');
        (json.data as any).links = { self: url.href.replace(/\.json$/, '') };
        return new Response(JSON.stringify(json, null, 2), {
          headers: {
            'Last-Modified': formatRFC7231(file.lastModified),
            'Content-Type': 'application/vnd.api+json',
          },
        });
      }
    }

    // otherwise, just serve the asset
    return await serveLocalFile(handle);
  }

  return new Response(
    JSON.stringify({
      errors: [
        `Don't know how to handle JSON-API request ${request.method} for ${url.href}`,
      ],
    }),
    {
      status: 500,
      headers: {
        'Content-Type': 'application/vnd.api+json',
      },
    }
  );
}

async function getDirectoryListing(
  fs: FileSystemDirectoryHandle,
  url: URL
): Promise<
  { data: ResourceObjectWithId; included?: ResourceObjectWithId[] } | undefined
> {
  let path = url.pathname;

  let dirHandle: FileSystemDirectoryHandle;
  if (path === '/') {
    dirHandle = fs;
  } else {
    try {
      let { handle, filename: dirname } = await traverse(
        fs,
        path.slice(1).replace(/\/$/, '')
      );
      // we assume that the final handle is a directory because we asked for a
      // path that ended in a '/'
      dirHandle = await handle.getDirectoryHandle(dirname);
    } catch (err: unknown) {
      if ((err as DOMException).name !== 'NotFoundError') {
        throw err;
      }
      console.log(`can't find file ${path} from the local realm`);
      return undefined;
    }
  }
  let ignoreFile = await getIgnorePatterns(dirHandle);
  let entries = await getDirectoryEntries(dirHandle, path, ignoreFile);

  let data: ResourceObjectWithId = {
    id: url.href,
    type: 'directory',
    relationships: {},
  };

  // Note that the entries are sorted such that the parent directory always
  // appears before the children
  for (let entry of entries) {
    let relationship: DirectoryEntryRelationship = {
      links: {
        related: new URL(entry.path, url.href).href,
      },
      meta: {
        kind: entry.handle.kind as 'directory' | 'file',
      },
    };

    data.relationships![
      entry.handle.name + (entry.handle.kind === 'directory' ? '/' : '')
    ] = relationship;
  }

  return { data };
}

async function getCardsOf(
  searchIndex: SearchIndex,
  request: Request
): Promise<Response> {
  let module = new URL(request.url).searchParams.get('module');
  if (!module) {
    return new Response(
      JSON.stringify({
        errors: [`?module param was not specified`],
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/vnd.api+json' },
      }
    );
  }
  let refs = await searchIndex.exportedCardsOf(module);
  return new Response(
    JSON.stringify(
      {
        data: {
          type: 'module',
          id: new URL(module, 'http://local-realm').href,
          attributes: {
            cardExports: refs,
          },
        },
      },
      null,
      2
    ),
    {
      headers: {
        'Content-Type': 'application/vnd.api+json',
      },
    }
  );
}

async function getTypeOf(
  _searchIndex: SearchIndex,
  _request: Request
): Promise<Response> {
  throw new Error('unimplemented');
}

function methodNotAllowed(request: Request): Response {
  return new Response(
    JSON.stringify({
      errors: [`${request.method} not allowed for ${request.url}`],
    }),
    {
      status: 405,
      headers: { 'Content-Type': 'application/vnd.api+json' },
    }
  );
}
