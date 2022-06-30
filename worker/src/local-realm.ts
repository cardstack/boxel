import { Realm, Kind, executableExtensions } from '@cardstack/runtime-common';
import { systemError } from '@cardstack/runtime-common/error';
import { traverse } from './file-system';
import { getLocalFileWithFallbacks, serveLocalFile } from './file-system';
import { readFileAsText } from './util';
import { formatRFC7231 } from 'date-fns';
import { preprocessEmbeddedTemplates } from 'ember-template-imports/lib/preprocess-embedded-templates';
import * as babel from '@babel/core';
import makeEmberTemplatePlugin from 'babel-plugin-ember-template-compilation';
import * as etc from 'ember-source/dist/ember-template-compiler';
import { externalsPlugin } from './externals';
import glimmerTemplatePlugin from 'ember-template-imports/src/babel-plugin';
import decoratorsProposalPlugin from '@babel/plugin-proposal-decorators';
import classPropertiesProposalPlugin from '@babel/plugin-proposal-class-properties';
//@ts-ignore unsure where these types live
import typescriptPlugin from '@babel/plugin-transform-typescript';

export class LocalRealm extends Realm {
  constructor(private fs: FileSystemDirectoryHandle) {
    super('http://local-realm');
  }

  protected async *readdir(
    path: string,
    opts?: { create?: true }
  ): AsyncGenerator<{ name: string; path: string; kind: Kind }, void> {
    let dirHandle = isTopPath(path)
      ? this.fs
      : await traverse(this.fs, path, 'directory', opts);
    for await (let [name, handle] of dirHandle as unknown as AsyncIterable<
      [string, FileSystemDirectoryHandle | FileSystemFileHandle]
    >) {
      // note that the path of a directory always ends in "/"
      let innerPath = isTopPath(path) ? name : `${path}${name}`;
      yield { name, path: innerPath, kind: handle.kind };
    }
  }

  protected async openFile(path: string): Promise<ReadableStream<Uint8Array>> {
    let fileHandle = await traverse(this.fs, path, 'file');
    let file = await fileHandle.getFile();
    return file.stream() as unknown as ReadableStream<Uint8Array>;
  }

  protected async statFile(path: string): Promise<{ lastModified: number }> {
    let fileHandle = await traverse(this.fs, path, 'file');
    let file = await fileHandle.getFile();
    let { lastModified } = file;
    return { lastModified };
  }

  protected async write(
    path: string,
    contents: string
  ): Promise<{ lastModified: number }> {
    let handle = await traverse(this.fs, path, 'file', { create: true });
    // TypeScript seems to lack types for the writable stream features
    let stream = await (handle as any).createWritable();
    await stream.write(contents);
    await stream.close();
    let { lastModified } = await handle.getFile();
    return { lastModified };
  }

  // TODO refactor to get as much implementation in this base class as possible.
  // currently there is a bunch of stuff relying on fs--so break that down to use
  // the search index instead
  async handle(request: Request): Promise<Response> {
    let url = new URL(request.url);
    if (request.headers.get('Accept')?.includes('application/vnd.api+json')) {
      await this.ready;
      if (!this.searchIndex) {
        return systemError('search index is not available');
      }
      return await this.handleJSONAPI(request);
    } else if (
      request.headers.get('Accept')?.includes('application/vnd.card+source')
    ) {
      return this.handleCardSource(request, url);
    }

    let handle = await getLocalFileWithFallbacks(
      this.fs,
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

  private async handleCardSource(
    request: Request,
    url: URL
  ): Promise<Response> {
    if (request.method === 'POST') {
      let { lastModified } = await this.write(
        new URL(request.url).pathname,
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
      this.fs,
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
}

function isTopPath(path: string): boolean {
  return path === '';
}
