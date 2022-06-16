import { LivenessWatcher } from './liveness';
import { MessageHandler } from './message-handler';
import { readFileAsText } from './util';
import { WorkerError } from './error';
import * as babel from '@babel/core';
import { externalsPlugin, generateExternalStub } from './externals';
import makeEmberTemplatePlugin from 'babel-plugin-ember-template-compilation';
import * as etc from 'ember-source/dist/ember-template-compiler';
import { preprocessEmbeddedTemplates } from 'ember-template-imports/lib/preprocess-embedded-templates';
import glimmerTemplatePlugin from 'ember-template-imports/src/babel-plugin';
import decoratorsProposalPlugin from '@babel/plugin-proposal-decorators';
import classPropertiesProposalPlugin from '@babel/plugin-proposal-class-properties';
//@ts-ignore unsure where these types live
import typescriptPlugin from '@babel/plugin-transform-typescript';
import { DirectoryEntryRelationship } from '@cardstack/runtime-common';
import { formatRFC7231 } from 'date-fns';
import { isCardJSON, ResourceObjectWithId } from '@cardstack/runtime-common';
import ignore from 'ignore';

const executableExtensions = ['.js', '.gjs', '.ts', '.gts'];

export class FetchHandler {
  private baseURL: string;
  private livenessWatcher: LivenessWatcher;
  private messageHandler: MessageHandler;

  constructor(worker: ServiceWorkerGlobalScope) {
    this.baseURL = worker.registration.scope;
    this.livenessWatcher = new LivenessWatcher(worker, async () => {
      await this.doCacheDrop();
    });
    this.messageHandler = new MessageHandler(worker);
  }

  async handleFetch(request: Request): Promise<Response> {
    try {
      if (!this.livenessWatcher.alive) {
        // if we're shutting down, let all requests pass through unchanged
        return await fetch(request);
      }

      let searchParams = new URL(request.url).searchParams;
      if (searchParams.get('dropcache') != null) {
        return await this.doCacheDrop();
      }

      let url = new URL(request.url);

      if (
        url.origin === 'http://cardstack.com' &&
        url.pathname.startsWith('/base/')
      ) {
        return generateExternalStub(
          url.pathname.replace('/base/', 'runtime-spike/lib/')
        );
      }
      if (url.origin === 'http://local-realm') {
        return await this.handleLocalRealm(request, url);
      }
      if (url.origin === 'http://externals') {
        return generateExternalStub(url.pathname.slice(1));
      }

      console.log(
        `Service worker on ${this.baseURL} passing through ${request.url}`
      );
      return await fetch(request);
    } catch (err) {
      if (err instanceof WorkerError) {
        return err.response;
      }
      console.error(err);
      return new Response(`unexpected exception in service worker ${err}`, {
        status: 500,
      });
    }
  }

  /*

    If we have `Accept: application/vnd.api+json`

      If request ends in slash, we're serving a JSON directory listing. It will
      be an error if we don't find a matching directory.

      Else this is a card data request. It will be an error if we don't find a
      matching json file. (The .json extension is assumed, not explicit in the
      request url)

    Else if `Accept: application/vnd.card+source`

      If file exists, serve it with no preprocessing. This is for source inspection & editing.

      Else keep appending extensions to look for  match: gts, gjs, ts, js
        if found, serve a 302
        else serve a 404

    Else

      Locate a file, by first trying the exact URL and then appending extensions

      if a file is found

        if it ends in an executable extension, apply the JS preprocessing rules

      serve the file
    

  */

  private async handleLocalRealm(
    request: Request,
    url: URL
  ): Promise<Response> {
    if (request.headers.get('Accept')?.includes('application/vnd.api+json')) {
      return this.handleJSONAPI(request, url);
    } else if (
      request.headers.get('Accept')?.includes('application/vnd.card+source')
    ) {
      return this.handleCardSource(request, url);
    }

    let handle = await this.getLocalFileWithFallbacks(
      url.pathname.slice(1),
      executableExtensions
    );
    if (
      executableExtensions.some((extension) => handle.name.endsWith(extension))
    ) {
      return await this.makeJS(handle);
    } else {
      return await this.serveLocalFile(handle);
    }
  }

  private async handleCardSource(
    request: Request,
    url: URL
  ): Promise<Response> {
    if (request.method === 'POST') {
      let lastModified = await this.write(
        new URL(request.url).pathname.slice(1),
        await request.text()
      );
      return new Response(null, {
        status: 204,
        headers: {
          'Last-Modified': formatRFC7231(lastModified),
        },
      });
    }
    let handle = await this.getLocalFileWithFallbacks(
      url.pathname.slice(1),
      executableExtensions
    );
    let pathSegments = url.pathname.split('/');
    let requestedName = pathSegments.pop()!;
    if (handle.name !== requestedName) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: [...pathSegments, handle.name].join('/'),
        },
      });
    }
    return await this.serveLocalFile(handle);
  }

  private async handleJSONAPI(request: Request, url: URL): Promise<Response> {
    if (request.method === 'POST') {
      let requestBody = await request.json();
      delete requestBody.data.id;
      let path = new URL(request.url).pathname.slice(1);
      path = path.endsWith('.json') ? path : `${path}.json`;
      let lastModified = await this.write(
        path,
        JSON.stringify(requestBody, null, 2)
      );
      requestBody.data.id = request.url.replace(/\/.json$/, '');
      return new Response(JSON.stringify(requestBody, null, 2), {
        headers: {
          'Last-Modified': formatRFC7231(lastModified),
        },
      });
    }

    if (url.pathname.endsWith('/')) {
      let jsonapi = await this.getDirectoryListing(url);
      if (!jsonapi) {
        new Response(
          JSON.stringify({ errors: [`Could not find directory ${url.href}`] }),
          {
            status: 404,
            headers: { 'content-type': 'application/vnd.api+json' },
          }
        );
      }

      return new Response(JSON.stringify(jsonapi, null, 2), {
        headers: { 'content-type': 'application/vnd.api+json' },
      });
    }

    let handle = await this.getLocalFileWithFallbacks(url.pathname.slice(1), [
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
        return new Response(JSON.stringify(json, null, 2), {
          headers: {
            'Last-Modified': formatRFC7231(file.lastModified),
            'Content-Type': 'application/vnd.api+json',
          },
        });
      }
    }

    // otherwise, just serve the asset
    return await this.serveLocalFile(handle);
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

  private async getDirectoryListing(
    url: URL
  ): Promise<
    | { data: ResourceObjectWithId; included?: ResourceObjectWithId[] }
    | undefined
  > {
    if (!this.messageHandler.fs) {
      throw WorkerError.withResponse(
        new Response('no local realm is available', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        })
      );
    }
    let path = url.pathname;

    let dirHandle: FileSystemDirectoryHandle;
    if (path === '/') {
      dirHandle = this.messageHandler.fs;
    } else {
      try {
        let { handle, filename: dirname } = await traverse(
          this.messageHandler.fs,
          path.slice(1).replace(/\/$/, '')
        );
        // we assume that the final handle is a directory because we asked for a
        // path that ended in a '/'
        dirHandle = await handle.getDirectoryHandle(dirname, { create: true });
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

  private async makeJS(handle: FileSystemFileHandle): Promise<Response> {
    let content = await readFileAsText(handle);
    try {
      content = preprocessEmbeddedTemplates(content, {
        relativePath: handle.name,
        getTemplateLocals: etc._GlimmerSyntax.getTemplateLocals,
        templateTag: 'template',
        templateTagReplacement: '__GLIMMER_TEMPLATE',
        includeSourceMaps: true,
        includeTemplateTokens: true,
      }).output;
      content = babel.transformSync(content, {
        filename: handle.name,
        plugins: [
          glimmerTemplatePlugin,
          typescriptPlugin,
          [decoratorsProposalPlugin, { legacy: true }],
          classPropertiesProposalPlugin,
          // this "as any" is because typescript is using the Node-specific types
          // from babel-plugin-ember-template-compilation, but we're using the
          // browser interface
          (makeEmberTemplatePlugin as any)(() => etc.precompile),
          externalsPlugin,
        ],
      })!.code!;
    } catch (err: any) {
      Promise.resolve().then(() => {
        throw err;
      });
      return new Response(err.message, {
        // using "Not Acceptable" here because no text/javascript representation
        // can be made and we're sending text/html error page instead
        status: 406,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response(content, {
      status: 200,
      headers: {
        'content-type': 'text/javascript',
      },
    });
  }

  private async serveLocalFile(
    handle: FileSystemFileHandle
  ): Promise<Response> {
    let file = await handle.getFile();
    return new Response(file, {
      headers: {
        'Last-Modified': formatRFC7231(file.lastModified),
      },
    });
  }

  private async write(path: string, contents: string): Promise<number> {
    if (!this.messageHandler.fs) {
      throw WorkerError.withResponse(
        new Response('no local realm is available', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        })
      );
    }
    let { handle: dirHandle, filename } = await traverse(
      this.messageHandler.fs,
      path,
      { create: true }
    );
    let handle = await dirHandle.getFileHandle(filename, { create: true });
    // TypeScript seems to lack types for the writable stream features
    let stream = await (handle as any).createWritable();
    await stream.write(contents);
    await stream.close();
    return (await handle.getFile()).lastModified;
  }

  // we bother with this because typescript is picky about allowing you to use
  // explicit file extensions in your source code
  private async getLocalFileWithFallbacks(
    path: string,
    extensions: string[]
  ): Promise<FileSystemFileHandle> {
    try {
      return await this.getLocalFile(path);
    } catch (err) {
      if (!(err instanceof WorkerError) || err.response.status !== 404) {
        throw err;
      }
      for (let extension of extensions) {
        try {
          return await this.getLocalFile(path + extension);
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

  private async getLocalFile(path: string): Promise<FileSystemFileHandle> {
    if (!this.messageHandler.fs) {
      throw WorkerError.withResponse(
        new Response('no local realm is available', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        })
      );
    }
    try {
      let { handle, filename } = await traverse(this.messageHandler.fs, path);
      return await handle.getFileHandle(filename);
    } catch (err) {
      if ((err as DOMException).name === 'NotFoundError') {
        throw WorkerError.withResponse(
          new Response(`${path} not found in local realm`, {
            status: 404,
            headers: { 'content-type': 'text/html' },
          })
        );
      }
      throw err;
    }
  }

  private async doCacheDrop() {
    let names = await globalThis.caches.keys();
    for (let name of names) {
      await self.caches.delete(name);
    }
    return new Response(`Caches dropped!`, {
      headers: {
        'content-type': 'text/html',
      },
    });
  }
}

async function getContents(file: File): Promise<string> {
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

async function getDirectoryEntries(
  directoryHandle: FileSystemDirectoryHandle,
  parentDir: string,
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
    let path = `${parentDir}${handle.name}`;
    entries.push({
      handle,
      path: handle.kind === 'directory' ? `${path}/` : path,
    });
  }
  return filterIgnoredEntries(entries, ignoreFile);
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
    entries.map((e) => e.path.slice(1)),
    patterns
  );
  return entries.filter((entry) => filteredPaths.includes(entry.path.slice(1)));
}

function filterIgnored(paths: string[], patterns: string): string[] {
  return ignore().add(patterns).filter(paths);
}

async function traverse(
  dirHandle: FileSystemDirectoryHandle,
  path: string,
  opts?: { create?: boolean }
): Promise<{ handle: FileSystemDirectoryHandle; filename: string }> {
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
  return { handle, filename: pathSegments[0] };
}
