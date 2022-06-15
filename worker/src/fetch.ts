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
import { traverse } from '@cardstack/runtime-common';
import { formatRFC7231 } from 'date-fns';
import { isCardJSON } from '@cardstack/runtime-common';

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

    if (request.headers.get('Accept')?.includes('application/vnd.api+json')) {
      return this.handleJSONAPI(url);
    } else if (
      request.headers.get('Accept')?.includes('application/vnd.card+source')
    ) {
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

  private async handleJSONAPI(url: URL): Promise<Response> {
    // handle directories
    let handle = await this.getLocalFile(url.pathname.slice(1));
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
        (json as any).data.id = url.href; // should we trim the ".json" from the ID?
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
