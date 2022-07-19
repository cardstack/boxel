import { Deferred } from "./deferred";
import {
  SearchIndex,
  isCardRef,
  CardRef,
  CardDocument,
  isCardDocument,
} from "./search-index";
import { RealmPaths, LocalPath } from "./paths";
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

import { preprocessEmbeddedTemplates } from "@cardstack/ember-template-imports/lib/preprocess-embedded-templates";
import * as babel from "@babel/core";
import makeEmberTemplatePlugin from "babel-plugin-ember-template-compilation";
import * as etc from "ember-source/dist/ember-template-compiler";
import { externalsPlugin } from "./externals";
import glimmerTemplatePlugin from "@cardstack/ember-template-imports/src/babel-plugin";
import decoratorsProposalPlugin from "@babel/plugin-proposal-decorators";
import classPropertiesProposalPlugin from "@babel/plugin-proposal-class-properties";
import typescriptPlugin from "@babel/plugin-transform-typescript";
import { Router } from "./router";

export interface FileRef {
  path: LocalPath;
  content: ReadableStream<Uint8Array> | Uint8Array | string;
  lastModified: number;
}

export interface RealmAdapter {
  readdir(
    path: LocalPath,
    opts?: { create?: true }
  ): AsyncGenerator<{ name: string; path: LocalPath; kind: Kind }, void>;

  openFile(path: LocalPath): Promise<FileRef | undefined>;

  write(path: string, contents: string): Promise<{ lastModified: number }>;
}

export class Realm {
  #startedUp = new Deferred<void>();
  #searchIndex: SearchIndex;
  #adapter: RealmAdapter;
  #paths: RealmPaths;
  #jsonAPIRouter: Router;
  #cardSourceRouter: Router;

  get url(): string {
    return this.#paths.url;
  }

  constructor(url: string, adapter: RealmAdapter) {
    this.#paths = new RealmPaths(url);
    this.#startedUp.fulfill((() => this.#startup())());
    this.#adapter = adapter;
    this.#searchIndex = new SearchIndex(
      this,
      this.#paths,
      this.#adapter.readdir.bind(this.#adapter),
      this.readFileAsText.bind(this)
    );

    this.#jsonAPIRouter = new Router(new URL(url))
      .post("/", this.createCard.bind(this))
      .patch("/.+(?<!.json)", this.patchCard.bind(this))
      .get("/_cardsOf", this.getCardsOf.bind(this))
      .get("/_search", this.search.bind(this))
      .get("/_typeOf", this.getTypeOf.bind(this))
      .get(".*/", this.getDirectoryListing.bind(this))
      .get("/.+(?<!.json)", this.getCard.bind(this));

    this.#cardSourceRouter = new Router(new URL(url))
      .post(
        `/.+(${executableExtensions.map((e) => "\\" + e).join("|")})`,
        this.upsertCardSource.bind(this)
      )
      .get("/.+", this.getCardSourceOrRedirect.bind(this));
  }

  async write(
    path: LocalPath,
    contents: string
  ): Promise<{ lastModified: number }> {
    let results = await this.#adapter.write(path, contents);
    await this.#searchIndex.update(new URL(path, this.url));

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

  async handle(request: Request): Promise<Response> {
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

  private async serveLocalFile(ref: FileRef): Promise<Response> {
    return new Response(ref.content, {
      headers: {
        "Last-Modified": formatRFC7231(ref.lastModified),
      },
    });
  }

  private async upsertCardSource(request: Request): Promise<Response> {
    let { lastModified } = await this.write(
      this.#paths.local(new URL(request.url)),
      await request.text()
    );
    return new Response(null, {
      status: 204,
      headers: {
        "Last-Modified": formatRFC7231(lastModified),
      },
    });
  }

  private async getCardSourceOrRedirect(request: Request): Promise<Response> {
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

  private async makeJS(
    content: string,
    debugFilename: string
  ): Promise<Response> {
    try {
      content = preprocessEmbeddedTemplates(content, {
        relativePath: debugFilename,
        getTemplateLocals: etc._GlimmerSyntax.getTemplateLocals,
        templateTag: "template",
        templateTagReplacement: "__GLIMMER_TEMPLATE",
        includeSourceMaps: true,
        includeTemplateTokens: true,
      }).output;
      content = babel.transformSync(content, {
        filename: debugFilename,
        plugins: [
          glimmerTemplatePlugin,
          typescriptPlugin,
          [decoratorsProposalPlugin, { legacy: true }],
          classPropertiesProposalPlugin,
          // this "as any" is because typescript is using the Node-specific types
          // from babel-plugin-ember-template-compilation, but we're using the
          // browser interface
          isNode()
            ? [
                makeEmberTemplatePlugin,
                {
                  precompile: etc.precompile,
                },
              ]
            : (makeEmberTemplatePlugin as any)(() => etc.precompile),
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
    path: string
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
    let url = new URL(request.url);
    let json = await request.json();
    if (!isCardJSON(json)) {
      return badRequest(`Request body is not valid card JSON-API`);
    }

    // new instances are created in a folder named after the card
    let dirName = `/${json.data.meta.adoptsFrom.name}/`;
    let entries = await this.#searchIndex.directory(new URL(dirName, this.url));
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
    let { lastModified } = await this.write(
      pathname,
      JSON.stringify(json, null, 2)
    );
    let newURL = new URL(pathname, url.origin).href.replace(/\.json$/, "");
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
        "Content-Type": "application/vnd.api+json",
        ...lastModifiedHeader(json),
      },
    });
  }

  private async patchCard(request: Request): Promise<Response> {
    if (this.#paths.local(new URL(request.url)).startsWith("_")) {
      return methodNotAllowed(request);
    }

    let url = this.#paths.fileURL(new URL(request.url).pathname);
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
    let path = `${this.#paths.local(url)}.json`;
    let { lastModified } = await this.write(
      path,
      JSON.stringify(card, null, 2)
    );
    card.data.id = url.href.replace(/\.json$/, "");
    card.data.links = { self: url.href };
    card.data.meta.lastModified = lastModified;
    return new Response(JSON.stringify(card, null, 2), {
      headers: {
        "Content-Type": "application/vnd.api+json",
        ...lastModifiedHeader(card),
      },
    });
  }

  private async getCard(request: Request): Promise<Response> {
    let url = this.#paths.fileURL(new URL(request.url).pathname);
    let data = await this.#searchIndex.card(url);
    if (!data) {
      return notFound(request);
    }
    (data as any).links = { self: url.href };
    let card = { data };
    return new Response(JSON.stringify(card, null, 2), {
      headers: {
        "Last-Modified": formatRFC7231(card.data.meta.lastModified!),
        "Content-Type": "application/vnd.api+json",
        ...lastModifiedHeader(card),
      },
    });
  }

  private async getDirectoryListing(request: Request): Promise<Response> {
    // a LocalPath has no leading nor trailing slash
    let localPath: LocalPath = new URL(request.url).pathname
      .replace(/^\//, "")
      .replace(/\/$/, "");
    let url = this.#paths.directoryURL(localPath);

    let entries = await this.#searchIndex.directory(url);
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
      headers: { "Content-Type": "application/vnd.api+json" },
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

  private async fileContentToText({ content }: FileRef): Promise<string> {
    if (typeof content === "string") {
      return content;
    }
    let decoder = new TextDecoder();
    let pieces: string[] = [];
    if (content instanceof Uint8Array) {
      pieces.push(decoder.decode(content));
    } else {
      let reader = content.getReader();
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
    }
    return pieces.join("");
  }

  private async getCardsOf(request: Request): Promise<Response> {
    let { module } =
      parse(new URL(request.url).search, { ignoreQueryPrefix: true }) ?? {};
    if (typeof module !== "string") {
      return new Response(
        JSON.stringify({
          errors: [`'module' param was not specified or invalid`],
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/vnd.api+json" },
        }
      );
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
          "Content-Type": "application/vnd.api+json",
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
        },
      };
    }
    return new Response(JSON.stringify({ data }, null, 2), {
      headers: { "Content-Type": "application/vnd.api+json" },
    });
  }

  private async search(_request: Request): Promise<Response> {
    // TODO process query param....
    let data = await this.#searchIndex.search({});
    return new Response(
      JSON.stringify(
        {
          data,
        },
        null,
        2
      ),
      {
        headers: { "Content-Type": "application/vnd.api+json" },
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
): {} | { "Last-Modified": string } {
  return (
    card.data.meta.lastModified != null
      ? { "Last-Modified": formatRFC7231(card.data.meta.lastModified) }
      : {}
  ) as {} | { "Last-Modified": string };
}

export interface CardDefinitionResource {
  id: string;
  type: "card-definition";
  relationships: {
    [fieldName: string]: {
      links: {
        related: string;
      };
      meta: {
        type: "super" | "contains" | "containsMany";
      };
    };
  };
}

// From https://github.com/iliakan/detect-node
function isNode() {
  return Object.prototype.toString.call(global.process) === "[object process]";
}
