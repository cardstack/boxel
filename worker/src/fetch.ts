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
import { formatRFC7231 } from 'date-fns';
import {
  write,
  getLocalFileWithFallbacks,
  serveLocalFile,
} from './file-system';
import { handle as handleJSONAPI } from './json-api';
import { executableExtensions } from '@cardstack/runtime-common';
import { SearchIndex } from '@cardstack/runtime-common/search-index';
import { LocalRealm } from './local-realm';

export class FetchHandler {
  private baseURL: string;
  private livenessWatcher: LivenessWatcher;
  private messageHandler: MessageHandler;
  private searchIndex: SearchIndex | undefined;
  private localRealm: LocalRealm | undefined;
  private finishedIndexing!: () => void;
  runningIndexing: Promise<void>;

  constructor(worker: ServiceWorkerGlobalScope) {
    this.baseURL = worker.registration.scope;
    this.runningIndexing = new Promise((res) => (this.finishedIndexing = res));
    this.livenessWatcher = new LivenessWatcher(worker, async () => {
      await this.doCacheDrop();
    });
    this.messageHandler = new MessageHandler(worker);
    (async () => await this.runIndexAll())();
  }

  private async runIndexAll() {
    await this.messageHandler.startingUp;
    if (!this.messageHandler.fs) {
      throw new Error(`could not get FileSystem`);
    }
    this.localRealm = new LocalRealm(this.messageHandler.fs);
    this.searchIndex = new SearchIndex(this.localRealm);
    await this.searchIndex.run();
    this.finishedIndexing();
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
    if (!this.messageHandler.fs) {
      throw WorkerError.withResponse(
        new Response('no local realm is available', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        })
      );
    }

    if (request.headers.get('Accept')?.includes('application/vnd.api+json')) {
      await this.runningIndexing;
      if (!this.searchIndex) {
        throw WorkerError.withResponse(
          new Response('search index is not available', {
            status: 500,
            headers: { 'content-type': 'text/html' },
          })
        );
      }
      if (!this.localRealm) {
        throw WorkerError.withResponse(
          new Response('local realm is not available', {
            status: 500,
            headers: { 'content-type': 'text/html' },
          })
        );
      }
      return handleJSONAPI(
        this.messageHandler.fs,
        this.searchIndex,
        request,
        url
      );
    } else if (
      request.headers.get('Accept')?.includes('application/vnd.card+source')
    ) {
      return this.handleCardSource(request, url);
    }

    let handle = await getLocalFileWithFallbacks(
      this.messageHandler.fs,
      url.pathname.slice(1),
      executableExtensions
    );
    if (
      executableExtensions.some((extension) => handle.name.endsWith(extension))
    ) {
      return await this.makeJS(handle);
    } else {
      return await serveLocalFile(handle);
    }
  }

  private async handleCardSource(
    request: Request,
    url: URL
  ): Promise<Response> {
    if (!this.messageHandler.fs) {
      throw WorkerError.withResponse(
        new Response('no local realm is available', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        })
      );
    }

    if (request.method === 'POST') {
      let lastModified = await write(
        this.messageHandler.fs,
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
    let handle = await getLocalFileWithFallbacks(
      this.messageHandler.fs,
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
    return await serveLocalFile(handle);
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
