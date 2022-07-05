import { Deferred } from "./deferred";
import {
  SearchIndex,
  isCardRef,
  CardRef,
  CardDocument,
  isCardDocument,
} from "./search-index";
import {
  systemError,
  notFound,
  methodNotAllowed,
  badRequest,
  WorkerError,
} from "@cardstack/runtime-common/error";
import { formatRFC7231 } from "date-fns";
import {
  isCardJSON,
  ResourceObjectWithId,
  DirectoryEntryRelationship,
} from ".";
import merge from "lodash/merge";
import { parse, stringify } from "qs";

export abstract class Realm {
  #startedUp = new Deferred<void>();
  #searchIndex = new SearchIndex(
    this,
    this.readdir.bind(this),
    this.readFileAsText.bind(this)
  );

  readonly url: string;

  constructor(url: string) {
    this.url = url.replace(/\/$/, "") + "/";
    this.#startedUp.fulfill((() => this.#startup())());
  }

  protected abstract readdir(
    path: string,
    opts?: { create?: true }
  ): AsyncGenerator<{ name: string; path: string; kind: Kind }, void>;

  protected abstract openFile(
    path: string
  ): Promise<ReadableStream<Uint8Array> | Uint8Array | string>;

  protected abstract statFile(
    path: string
  ): Promise<{ lastModified: number } | undefined>;

  protected async write(
    path: string,
    contents: string
  ): Promise<{ lastModified: number }> {
    let results = await this.doWrite(path, contents);
    await this.#searchIndex.update(new URL(path, this.url));

    return results;
  }

  protected abstract doWrite(
    path: string,
    contents: string
  ): Promise<{ lastModified: number }>;

  protected get searchIndex() {
    return this.#searchIndex;
  }

  async #startup() {
    // Wait a microtask because our derived class will still be inside its
    // super() call to us and we don't want to start pulling on their "this" too
    // early.
    await Promise.resolve();

    await this.#searchIndex.run();
  }

  get ready(): Promise<void> {
    return this.#startedUp.promise;
  }

  // TODO refactor to get as much implementation in this base class as possible.
  // currently there is a bunch of stuff relying on fs--so break that down to use
  // the search index instead
  abstract handle(request: Request): Promise<Response>;

  protected async handleJSONAPI(request: Request): Promise<Response> {
    let url = new URL(request.url);
    // create card data
    if (request.method === "POST") {
      if (url.pathname.startsWith("_")) {
        return methodNotAllowed(request);
      }
      if (url.pathname !== "/") {
        return notFound(request, `Can't POST to ${url.href}`);
      }
      let json = await request.json();
      if (!isCardJSON(json)) {
        return badRequest(`Request body is not valid card JSON-API`);
      }

      // new instances are created in a folder named after the card
      let dirName = `/${json.data.meta.adoptsFrom.name}/`;
      let entries = await this.#searchIndex.directory(
        new URL(dirName, this.url)
      );
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
      await this.write(pathname, JSON.stringify(json, null, 2));
      let newURL = new URL(pathname, url.origin).href.replace(/\.json$/, "");
      if (!isCardDocument(json)) {
        return badRequest(
          `bug: the card document is not actually a card document`
        );
      }
      json.data.id = newURL;
      json.data.links = { self: newURL };
      if (!isCardDocument(json)) {
        return systemError(
          `bug: constructed non-card document resource in JSON-API request for ${newURL}`
        );
      }
      await this.addLastModifiedToCardDoc(json, pathname);
      return new Response(JSON.stringify(json, null, 2), {
        status: 201,
        headers: {
          "Last-Modified": formatRFC7231(json.data.meta.lastModified!),
          "Content-Type": "application/vnd.api+json",
        },
      });
    }

    // Update card data
    if (request.method === "PATCH") {
      if (url.pathname.startsWith("_")) {
        return methodNotAllowed(request);
      }

      let original = await this.#searchIndex.card(url);
      if (!original) {
        return notFound(request);
      }

      let patch = await request.json();
      if (!isCardDocument(patch)) {
        return badRequest(`The request body was not a card document`);
      }
      // prevent the client from changing the card type or ID in the patch
      delete (patch as any).data.meta;
      delete (patch as any).data.type;

      let card = merge({ data: original }, patch);
      delete (card as any).data.id; // don't write the ID to the file
      let path = url.pathname.endsWith(".json")
        ? url.pathname
        : url.pathname + ".json";
      await this.write(path, JSON.stringify(card, null, 2));
      card.data.id = url.href.replace(/\.json$/, "");
      card.data.links = { self: url.href };
      await this.addLastModifiedToCardDoc(card, path);
      return new Response(JSON.stringify(card, null, 2), {
        headers: {
          "Last-Modified": formatRFC7231(card.data.meta.lastModified!),
          "Content-Type": "application/vnd.api+json",
        },
      });
    }

    if (request.method === "GET") {
      if (url.pathname === "/_cardsOf") {
        return await this.getCardsOf(request);
      }
      if (url.pathname === "/_typeOf") {
        return await this.getTypeOf(request);
      }
      if (url.pathname === "/_search") {
        return await this.search(request);
      }

      // Get directory listing
      if (url.pathname.endsWith("/")) {
        let jsonapi = await this.getDirectoryListingAsJSONAPI(url);
        if (!jsonapi) {
          return notFound(request);
        }

        return new Response(JSON.stringify(jsonapi, null, 2), {
          headers: { "Content-Type": "application/vnd.api+json" },
        });
      }

      let data = await this.#searchIndex.card(url);
      if (data) {
        (data as any).links = { self: url.href };
        let card = { data };
        await this.addLastModifiedToCardDoc(card, url.pathname + ".json");
        return new Response(JSON.stringify(card, null, 2), {
          headers: {
            "Last-Modified": formatRFC7231(card.data.meta.lastModified!),
            "Content-Type": "application/vnd.api+json",
          },
        });
      }

      return notFound(request, `No such JSON-API resource ${url.href}`);
    }

    return systemError(
      `Don't know how to handle JSON-API request ${request.method} for ${url.href}`
    );
  }

  protected async readFileAsText(path: string): Promise<string> {
    let result = await this.openFile(path);
    if (typeof result === "string") {
      return result;
    }
    let decoder = new TextDecoder();
    let pieces: string[] = [];
    if (result instanceof Uint8Array) {
      pieces.push(decoder.decode(result));
    } else {
      let reader = result.getReader();
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

  private async getDirectoryListingAsJSONAPI(
    url: URL
  ): Promise<
    | { data: ResourceObjectWithId; included?: ResourceObjectWithId[] }
    | undefined
  > {
    let entries = await this.#searchIndex.directory(url);
    if (!entries) {
      console.log(`can't find directory ${url.href}`);
      return undefined;
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

    return { data };
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
            related: "http://local-realm/cardstack/type-of?type=exportedCard&module=%2Fsuper%2Fcard&name=SuperCard"
          }
          meta: {
            type: "super"
          }
        },
        firstName: {
          links: {
            related: "http://cardstack.com/cardstack/type-of?type=exportedCard&module%2Fstring&name=default"
          },
          meta: {
            type: "contains"
          }
        },
        lastName: {
          links: {
            related: "http://cardstack.com/cardstack/type-of?type=exportedCard&module%2Fstring&name=default"
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
      return new Response(
        JSON.stringify({
          errors: [`a valid card reference was not specified`],
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/vnd.api+json" },
        }
      );
    }
    let def = await this.#searchIndex.typeOf(ref);
    if (!def) {
      return notFound(
        request,
        `Could not find card reference ${JSON.stringify(ref)}`
      );
    }
    let data: ResourceObjectWithId = {
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
          related: cardRefToTypeURL(def.super, this),
        },
        meta: {
          type: "super",
        },
      };
    }
    for (let [fieldName, field] of def.fields) {
      data.relationships[fieldName] = {
        links: {
          related: cardRefToTypeURL(field.fieldCard, this),
        },
        meta: {
          type: field.fieldType,
        },
      };
    }
    return new Response(JSON.stringify(data, null, 2), {
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

  private async addLastModifiedToCardDoc(card: CardDocument, path: string) {
    let { lastModified } = (await this.statFile(path)) ?? {};
    if (!lastModified) {
      throw new WorkerError(
        systemError(`no last modified date available for file ${path}`)
      );
    }
    card.data.meta.lastModified = lastModified;
  }
}

export type Kind = "file" | "directory";

function cardRefToTypeURL(ref: CardRef, realm: Realm): string {
  let modRealm = new URL(getModuleContext(ref), realm.url).origin;
  return `${modRealm}/cardstack/type-of?${stringify(ref)}`;
}

function getModuleContext(ref: CardRef): string {
  if (ref.type === "exportedCard") {
    return ref.module;
  } else {
    return getModuleContext(ref.card);
  }
}
