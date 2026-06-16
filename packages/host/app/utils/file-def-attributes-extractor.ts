import { isEqual } from 'lodash';

import {
  baseRef,
  CardError,
  identifyCard,
  inferContentType,
  internalKeyFor,
  SupportedMimeType,
  type CodeRef,
  type FileMetaResource,
  type QueryFieldMeta,
  type RealmResourceIdentifier,
  type RenderError,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { getFieldDefinitions } from '@cardstack/runtime-common/definitions';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { BaseDef } from 'https://cardstack.com/base/card-api';

import type { createAuthErrorGuard } from './auth-error-guard';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';

export type FileDefExport = {
  extractAttributes: (
    url: string,
    getStream: () => Promise<unknown>,
    options?: { contentHash?: string; contentSize?: number },
  ) => Promise<any>;
};
export type FileDefModule = Record<string, FileDefExport | undefined>;
export type FileDefConstructor = {
  extractAttributes?: FileDefExport['extractAttributes'];
};
export type FileDefExtractResult = {
  status: 'ready' | 'error';
  searchDoc: Record<string, any> | null;
  resource?: FileMetaResource;
  types?: string[];
  displayNames?: string[];
  deps: string[];
  error?: RenderError;
  mismatch?: true;
};

export class FileDefAttributesExtractor {
  #loaderService: LoaderService;
  #network: NetworkService;
  #authGuard?: ReturnType<typeof createAuthErrorGuard>;
  #fileURL: string;
  #fileDefCodeRef: ResolvedCodeRef;
  #baseFileDefCodeRef: ResolvedCodeRef;
  #contentHash: string | undefined;
  #contentSize: number | undefined;
  #fileBytes: Uint8Array | undefined;
  #buildError: (url: string, error: unknown) => RenderError;
  #fallbackBytes: Uint8Array | null = null;
  #primaryUsed = false;

  constructor({
    loaderService,
    network,
    authGuard,
    fileURL,
    fileDefCodeRef,
    baseFileDefCodeRef,
    contentHash,
    contentSize,
    fileBytes,
    buildError,
  }: {
    loaderService: LoaderService;
    network: NetworkService;
    authGuard?: ReturnType<typeof createAuthErrorGuard>;
    fileURL: string;
    fileDefCodeRef: ResolvedCodeRef;
    baseFileDefCodeRef: ResolvedCodeRef;
    contentHash: string | undefined;
    contentSize: number | undefined;
    fileBytes?: Uint8Array;
    buildError: (url: string, error: unknown) => RenderError;
  }) {
    this.#loaderService = loaderService;
    this.#network = network;
    this.#authGuard = authGuard;
    this.#fileURL = fileURL;
    this.#fileDefCodeRef = fileDefCodeRef;
    this.#baseFileDefCodeRef = baseFileDefCodeRef;
    this.#contentHash = contentHash;
    this.#contentSize = contentSize;
    this.#fileBytes = fileBytes;
    this.#buildError = buildError;
  }

  async extract(): Promise<FileDefExtractResult> {
    let fileDefModule = await this.#loaderService.loader.import<FileDefModule>(
      this.#fileDefCodeRef.module,
    );
    let FileDefKlass = fileDefModule[this.#fileDefCodeRef.name] as
      | FileDefConstructor
      | undefined;
    let baseFileDefModule =
      await this.#loaderService.loader.import<FileDefModule>(
        this.#baseFileDefCodeRef.module,
      );
    let BaseFileDef = baseFileDefModule[
      this.#baseFileDefCodeRef.name
    ] as FileDefConstructor;
    if (!BaseFileDef?.extractAttributes) {
      return {
        status: 'error',
        searchDoc: null,
        deps: [this.#fileDefCodeRef.module, this.#baseFileDefCodeRef.module],
        error: this.#buildError(
          this.#fileURL,
          new Error('Base FileDef module did not export extractAttributes'),
        ),
      };
    }

    let deps = [this.#fileDefCodeRef.module];
    let error: RenderError | undefined;
    let mismatch = false;

    let recordError = (err: unknown) => {
      if (!error) {
        error = this.#buildError(this.#fileURL, err);
      }
      if ((err as any)?.name === 'FileContentMismatchError') {
        mismatch = true;
      }
    };

    let tryExtract = async (
      klass: FileDefConstructor,
      missingMessage: string,
    ) => {
      if (!klass.extractAttributes) {
        recordError(new Error(missingMessage));
        return undefined;
      }
      try {
        return await klass.extractAttributes(
          this.#fileURL,
          this.#getStreamForAttempt,
          { contentHash: this.#contentHash, contentSize: this.#contentSize },
        );
      } catch (err) {
        console.warn(
          `[file-extract] ${(klass as any).displayName ?? (klass as any).name ?? 'unknown'}.extractAttributes failed for ${this.#fileURL}:`,
          err,
        );
        recordError(err);
        return undefined;
      }
    };

    if (!FileDefKlass) {
      recordError(new Error('FileDef module did not export extractAttributes'));
    }

    let chain: FileDefConstructor[] = [];
    if (FileDefKlass) {
      let current: FileDefConstructor | undefined = FileDefKlass;
      while (current && current !== BaseFileDef) {
        chain.push(current);
        let next = Object.getPrototypeOf(current) as
          | FileDefConstructor
          | undefined;
        if (!next || next === current) {
          break;
        }
        current = next;
      }
    }
    if (!chain.includes(BaseFileDef)) {
      if (
        this.#fileDefCodeRef.module !== this.#baseFileDefCodeRef.module ||
        this.#fileDefCodeRef.name !== this.#baseFileDefCodeRef.name
      ) {
        deps.push(this.#baseFileDefCodeRef.module);
      }
      chain.push(BaseFileDef);
    }

    for (let klass of chain) {
      let missingMessage =
        klass === BaseFileDef
          ? 'Base FileDef module did not export extractAttributes'
          : 'FileDef module did not export extractAttributes';
      let searchDoc = await tryExtract(klass, missingMessage);
      if (searchDoc) {
        let typeCodeRefs = getTypes(klass);
        let types = typeCodeRefs.map((type) =>
          internalKeyFor(type, undefined, this.#network.virtualNetwork),
        );
        let displayNames = getDisplayNames(klass);
        let adoptsFrom = typeCodeRefs[0] ?? this.#fileDefCodeRef;
        let queryFieldDefs = await this.extractQueryFieldDefs(klass);
        // `extractAttributes` may route per-field meta (the concrete subclass
        // of a nested polymorphic field) via this global symbol. Lift it out so
        // it lands in the resource's `meta.fields` and never in the flat
        // `search_doc`. The base FileDef sets the same `Symbol.for` key.
        let fieldMetaSymbol = Symbol.for('boxel:file-field-meta');
        let cleanedDoc: Record<string, any> = { ...searchDoc };
        let cleanedBag = cleanedDoc as Record<PropertyKey, any>;
        let fieldsMeta = cleanedBag[fieldMetaSymbol] as
          | NonNullable<FileMetaResource['meta']['fields']>
          | undefined;
        if (fieldsMeta) {
          delete cleanedBag[fieldMetaSymbol];
        }
        return {
          status: 'ready',
          searchDoc: cleanedDoc,
          resource: buildFileResource(
            this.#fileURL,
            cleanedDoc,
            adoptsFrom,
            queryFieldDefs,
            fieldsMeta,
          ),
          types,
          displayNames,
          deps,
          ...(error ? { error } : {}),
          ...(mismatch ? { mismatch: true } : {}),
        };
      }
    }

    return {
      status: 'error',
      searchDoc: null,
      deps,
      error:
        error ??
        this.#buildError(this.#fileURL, new Error('File extract failed')),
    };
  }

  // Each extractAttributes attempt asks for a stream. The first attempt — the
  // most-specific FileDef subclass — gets the response body streamed directly,
  // so a FileDef that only needs a small header (e.g. an audio duration in the
  // `moov` box) can read what it needs and let the rest flow past without the
  // whole file ever being buffered. The streams are deliberately NOT tee'd:
  // teeing queues every chunk of the consumed branch for the unread retry
  // branch, which pins the entire file in memory and defeats the streaming.
  // Instead, the rare retry path (a subclass mismatch falling back to a parent
  // class, after the primary stream has already been consumed) re-fetches the
  // file once and buffers that copy for any further attempts.
  //
  // A FileDef that reads only a prefix MUST cancel the stream rather than
  // abandon it — an undrained response body can hold the underlying HTTP
  // connection open until GC. The `readFirstBytes()` helper in
  // runtime-common/stream.ts does this (it cancels in a `finally`), and is what
  // the header-only extractors (the image defs) already use; partial readers
  // should go through it rather than draining the stream by hand.
  #getStreamForAttempt = async () => {
    if (!this.#primaryUsed) {
      this.#primaryUsed = true;
      return this.#getPrimaryStream();
    }
    return this.#getRetryStream();
  };

  async #getPrimaryStream(): Promise<ReadableStream<Uint8Array> | Uint8Array> {
    if (this.#fileBytes) {
      return this.#fileBytes;
    }
    let response = await this.#fetch();
    // Hand back the live body so the consumer decides how much to read. Fall
    // back to a buffered read only when the body isn't a stream (real fetches
    // always expose one; this keeps non-streaming environments working).
    if (response.body) {
      return response.body;
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async #getRetryStream(): Promise<Uint8Array> {
    if (this.#fileBytes) {
      return this.#fileBytes;
    }
    // Buffer the re-fetched copy once and reuse it for any subsequent
    // attempts, so a chain of N fallbacks costs at most one extra fetch.
    if (!this.#fallbackBytes) {
      let response = await this.#fetch();
      this.#fallbackBytes = new Uint8Array(await response.arrayBuffer());
    }
    return this.#fallbackBytes;
  }

  async #fetch(): Promise<Response> {
    let response: Response;
    try {
      let request = new Request(this.#fileURL, {
        method: 'GET',
        headers: {
          Accept: SupportedMimeType.CardSource,
        },
      });
      if (this.#authGuard) {
        response = await this.#authGuard.race(() =>
          this.#network.authedFetch(request),
        );
      } else {
        response = await this.#network.authedFetch(request);
      }
    } catch (error) {
      console.warn('file extract fetch failed', {
        fileURL: this.#fileURL,
        error,
      });
      throw error;
    }
    if (!response.ok) {
      console.warn('file extract fetch returned non-ok', {
        fileURL: this.#fileURL,
        status: response.status,
      });
      throw await CardError.fromFetchResponse(this.#fileURL, response);
    }
    return response;
  }

  // Extract query field definitions (linksTo/linksToMany with a query) from
  // the FileDef class so they can be stored in the index and used at serve
  // time without a runtime definition lookup.
  private async extractQueryFieldDefs(
    klass: FileDefConstructor,
  ): Promise<Record<string, QueryFieldMeta> | undefined> {
    try {
      let cardApiModule = await this.#loaderService.loader.import<
        typeof CardAPI
      >('https://cardstack.com/base/card-api');
      let { fields, fieldDefs } = getFieldDefinitions(
        cardApiModule,
        klass as unknown as typeof BaseDef,
      );
      let result: Record<string, QueryFieldMeta> = {};
      for (let [name, defId] of Object.entries(fields)) {
        let def = fieldDefs[defId];
        if (!def) {
          continue;
        }
        if (
          def.query &&
          (def.type === 'linksTo' || def.type === 'linksToMany')
        ) {
          result[name] = {
            type: def.type,
            query: def.query,
            fieldOrCard: def.fieldOrCard,
          };
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    } catch (err) {
      console.warn(
        `[file-extract] Failed to extract query field defs for ${this.#fileURL}:`,
        err,
      );
      return undefined;
    }
  }
}

export function getTypes(klass: FileDefConstructor): CodeRef[] {
  let types = [];
  let current: FileDefConstructor | undefined = klass;

  while (current) {
    let ref = identifyCard(current as unknown as typeof BaseDef);
    if (!ref || isEqual(ref, baseRef)) {
      break;
    }
    types.push(ref);
    current = Reflect.getPrototypeOf(current) as FileDefConstructor | undefined;
  }
  return types;
}

// Walks the FileDef subclass prototype chain and collects each level's
// `static displayName` (e.g. `MarkdownDef.displayName === 'Markdown'`).
// Mirrors the card-side getDisplayNames in routes/render/meta.ts so the same
// `boxel_index.display_names` semantics apply to file rows.
export function getDisplayNames(klass: FileDefConstructor): string[] {
  let displayNames: string[] = [];
  let current: FileDefConstructor | undefined = klass;
  while (current) {
    let ref = identifyCard(current as unknown as typeof BaseDef);
    if (!ref || isEqual(ref, baseRef)) {
      break;
    }
    let kAny = current as {
      displayName?: string;
      name?: string;
    };
    if (typeof kAny.displayName === 'string' && kAny.displayName) {
      displayNames.push(kAny.displayName);
    } else if (typeof kAny.name === 'string' && kAny.name) {
      displayNames.push(kAny.name);
    }
    current = Reflect.getPrototypeOf(current) as FileDefConstructor | undefined;
  }
  return displayNames;
}

export function buildFileResource(
  fileURL: string,
  attributes: Record<string, any>,
  adoptsFrom: CodeRef,
  queryFieldDefs?: Record<string, QueryFieldMeta>,
  fieldsMeta?: NonNullable<FileMetaResource['meta']['fields']>,
): FileMetaResource {
  let name = new URL(fileURL).pathname.split('/').pop() ?? fileURL;
  let baseAttributes = {
    name: attributes.name ?? name,
    url: attributes.url ?? fileURL,
    sourceUrl: attributes.sourceUrl ?? fileURL,
    contentType: attributes.contentType ?? inferContentType(name),
  };
  let mergedAttributes: Record<string, unknown> = { ...baseAttributes };
  for (let [key, value] of Object.entries(attributes)) {
    if (value !== undefined && !(key in mergedAttributes)) {
      mergedAttributes[key] = value;
    }
  }
  return {
    id: fileURL as RealmResourceIdentifier,
    type: 'file-meta',
    attributes: mergedAttributes,
    meta: {
      adoptsFrom,
      // Per-field subclass overrides for nested polymorphic fields (e.g.
      // `frontmatter` → SkillFrontmatterField). Without this the field rehydrates
      // as its declared base type. Supplied by `extractAttributes` (see below).
      ...(fieldsMeta ? { fields: fieldsMeta } : {}),
      ...(queryFieldDefs ? { queryFieldDefs } : {}),
    },
    links: { self: fileURL },
  };
}
