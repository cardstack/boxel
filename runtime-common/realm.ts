import { Deferred } from "./deferred";
import { SearchIndex, CardRef } from "./search-index";
import { Loader } from "./loader";
import { RealmPaths, LocalPath, join } from "./paths";
import {
  systemError,
  notFound,
  methodNotAllowed,
  badRequest,
} from "@cardstack/runtime-common/error";
import { formatRFC7231 } from "date-fns";
import {
  isCardResource,
  executableExtensions,
  isNode,
  isSingleCardDocument,
  type LooseSingleCardDocument,
  type ResourceObjectWithId,
  type DirectoryEntryRelationship,
  type Card,
  type CardAPI,
} from "./index";
import merge from "lodash/merge";
import cloneDeep from "lodash/cloneDeep";
import { webStreamToText } from "./stream";
import { preprocessEmbeddedTemplates } from "@cardstack/ember-template-imports/lib/preprocess-embedded-templates";
import * as babel from "@babel/core";
import makeEmberTemplatePlugin from "babel-plugin-ember-template-compilation";
//@ts-ignore no types are available
import * as etc from "ember-source/dist/ember-template-compiler";
import { externalsPlugin } from "./externals";
import { loaderPlugin } from "./loader-plugin";
//@ts-ignore no types are available
import glimmerTemplatePlugin from "@cardstack/ember-template-imports/src/babel-plugin";
//@ts-ignore no types are available
import decoratorsProposalPlugin from "@babel/plugin-proposal-decorators";
//@ts-ignore no types are available
import classPropertiesProposalPlugin from "@babel/plugin-proposal-class-properties";
//@ts-ignore ironically no types are available
import typescriptPlugin from "@babel/plugin-transform-typescript";
//@ts-ignore ironically no types are available
import emberConcurrencyAsyncPlugin from "ember-concurrency-async-plugin";
import { Router } from "./router";
import { parseQueryString } from "./query";
import type { Readable } from "stream";

export interface FileRef {
  path: LocalPath;
  content: ReadableStream<Uint8Array> | Readable | Uint8Array | string;
  lastModified: number;
}

interface ResponseWithNodeStream extends Response {
  nodeStream?: Readable;
}

export interface RealmAdapter {
  readdir(
    path: LocalPath,
    opts?: { create?: true }
  ): AsyncGenerator<{ name: string; path: LocalPath; kind: Kind }, void>;

  openFile(path: LocalPath): Promise<FileRef | undefined>;

  exists(path: LocalPath): Promise<boolean>;

  write(path: LocalPath, contents: string): Promise<{ lastModified: number }>;

  remove(path: LocalPath): Promise<void>;
}

export class Realm {
  #startedUp = new Deferred<void>();
  #searchIndex: SearchIndex;
  #adapter: RealmAdapter;
  readonly paths: RealmPaths;
  #jsonAPIRouter: Router;
  #cardSourceRouter: Router;

  get url(): string {
    return this.paths.url;
  }

  constructor(url: string, adapter: RealmAdapter) {
    this.paths = new RealmPaths(url);
    Loader.registerRealm(this);
    this.#adapter = adapter;
    this.#startedUp.fulfill((() => this.#startup())());
    this.#searchIndex = new SearchIndex(
      this,
      this.#adapter.readdir.bind(this.#adapter),
      this.readFileAsText.bind(this)
    );

    this.#jsonAPIRouter = new Router(new URL(url))
      .post("/", this.createCard.bind(this))
      .patch("/.+(?<!.json)", this.patchCard.bind(this))
      .get("/_search", this.search.bind(this))
      .get(".*/", this.getDirectoryListing.bind(this))
      .get("/.+(?<!.json)", this.getCard.bind(this))
      .delete("/.+(?<!.json)", this.removeCard.bind(this));

    this.#cardSourceRouter = new Router(new URL(url))
      .post(
        `/.+(${executableExtensions.map((e) => "\\" + e).join("|")})`,
        this.upsertCardSource.bind(this)
      )
      .get("/.+", this.getCardSourceOrRedirect.bind(this))
      .delete("/.+", this.removeCardSource.bind(this));
  }

  async write(
    path: LocalPath,
    contents: string
  ): Promise<{ lastModified: number }> {
    let results = await this.#adapter.write(path, contents);
    await this.#searchIndex.update(this.paths.fileURL(path));

    return results;
  }

  async delete(path: LocalPath): Promise<void> {
    await this.#adapter.remove(path);
    await this.#searchIndex.update(this.paths.fileURL(path), {
      delete: true,
    });
  }

  get searchIndex() {
    return this.#searchIndex;
  }

  async #startup() {
    await Promise.resolve();
    await this.#searchIndex.run();
  }

  get ready(): Promise<void> {
    return this.#startedUp.promise;
  }

  async handle(request: Request): Promise<ResponseWithNodeStream> {
    let url = new URL(request.url);
    if (request.headers.get("Accept")?.includes("application/vnd.api+json")) {
      await this.ready;
      if (!this.searchIndex) {
        return systemError("search index is not available");
      }
      return this.#jsonAPIRouter.handle(request);
    } else if (
      request.headers.get("Accept")?.includes("application/vnd.card+source")
    ) {
      return this.#cardSourceRouter.handle(request);
    }

    let maybeHandle = await this.getFileWithFallbacks(this.paths.local(url));

    if (!maybeHandle) {
      return notFound(request, `${request.url} not found`);
    }

    let handle = maybeHandle;

    if (
      executableExtensions.some((extension) => handle.path.endsWith(extension))
    ) {
      return this.makeJS(await this.fileContentToText(handle), handle.path);
    } else {
      return await this.serveLocalFile(handle);
    }
  }

  private async serveLocalFile(ref: FileRef): Promise<ResponseWithNodeStream> {
    if (
      ref.content instanceof ReadableStream ||
      ref.content instanceof Uint8Array ||
      typeof ref.content === "string"
    ) {
      return new Response(ref.content, {
        headers: {
          "last-modified": formatRFC7231(ref.lastModified),
        },
      });
    }

    if (!isNode) {
      throw new Error(`Cannot handle node stream in a non-node environment`);
    }

    // add the node stream to the response which will get special handling in the node env
    let response = new Response(null, {
      headers: {
        "last-modified": formatRFC7231(ref.lastModified),
      },
    }) as ResponseWithNodeStream;
    response.nodeStream = ref.content;
    return response;
  }

  private async upsertCardSource(request: Request): Promise<Response> {
    let { lastModified } = await this.write(
      this.paths.local(new URL(request.url)),
      await request.text()
    );
    return new Response(null, {
      status: 204,
      headers: {
        "last-modified": formatRFC7231(lastModified),
      },
    });
  }

  private async getCardSourceOrRedirect(
    request: Request
  ): Promise<ResponseWithNodeStream> {
    let localName = this.paths.local(new URL(request.url));
    let handle = await this.getFileWithFallbacks(localName);
    if (!handle) {
      return notFound(request, `${localName} not found`);
    }

    if (handle.path !== localName) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/${handle.path}`,
        },
      });
    }
    return await this.serveLocalFile(handle);
  }

  private async removeCardSource(request: Request): Promise<Response> {
    let localName = this.paths.local(new URL(request.url));
    let handle = await this.getFileWithFallbacks(localName);
    if (!handle) {
      return notFound(request, `${localName} not found`);
    }
    await this.delete(handle.path);
    return new Response(null, { status: 204 });
  }

  private transpileJS(content: string, debugFilename: string): string {
    content = preprocessEmbeddedTemplates(content, {
      relativePath: debugFilename,
      getTemplateLocals: etc._GlimmerSyntax.getTemplateLocals,
      templateTag: "template",
      templateTagReplacement: "__GLIMMER_TEMPLATE",
      includeSourceMaps: true,
      includeTemplateTokens: true,
    }).output;
    return babel.transformSync(content, {
      filename: debugFilename,
      plugins: [
        glimmerTemplatePlugin,
        emberConcurrencyAsyncPlugin,
        [typescriptPlugin, { allowDeclareFields: true }],
        [decoratorsProposalPlugin, { legacy: true }],
        classPropertiesProposalPlugin,
        // this "as any" is because typescript is using the Node-specific types
        // from babel-plugin-ember-template-compilation, but we're using the
        // browser interface
        isNode
          ? [
              makeEmberTemplatePlugin,
              {
                precompile: etc.precompile,
              },
            ]
          : (makeEmberTemplatePlugin as any)(() => etc.precompile),
        loaderPlugin,
        externalsPlugin,
      ],
    })!.code!;
  }

  private makeJS(content: string, debugFilename: string): Response {
    try {
      content = this.transpileJS(content, debugFilename);
    } catch (err: any) {
      return new Response(err.message, {
        // using "Not Acceptable" here because no text/javascript representation
        // can be made and we're sending text/html error page instead
        status: 406,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(content, {
      status: 200,
      headers: {
        "content-type": "text/javascript",
      },
    });
  }

  // we bother with this because typescript is picky about allowing you to use
  // explicit file extensions in your source code
  private async getFileWithFallbacks(
    path: LocalPath
  ): Promise<FileRef | undefined> {
    // TODO refactor to use search index

    let result = await this.#adapter.openFile(path);
    if (result) {
      return result;
    }

    for (let extension of executableExtensions) {
      result = await this.#adapter.openFile(path + extension);
      if (result) {
        return result;
      }
    }
    return undefined;
  }

  private async createCard(request: Request): Promise<Response> {
    let body = await request.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      return badRequest(`Request body is not valid card JSON-API`);
    }
    let { data: resource } = json;
    if (!isCardResource(resource)) {
      return badRequest(`Request body is not valid card JSON-API`);
    }

    // new instances are created in a folder named after the card
    let dirName = `/${join(
      new URL(this.url).pathname,
      resource.meta.adoptsFrom.name
    )}/`;
    let entries = await this.directoryEntries(new URL(dirName, this.url));
    let index = 0;
    if (entries) {
      for (let { name, kind } of entries) {
        if (kind === "directory") {
          continue;
        }
        if (!/^[\d]+\.json$/.test(name)) {
          continue;
        }
        let num = parseInt(name.replace(".json", ""));
        index = Math.max(index, num);
      }
    }
    let pathname = `${dirName}${++index}.json`;
    let fileURL = this.paths.fileURL(pathname);
    let localPath: LocalPath = this.paths.local(fileURL);
    let { lastModified } = await this.write(
      localPath,
      JSON.stringify(await this.fileSerialization(json, fileURL), null, 2)
    );
    let newURL = fileURL.href.replace(/\.json$/, "");
    if (!isSingleCardDocument(json)) {
      return badRequest(
        `bug: the card document is not actually a card document`
      );
    }
    json.data.id = newURL;
    json.data.links = { self: newURL };
    json.data.meta.lastModified = lastModified;
    if (!isSingleCardDocument(json)) {
      return systemError(
        `bug: constructed non-card document resource in JSON-API request for ${newURL}`
      );
    }
    return new Response(JSON.stringify(json, null, 2), {
      status: 201,
      headers: {
        "content-type": "application/vnd.api+json",
        ...lastModifiedHeader(json),
      },
    });
  }

  private async patchCard(request: Request): Promise<Response> {
    let localPath = this.paths.local(new URL(request.url));
    if (localPath.startsWith("_")) {
      return methodNotAllowed(request);
    }

    let url = this.paths.fileURL(localPath);
    let originalMaybeError = await this.#searchIndex.card(url);
    if (!originalMaybeError) {
      return notFound(request);
    }
    if (originalMaybeError.type === "error") {
      return systemError(originalMaybeError.error.message);
    }
    let {
      entry: { resource: original },
    } = originalMaybeError;

    let originalClone = cloneDeep(original);
    delete originalClone.meta.lastModified;

    let patch = await request.json();
    if (!isSingleCardDocument(patch)) {
      return badRequest(`The request body was not a card document`);
    }
    // prevent the client from changing the card type or ID in the patch
    delete (patch as any).data.meta;
    delete (patch as any).data.type;

    let card = merge({}, { data: originalClone }, patch);
    delete (card as any).data.id; // don't write the ID to the file
    let path: LocalPath = `${localPath}.json`;
    let { lastModified } = await this.write(
      path,
      JSON.stringify(await this.fileSerialization(card, url), null, 2)
    );
    card.data.id = url.href.replace(/\.json$/, "");
    card.data.links = { self: url.href };
    card.data.meta.lastModified = lastModified;
    return new Response(JSON.stringify(card, null, 2), {
      headers: {
        "content-type": "application/vnd.api+json",
        ...lastModifiedHeader(card),
      },
    });
  }

  private async getCard(request: Request): Promise<Response> {
    let localPath = this.paths.local(new URL(request.url));
    let url = this.paths.fileURL(localPath);
    let maybeError = await this.#searchIndex.card(url);
    if (!maybeError) {
      return notFound(request);
    }
    if (maybeError.type === "error") {
      return systemError(maybeError.error.message);
    }
    let {
      entry: { resource: data },
    } = maybeError;
    (data as any).links = { self: url.href };
    let card = { data };
    return new Response(JSON.stringify(card, null, 2), {
      headers: {
        "last-modified": formatRFC7231(card.data.meta.lastModified!),
        "content-type": "application/vnd.api+json",
        ...lastModifiedHeader(card),
      },
    });
  }

  private async removeCard(request: Request): Promise<Response> {
    let url = new URL(request.url);
    let data = await this.#searchIndex.card(url);
    if (!data) {
      return notFound(request);
    }
    let localPath = this.paths.local(url) + ".json";
    await this.delete(localPath);
    return new Response(null, { status: 204 });
  }

  private async directoryEntries(
    url: URL
  ): Promise<{ name: string; kind: Kind }[] | undefined> {
    if (await this.isIgnored(url)) {
      return undefined;
    }
    let path = this.paths.local(url);
    if (!(await this.#adapter.exists(path))) {
      return undefined;
    }
    let entries: { name: string; kind: Kind }[] = [];
    for await (let entry of this.#adapter.readdir(path)) {
      let innerPath = join(path, entry.name);
      let innerURL =
        entry.kind === "directory"
          ? this.paths.directoryURL(innerPath)
          : this.paths.fileURL(innerPath);
      if (await this.isIgnored(innerURL)) {
        continue;
      }
      entries.push(entry);
    }
    return entries;
  }

  private async getDirectoryListing(request: Request): Promise<Response> {
    // a LocalPath has no leading nor trailing slash
    let localPath: LocalPath = this.paths.local(new URL(request.url));
    let url = this.paths.directoryURL(localPath);
    let entries = await this.directoryEntries(url);
    if (!entries) {
      console.log(`can't find directory ${url.href}`);
      return notFound(request);
    }

    let data: ResourceObjectWithId = {
      id: url.href,
      type: "directory",
      relationships: {},
    };

    let dir = this.paths.local(url);
    // the entries are sorted such that the parent directory always
    // appears before the children
    entries.sort((a, b) =>
      `/${join(dir, a.name)}`.localeCompare(`/${join(dir, b.name)}`)
    );
    for (let entry of entries) {
      let relationship: DirectoryEntryRelationship = {
        links: {
          related:
            entry.kind === "directory"
              ? this.paths.directoryURL(join(dir, entry.name)).href
              : this.paths.fileURL(join(dir, entry.name)).href,
        },
        meta: {
          kind: entry.kind as "directory" | "file",
        },
      };

      data.relationships![
        entry.name + (entry.kind === "directory" ? "/" : "")
      ] = relationship;
    }

    return new Response(JSON.stringify({ data }, null, 2), {
      headers: { "content-type": "application/vnd.api+json" },
    });
  }

  private async readFileAsText(
    path: LocalPath,
    opts: { withFallbacks?: true } = {}
  ): Promise<{ content: string; lastModified: number } | undefined> {
    let ref: FileRef | undefined;
    if (opts.withFallbacks) {
      ref = await this.getFileWithFallbacks(path);
    } else {
      ref = await this.#adapter.openFile(path);
    }
    if (!ref) {
      return;
    }
    return {
      content: await this.fileContentToText(ref),
      lastModified: ref.lastModified,
    };
  }

  private async isIgnored(url: URL): Promise<boolean> {
    await this.ready;
    return this.#searchIndex.isIgnored(url);
  }

  private async fileContentToText({ content }: FileRef): Promise<string> {
    if (typeof content === "string") {
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
      const chunks: Buffer[] = []; // Buffer is available from globalThis when in the node env
      // the types for Readable have not caught up to the fact these are async generators
      for await (const chunk of content as any) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf-8");
    }
  }

  private async search(request: Request): Promise<Response> {
    let data = await this.#searchIndex.search(
      parseQueryString(new URL(request.url).search.slice(1))
    );
    return new Response(
      JSON.stringify(
        {
          data,
        },
        null,
        2
      ),
      {
        headers: { "content-type": "application/vnd.api+json" },
      }
    );
  }

  private async fileSerialization(
    doc: LooseSingleCardDocument,
    relativeTo: URL
  ): Promise<LooseSingleCardDocument> {
    let api = await this.searchIndex.loader.import<CardAPI>(
      "https://cardstack.com/base/card-api"
    );
    let card: Card = await api.createFromSerialized(doc, relativeTo, {
      loader: this.searchIndex.loader,
    });
    let data: LooseSingleCardDocument = api.serializeCard(card); // this strips out computeds
    return data;
  }
}

export type Kind = "file" | "directory";

export function getExportedCardContext(ref: CardRef): {
  module: string;
  name: string;
} {
  if (ref.type === "exportedCard") {
    return { module: ref.module, name: ref.name };
  } else {
    return getExportedCardContext(ref.card);
  }
}

function lastModifiedHeader(
  card: LooseSingleCardDocument
): {} | { "last-modified": string } {
  return (
    card.data.meta.lastModified != null
      ? { "last-modified": formatRFC7231(card.data.meta.lastModified) }
      : {}
  ) as {} | { "last-modified": string };
}

export interface CardDefinitionResource {
  id: string;
  type: "card-definition";
  attributes: {
    cardRef: CardRef;
  };
  relationships: {
    [fieldName: string]: {
      links: {
        related: string;
      };
      meta: {
        type: "super" | "contains" | "containsMany";
        ref: CardRef;
      };
    };
  };
}
