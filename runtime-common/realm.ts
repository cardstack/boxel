import { Deferred } from "./deferred";
import {
  SearchIndex,
  isCardRef,
  CardRef,
  CardDocument,
  isCardDocument,
} from "./search-index";
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
  isCardJSON,
  ResourceObjectWithId,
  DirectoryEntryRelationship,
  executableExtensions,
  baseRealm,
} from "./index";
import merge from "lodash/merge";
import { parse, stringify } from "qs";
import { webStreamToText } from "./stream";
import { preprocessEmbeddedTemplates } from "@cardstack/ember-template-imports/lib/preprocess-embedded-templates";
import * as babel from "@babel/core";
import makeEmberTemplatePlugin from "babel-plugin-ember-template-compilation";
//@ts-ignore no types are available
import * as etc from "ember-source/dist/ember-template-compiler";
import { externalsPlugin } from "./externals";
//@ts-ignore no types are available
import glimmerTemplatePlugin from "@cardstack/ember-template-imports/src/babel-plugin";
//@ts-ignore no types are available
import decoratorsProposalPlugin from "@babel/plugin-proposal-decorators";
//@ts-ignore no types are available
import classPropertiesProposalPlugin from "@babel/plugin-proposal-class-properties";
//@ts-ignore ironically no types are available
import typescriptPlugin from "@babel/plugin-transform-typescript";
import { Router } from "./router";
import type { Readable } from "stream";
import { parseQueryString } from "./query";

// From https://github.com/iliakan/detect-node
const isNode =
  Object.prototype.toString.call(globalThis.process) === "[object process]";

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
  #paths: RealmPaths;
  #jsonAPIRouter: Router;
  #cardSourceRouter: Router;
  #loader: Loader;

  get url(): string {
    return this.#paths.url;
  }

  constructor(
    url: string,
    adapter: RealmAdapter,
    readonly baseRealmURL = baseRealm.url
  ) {
    this.#paths = new RealmPaths(url);
    this.#startedUp.fulfill((() => this.#startup())());
    this.#adapter = adapter;
    this.#searchIndex = new SearchIndex(
      this,
      this.#paths,
      this.#adapter.readdir.bind(this.#adapter),
      this.readFileAsText.bind(this)
    );
    this.#loader = new Loader(this, async (url: URL) => {
      return this.transpileJS((await this.getCardSourceAsText(url))!, url.href);
    });

    this.#jsonAPIRouter = new Router(new URL(url))
      .post("/", this.createCard.bind(this))
      .patch("/.+(?<!.json)", this.patchCard.bind(this))
      .get("/_cardsOf", this.getCardsOf.bind(this))
      .get("/_search", this.search.bind(this))
      .get("/_typeOf", this.getTypeOf.bind(this))
      .get("/.+/_baseRealm", this.getBaseRealm.bind(this))
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

  async load<T extends object>(moduleIdentifier: string): Promise<T> {
    let moduleURL = new URL(moduleIdentifier, this.url);
    return await this.#loader.load(moduleURL.href);
  }

  async write(
    path: LocalPath,
    contents: string
  ): Promise<{ lastModified: number }> {
    let results = await this.#adapter.write(path, contents);
    await this.#searchIndex.update(this.#paths.fileURL(path));

    return results;
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

    let maybeHandle = await this.getFileWithFallbacks(this.#paths.local(url));

    if (!maybeHandle) {
      return notFound(request, `${request.url} not found`);
    }

    let handle = maybeHandle;

    if (
      executableExtensions.some((extension) => handle.path.endsWith(extension))
    ) {
      return await this.makeJS(
        await this.fileContentToText(handle),
        handle.path
      );
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
      this.#paths.local(new URL(request.url)),
      await request.text()
    );
    this.#loader.clearCache();
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
    let localName = this.#paths.local(new URL(request.url));
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

  // as opposed to getCardSourceOrRedirect, this will follow the redirect
  private async getCardSourceAsText(url: URL): Promise<string | undefined> {
    let localName = this.#paths.local(url);
    let handle = await this.getFileWithFallbacks(localName);
    if (!handle) {
      return undefined;
    }
    return (await this.readFileAsText(handle.path))?.content;
  }

  private async removeCardSource(request: Request): Promise<Response> {
    let localName = this.#paths.local(new URL(request.url));
    let handle = await this.getFileWithFallbacks(localName);
    if (!handle) {
      return notFound(request, `${localName} not found`);
    }
    await this.#searchIndex.update(this.#paths.fileURL(handle.path), {
      delete: true,
    });
    await this.#adapter.remove(handle.path);
    this.#loader.clearCache();
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
        [externalsPlugin, { realm: this }],
      ],
    })!.code!;
  }

  private async makeJS(
    content: string,
    debugFilename: string
  ): Promise<Response> {
    try {
      content = this.transpileJS(content, debugFilename);
    } catch (err: any) {
      Promise.resolve().then(() => {
        throw err;
      });
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
    if (!isCardJSON(json)) {
      return badRequest(`Request body is not valid card JSON-API`);
    }

    // new instances are created in a folder named after the card
    let dirName = `/${join(
      new URL(this.url).pathname,
      json.data.meta.adoptsFrom.name
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
    let fileURL = this.#paths.fileURL(pathname);
    let localPath: LocalPath = this.#paths.local(fileURL);
    let { lastModified } = await this.write(
      localPath,
      JSON.stringify(json, null, 2)
    );
    let newURL = fileURL.href.replace(/\.json$/, "");
    if (!isCardDocument(json)) {
      return badRequest(
        `bug: the card document is not actually a card document`
      );
    }
    json.data.id = newURL;
    json.data.links = { self: newURL };
    json.data.meta.lastModified = lastModified;
    if (!isCardDocument(json)) {
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
    let localPath = this.#paths.local(new URL(request.url));
    if (localPath.startsWith("_")) {
      return methodNotAllowed(request);
    }

    let url = this.#paths.fileURL(localPath);
    let original = await this.#searchIndex.card(url);
    if (!original) {
      return notFound(request);
    }
    delete original.meta.lastModified;

    let patch = await request.json();
    if (!isCardDocument(patch)) {
      return badRequest(`The request body was not a card document`);
    }
    // prevent the client from changing the card type or ID in the patch
    delete (patch as any).data.meta;
    delete (patch as any).data.type;

    let card = merge({ data: original }, patch);
    delete (card as any).data.id; // don't write the ID to the file
    let path: LocalPath = `${localPath}.json`;
    let { lastModified } = await this.write(
      path,
      JSON.stringify(card, null, 2)
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
    let localPath = this.#paths.local(new URL(request.url));
    let url = this.#paths.fileURL(localPath);
    let data = await this.#searchIndex.card(url);
    if (!data) {
      return notFound(request);
    }
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
    let localPath = this.#paths.local(url) + ".json";
    await this.#searchIndex.update(this.#paths.fileURL(localPath), {
      delete: true,
    });
    await this.#adapter.remove(localPath);
    return new Response(null, { status: 204 });
  }

  private async directoryEntries(
    url: URL
  ): Promise<{ name: string; kind: Kind }[] | undefined> {
    if (await this.isIgnored(url)) {
      return undefined;
    }
    let path = this.#paths.local(url);
    if (!(await this.#adapter.exists(path))) {
      return undefined;
    }
    let entries: { name: string; kind: Kind }[] = [];
    for await (let entry of this.#adapter.readdir(path)) {
      let innerPath = join(path, entry.name);
      let innerURL =
        entry.kind === "directory"
          ? this.#paths.directoryURL(innerPath)
          : this.#paths.fileURL(innerPath);
      if (await this.isIgnored(innerURL)) {
        continue;
      }
      entries.push(entry);
    }
    return entries;
  }

  private async getDirectoryListing(request: Request): Promise<Response> {
    // a LocalPath has no leading nor trailing slash
    let localPath: LocalPath = this.#paths.local(new URL(request.url));
    let url = this.#paths.directoryURL(localPath);
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

    // the entries are sorted such that the parent directory always
    // appears before the children
    entries.sort((a, b) => a.kind.localeCompare(b.kind));
    for (let entry of entries) {
      let relationship: DirectoryEntryRelationship = {
        links: {
          related:
            new URL(entry.name, url).href +
            (entry.kind === "directory" ? "/" : ""),
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

  // todo: I think we get rid of this
  private async readFileAsText(
    path: LocalPath
  ): Promise<{ content: string; lastModified: number } | undefined> {
    let ref = await this.#adapter.openFile(path);
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

  private async getCardsOf(request: Request): Promise<Response> {
    let { module } =
      parse(new URL(request.url).search, { ignoreQueryPrefix: true }) ?? {};
    if (typeof module !== "string") {
      return badRequest(`'module' param was not specified or invalid`);
    }
    let refs = await this.#searchIndex.exportedCardsOf(module);
    return new Response(
      JSON.stringify(
        {
          data: {
            type: "module",
            id: new URL(module, this.url).href,
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
          "content-type": "application/vnd.api+json",
        },
      }
    );
  }

  /*
  The card definition response looks like:

  {
    data: {
      type: "card-definition",
      id: "http://local-realm/some/card",
      relationships: {
        _: {
          links: {
            related: "http://local-realm/_typeOf?type=exportedCard&module=%2Fsuper%2Fcard&name=SuperCard"
          }
          meta: {
            type: "super"
          }
        },
        firstName: {
          links: {
            related: "https://cardstack.com/base/_typeOf?type=exportedCard&module%2Fstring&name=default"
          },
          meta: {
            type: "contains"
          }
        },
        lastName: {
          links: {
            related: "https://cardstack.com/base/_typeOf?type=exportedCard&module%2Fstring&name=default"
          },
          meta: {
            type: "contains"
          }
        }
      }
    }
  }

  random musing based on example above: maybe the base realm should be:
  http://base.cardstack.com
  and not
  http://cardstack.com/base

  the realm API URL's read a little nicer this way....
*/

  private async getTypeOf(request: Request): Promise<Response> {
    let ref = parse(new URL(request.url).search, { ignoreQueryPrefix: true });
    if (!isCardRef(ref)) {
      return badRequest("a valid card reference was not specified");
    }
    let def = await this.#searchIndex.typeOf(ref);
    if (!def) {
      return notFound(
        request,
        `Could not find card reference ${JSON.stringify(ref)}`
      );
    }
    let data: CardDefinitionResource = {
      id: def.key,
      type: "card-definition",
      attributes: {
        cardRef: def.id,
      },
      relationships: {},
    };
    if (!data.relationships) {
      throw new Error("bug: this should never happen");
    }

    if (def.super) {
      data.relationships._super = {
        links: {
          related: this.cardRefToTypeURL(def.super),
        },
        meta: {
          type: "super",
          ref: def.super,
        },
      };
    }
    for (let [fieldName, field] of def.fields) {
      data.relationships[fieldName] = {
        links: {
          related: this.cardRefToTypeURL(field.fieldCard),
        },
        meta: {
          type: field.fieldType,
          ref: field.fieldCard,
        },
      };
    }
    return new Response(JSON.stringify({ data }, null, 2), {
      headers: { "content-type": "application/vnd.api+json" },
    });
  }

  private getBaseRealm(): Response {
    return new Response(
      JSON.stringify({
        data: {
          id: "base-realm-url",
          type: "base-realm-url",
          attributes: { url: this.baseRealmURL },
        },
      })
    );
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

  private cardRefToTypeURL(ref: CardRef): string {
    let module = new URL(getExportedCardContext(ref).module);
    if (this.#paths.inRealm(module)) {
      return `${this.url}_typeOf?${stringify(ref)}`;
    }

    // TODO how to resolve the Realm URL of a module that does not come from our
    // own realm For now we can just hardcode realms we know about when
    // resolving a realm URL from a module, which in this case is only the base
    // realm. Probably we need some kind of "realm lookup" which is a list of
    // all realms that our hub knows about
    if (baseRealm.inRealm(module)) {
      return `${baseRealm.fileURL("_typeOf")}?${stringify(ref)}`;
    }

    throw new Error(
      `Don't know how to resolve realm URL for module ${module.href}`
    );
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
  card: CardDocument
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
