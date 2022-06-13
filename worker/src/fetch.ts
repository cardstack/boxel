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
    http://local-realm/

    http://local-realm/sources/path/to/file.gts -> file contents
    http://local-realm/sources/path/to/file -> 304 to file.gts
    http://local-realm/sources/path/to/ -> json directory listing

    http://local-realm/cards/path/to/source-module ->
     - unless source-module literally exists
       - try matching source-module + ['.gts', '.gjs', '.ts', '.js']
       (this is only because typescript is forcing our hand)
     - if file matches an executable exention, do the JS handling stuff
     - else do the asset serving

    http://local-realm/cards/path/to/some-json-data.json
     - means a json asset, with no special processing

    http://local-realm/cards/path/to/some-json-data
    with Accept: application/vnd.api+json.
      - means a card's data
 
    http://local-realm/cards/path/to/some-image.png
     - matches no specific extension, so is just an asset with no special handling
     - this is the same as the "json asset" example above


    Additional Notes:
    - we can consume npm packages from skypack. use pinned URL's to lock package deps.
      the convention can be to use reexports to manage package versions (that are pinned)
  */

  private async handleLocalRealm(
    _request: Request,
    url: URL
  ): Promise<Response> {
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
    return new Response(await handle.getFile());
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
