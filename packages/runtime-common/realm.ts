import { Deferred } from "./deferred";
import {
  SearchIndex,
  type IndexRunner,
  type RunnerOptionsManager,
} from "./search-index";
import { type SingleCardDocument } from "./card-document";
import { Loader, type MaybeLocalRequest } from "./loader";
import { RealmPaths, LocalPath, join } from "./paths";
import {
  systemError,
  notFound,
  methodNotAllowed,
  badRequest,
  CardError,
} from "./error";
import { formatRFC7231 } from "date-fns";
import {
  isCardResource,
  executableExtensions,
  isNode,
  isSingleCardDocument,
  type CardRef,
  type LooseSingleCardDocument,
  type ResourceObjectWithId,
  type DirectoryEntryRelationship,
} from "./index";
import merge from "lodash/merge";
import qs from "qs";
import cloneDeep from "lodash/cloneDeep";
import {
  fileContentToText,
  readFileAsText,
  getFileWithFallbacks,
} from "./stream";
import { preprocessEmbeddedTemplates } from "@cardstack/ember-template-imports/lib/preprocess-embedded-templates";
import * as babel from "@babel/core";
import makeEmberTemplatePlugin from "babel-plugin-ember-template-compilation";
//@ts-ignore no types are available
import * as etc from "ember-source/dist/ember-template-compiler";
import { loaderPlugin } from "./loader-plugin";
//@ts-ignore no types are available
import glimmerTemplatePlugin from "@cardstack/ember-template-imports/src/babel-plugin";
//@ts-ignore no types are available
import decoratorsProposalPlugin from "@babel/plugin-proposal-decorators";
//@ts-ignore no types are available
import classPropertiesProposalPlugin from "@babel/plugin-proposal-class-properties";
//@ts-ignore ironically no types are available
import typescriptPlugin from "@babel/plugin-transform-typescript";
//@ts-ignore no types are available
import emberConcurrencyAsyncPlugin from "ember-concurrency-async-plugin";
import { Router } from "./router";
import { parseQueryString } from "./query";
//@ts-ignore service worker can't handle this
import type { Readable } from "stream";
import { Card } from "https://cardstack.com/base/card-api";
import type * as CardAPI from "https://cardstack.com/base/card-api";
import type { LoaderType } from "https://cardstack.com/base/card-api";
import { createResponse } from "./create-response";

export interface FileRef {
  path: LocalPath;
  content: ReadableStream<Uint8Array> | Readable | Uint8Array | string;
  lastModified: number;
}

interface ResponseWithNodeStream extends Response {
  nodeStream?: Readable;
}

interface FastBootOptions {
  resilient?: boolean;
  request?: {
    headers?: {
      host?: string;
    };
  };
}

type DOMContents = () => {
  head: string;
  body: string;
};

interface FastBootVisitResult {
  html(): string;
  domContents(): DOMContents;
}

export interface FastBootInstance {
  visit(url: string, opts?: FastBootOptions): Promise<FastBootVisitResult>;
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

interface Options {
  deferStartUp?: true;
}

export class Realm {
  #startedUp = new Deferred<void>();
  #searchIndex: SearchIndex;
  #adapter: RealmAdapter;
  #jsonAPIRouter: Router;
  #cardSourceRouter: Router;
  #deferStartup: boolean;
  readonly paths: RealmPaths;

  get url(): string {
    return this.paths.url;
  }

  constructor(
    url: string,
    adapter: RealmAdapter,
    indexRunner: IndexRunner,
    runnerOptsMgr: RunnerOptionsManager,
    opts?: Options
  ) {
    this.paths = new RealmPaths(url);
    Loader.registerURLHandler(new URL(url), this.handle.bind(this));
    this.#adapter = adapter;
    this.#searchIndex = new SearchIndex(
      this,
      this.#adapter.readdir.bind(this.#adapter),
      this.readFileAsText.bind(this),
      indexRunner,
      runnerOptsMgr
    );

    this.#jsonAPIRouter = new Router(new URL(url))
      .post("/", this.createCard.bind(this))
      .patch("/.+(?<!.json)", this.patchCard.bind(this))
      .get("/_search", this.search.bind(this))
      .get("/_message", this.subscribe.bind(this))
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

    this.#deferStartup = opts?.deferStartUp ?? false;
    if (!opts?.deferStartUp) {
      this.#startedUp.fulfill((() => this.#startup())());
    }
  }

  // it's only necessary to call this when the realm is using a deferred startup
  async start() {
    if (this.#deferStartup) {
      this.#startedUp.fulfill((() => this.#startup())());
    }
    await this.ready;
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

  async handle(request: MaybeLocalRequest): Promise<ResponseWithNodeStream> {
    let url = new URL(request.url);
    let accept = request.headers.get("Accept");
    if (url.search.length > 0) {
      let { acceptHeader } = qs.parse(url.search, { ignoreQueryPrefix: true });
      if (acceptHeader && typeof acceptHeader === "string") {
        accept = acceptHeader;
      }
    }
    if (
      accept?.includes("application/vnd.api+json") ||
      accept === "text/event-stream"
    ) {
      // local requests are allowed to query the realm as the index is being built up
      if (!request.isLocal && url.host !== "local-realm") {
        await this.ready;
      }
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
      return this.makeJS(await fileContentToText(handle), handle.path);
    } else {
      return await this.serveLocalFile(handle);
    }
  }

  private async subscribe(req: Request): Promise<Response> {
    return handleSSE(req.url ?? undefined);
  }

  private async serveLocalFile(ref: FileRef): Promise<ResponseWithNodeStream> {
    if (
      ref.content instanceof ReadableStream ||
      ref.content instanceof Uint8Array ||
      typeof ref.content === "string"
    ) {
      return createResponse(ref.content, {
        headers: {
          "last-modified": formatRFC7231(ref.lastModified),
        },
      });
    }

    if (!isNode) {
      throw new Error(`Cannot handle node stream in a non-node environment`);
    }

    // add the node stream to the response which will get special handling in the node env
    let response = createResponse(null, {
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
    return createResponse(null, {
      status: 204,
      headers: { "last-modified": formatRFC7231(lastModified) },
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
      return createResponse(null, {
        status: 302,
        headers: { Location: `/${handle.path}` },
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
    return createResponse(null, { status: 204 });
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
      compact: false, // this helps for readability when debugging
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
      ],
    })!.code!;
  }

  private makeJS(content: string, debugFilename: string): Response {
    try {
      content = this.transpileJS(content, debugFilename);
    } catch (err: any) {
      return createResponse(err.message, {
        // using "Not Acceptable" here because no text/javascript representation
        // can be made and we're sending text/html error page instead
        status: 406,
        headers: { "content-type": "text/html" },
      });
    }
    return createResponse(content, {
      status: 200,
      headers: { "content-type": "text/javascript" },
    });
  }

  // we bother with this because typescript is picky about allowing you to use
  // explicit file extensions in your source code
  private async getFileWithFallbacks(
    path: LocalPath
  ): Promise<FileRef | undefined> {
    return getFileWithFallbacks(
      path,
      this.#adapter.openFile.bind(this.#adapter)
    );
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

    let name: string;
    if ("name" in resource.meta.adoptsFrom) {
      // new instances are created in a folder named after the card if it has an
      // exported name
      name = resource.meta.adoptsFrom.name;
    } else {
      name = "cards";
    }

    let dirName = `/${join(new URL(this.url).pathname, name)}/`;
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
    let entry = await this.#searchIndex.card(new URL(newURL), {
      loadLinks: true,
    });
    if (!entry || entry?.type === "error") {
      let err = entry
        ? CardError.fromSerializableError(entry.error)
        : undefined;
      return systemError(
        `Unable to index new card, can't find new instance in index`,
        err
      );
    }
    let doc: SingleCardDocument = merge({}, entry.doc, {
      data: {
        links: { self: newURL },
        meta: { lastModified },
      },
    });
    return createResponse(JSON.stringify(doc, null, 2), {
      status: 201,
      headers: {
        "content-type": "application/vnd.api+json",
        ...lastModifiedHeader(doc),
      },
    });
  }

  private async patchCard(request: Request): Promise<Response> {
    // strip off query params
    let localPath = this.paths.local(
      new URL(new URL(request.url).pathname, request.url)
    );
    if (localPath.startsWith("_")) {
      return methodNotAllowed(request);
    }

    let url = this.paths.fileURL(localPath);
    let originalMaybeError = await this.#searchIndex.card(url);
    if (!originalMaybeError) {
      return notFound(request);
    }
    if (originalMaybeError.type === "error") {
      return systemError(
        `unable to patch card, cannot load original from index`,
        CardError.fromSerializableError(originalMaybeError.error)
      );
    }
    let { doc: original } = originalMaybeError;
    let originalClone = cloneDeep(original);
    delete originalClone.data.meta.lastModified;

    let patch = await request.json();
    if (!isSingleCardDocument(patch)) {
      return badRequest(`The request body was not a card document`);
    }
    // prevent the client from changing the card type or ID in the patch
    delete (patch as any).data.meta;
    delete (patch as any).data.type;

    let card = merge({}, originalClone, patch);
    delete (card as any).data.id; // don't write the ID to the file
    let path: LocalPath = `${localPath}.json`;
    let { lastModified } = await this.write(
      path,
      JSON.stringify(await this.fileSerialization(card, url), null, 2)
    );
    let instanceURL = url.href.replace(/\.json$/, "");
    let entry = await this.#searchIndex.card(new URL(instanceURL), {
      loadLinks: true,
    });
    if (!entry || entry?.type === "error") {
      return systemError(
        `Unable to index card: can't find patched instance in index`,
        entry ? CardError.fromSerializableError(entry.error) : undefined
      );
    }
    let doc: SingleCardDocument = merge({}, entry.doc, {
      data: {
        links: { self: instanceURL },
        meta: { lastModified },
      },
    });
    return createResponse(JSON.stringify(doc, null, 2), {
      headers: {
        "content-type": "application/vnd.api+json",
        ...lastModifiedHeader(doc),
      },
    });
  }

  private async getCard(request: Request): Promise<Response> {
    // strip off query params
    let localPath = this.paths.local(
      new URL(new URL(request.url).pathname, request.url)
    );
    let url = this.paths.fileURL(localPath);
    let maybeError = await this.#searchIndex.card(url, { loadLinks: true });
    if (!maybeError) {
      return notFound(request);
    }
    if (maybeError.type === "error") {
      return systemError(
        `cannot return card from index: ${maybeError.error.title} - ${maybeError.error.detail}`,
        CardError.fromSerializableError(maybeError.error)
      );
    }
    let { doc: card } = maybeError;
    card.data.links = { self: url.href };
    return createResponse(JSON.stringify(card, null, 2), {
      headers: {
        "last-modified": formatRFC7231(card.data.meta.lastModified!),
        "content-type": "application/vnd.api+json",
        ...lastModifiedHeader(card),
      },
    });
  }

  private async removeCard(request: Request): Promise<Response> {
    // strip off query params
    let url = new URL(new URL(request.url).pathname, request.url);
    let result = await this.#searchIndex.card(url);
    if (!result) {
      return notFound(request);
    }
    let localPath = this.paths.local(url) + ".json";
    await this.delete(localPath);
    return createResponse(null, { status: 204 });
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

    return createResponse(JSON.stringify({ data }, null, 2), {
      headers: { "content-type": "application/vnd.api+json" },
    });
  }

  private async readFileAsText(
    path: LocalPath,
    opts: { withFallbacks?: true } = {}
  ): Promise<{ content: string; lastModified: number } | undefined> {
    return readFileAsText(
      path,
      this.#adapter.openFile.bind(this.#adapter),
      opts
    );
  }

  private async isIgnored(url: URL): Promise<boolean> {
    await this.ready;
    return this.#searchIndex.isIgnored(url);
  }

  private async search(request: Request): Promise<Response> {
    let doc = await this.#searchIndex.search(
      parseQueryString(new URL(request.url).search.slice(1)),
      { loadLinks: true }
    );
    return createResponse(JSON.stringify(doc, null, 2), {
      headers: { "content-type": "application/vnd.api+json" },
    });
  }

  private async fileSerialization(
    doc: LooseSingleCardDocument,
    relativeTo: URL
  ): Promise<LooseSingleCardDocument> {
    let api = await this.searchIndex.loader.import<typeof CardAPI>(
      "https://cardstack.com/base/card-api"
    );
    let card: Card = await api.createFromSerialized(doc.data, doc, relativeTo, {
      loader: this.searchIndex.loader as unknown as LoaderType,
    });
    let data: LooseSingleCardDocument = api.serializeCard(card); // this strips out computeds
    delete data.data.id; // the ID is derived from the filename, so we don't serialize it on disk
    delete data.included;
    for (let relationship of Object.values(data.data.relationships ?? {})) {
      delete relationship.data;
    }
    return data;
  }
}

export type Kind = "file" | "directory";

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

function handleSSE(data?: string) {
  let headers = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };
  return createResponse(`data: ${data}\n\n`, {
    status: 200,
    headers,
  });
}
