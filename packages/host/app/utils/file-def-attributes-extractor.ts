import { getOwner, setOwner } from '@ember/-internals/owner';

import { isEqual } from 'lodash-es';

import {
  baseRef,
  buildToolFunctionNameFromResolvedRef,
  CardError,
  codeRefWithAbsoluteIdentifier,
  FRONTMATTER_PARSE_ERROR_SYMBOL,
  getClass,
  identifyCard,
  inferContentType,
  internalKeyFor,
  rri,
  SupportedMimeType,
  ToolContextStamp,
  type CodeRef,
  type FileMetaResource,
  type FrontmatterParseError,
  type QueryFieldMeta,
  type RealmResourceIdentifier,
  type RenderError,
  type ResolvedCodeRef,
  type ToolContext,
  type ToolSchemaError,
} from '@cardstack/runtime-common';
import { getFieldDefinitions } from '@cardstack/runtime-common/definitions';
import { basicMappings } from '@cardstack/runtime-common/helpers/ai';

import type { createAuthErrorGuard } from './auth-error-guard';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type { BaseDef } from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';
import type { Tool as LLMTool } from '@cardstack/base/matrix-event';

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
  // The frontmatter YAML wouldn't parse. The extract still succeeds (the file
  // indexes body-only); lifted out of the searchDoc here so the indexer can
  // persist it onto `diagnostics.frontmatterParseError`. See markdown-file-def.
  frontmatterParseError?: FrontmatterParseError;
  // Skill frontmatter tools whose schema generation failed. The extract
  // still succeeds (the skill indexes with the tools that did enrich); the
  // indexer persists these onto `diagnostics.toolSchemaErrors`.
  toolSchemaErrors?: ToolSchemaError[];
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
  #generateToolSchemas: boolean;
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
    generateToolSchemas,
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
    // Generate LLM tool definitions for a skill's frontmatter tools and stamp
    // them onto the file-meta resource. Indexing-only (the file-extract
    // render route): it loads each tool's module, which the interactive
    // extract paths (room file attach, the store's direct fallback) shouldn't
    // pay for — their consumers generate schemas on demand instead.
    generateToolSchemas?: boolean;
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
    this.#generateToolSchemas = generateToolSchemas ?? false;
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
        // Same out-of-band lift for a frontmatter parse failure: keep it off
        // the flat `search_doc` and hand it back so the indexer can persist it
        // onto `diagnostics.frontmatterParseError`.
        let frontmatterParseError = cleanedBag[
          FRONTMATTER_PARSE_ERROR_SYMBOL
        ] as FrontmatterParseError | undefined;
        if (frontmatterParseError) {
          delete cleanedBag[FRONTMATTER_PARSE_ERROR_SYMBOL];
        }
        let resource = buildFileResource(
          this.#fileURL,
          cleanedDoc,
          adoptsFrom,
          queryFieldDefs,
          fieldsMeta,
        );
        let toolSchemaErrors: ToolSchemaError[] | undefined;
        if (this.#generateToolSchemas) {
          try {
            toolSchemaErrors = await this.stampSkillToolSchemas(resource);
          } catch (err) {
            // Schema generation must never fail the file row — the skill
            // still indexes instructions-only.
            console.warn(
              `[file-extract] tool schema generation failed for ${this.#fileURL}:`,
              err,
            );
            toolSchemaErrors = [
              {
                module: '',
                name: '',
                message: err instanceof Error ? err.message : String(err),
              },
            ];
          }
        }
        return {
          status: 'ready',
          searchDoc: cleanedDoc,
          resource,
          types,
          displayNames,
          deps,
          ...(error ? { error } : {}),
          ...(mismatch ? { mismatch: true } : {}),
          ...(frontmatterParseError ? { frontmatterParseError } : {}),
          ...(toolSchemaErrors ? { toolSchemaErrors } : {}),
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

  // For a skill markdown file (`kind: 'skill'`), generate each frontmatter
  // tool's LLM tool definition and stamp it — with the resolved absolute
  // codeRef, functionName, and normalized requiresApproval — onto the
  // file-meta resource, so consumers (ai-bot first) obtain ready-to-use tool
  // definitions from the index without a module loader. Runs after
  // `buildFileResource` and replaces the resource's `frontmatter` with an
  // enriched copy: the search doc shares the original object by reference,
  // and multi-KB schemas must never land in `search_doc`.
  //
  // A tool that fails (module won't load, missing export, schema generation
  // throws) stays in the tools list as authored and contributes a
  // `ToolSchemaError`; the remaining tools still enrich.
  //
  // Loading realm-hosted tool modules through the loader also records them
  // as runtime dependencies of this extract, so editing such a module
  // reindexes the referencing skill. Host-package tool modules
  // (`@cardstack/boxel-host/...`) resolve inside the host bundle and don't
  // participate in invalidation — their stamped schemas can go stale across
  // host deploys until the skill's realm reindexes.
  private async stampSkillToolSchemas(
    resource: FileMetaResource,
  ): Promise<ToolSchemaError[] | undefined> {
    let attributes = resource.attributes as Record<string, any>;
    if (attributes.kind !== 'skill') {
      return undefined;
    }
    let frontmatter = attributes.frontmatter as Record<string, any> | undefined;
    // A fresh extract always serializes skill tools under `tools` — the
    // frontmatter field maps the pre-rename `boxel.commands` key there too
    // (see SkillFrontmatterField.fromFrontmatter).
    let authoredTools =
      frontmatter && Array.isArray(frontmatter.tools)
        ? (frontmatter.tools as Record<string, any>[])
        : undefined;
    if (!frontmatter || !authoredTools?.length) {
      return undefined;
    }

    let loader = this.#loaderService.loader;
    let cardApi = await loader.import<typeof CardAPI>(
      'https://cardstack.com/base/card-api',
    );
    let mappings = await basicMappings(loader);
    // Tool classes never read the context during schema generation, but
    // host-package tools resolve services (e.g. the loader) through the
    // context's owner at construction — so the stamp object must carry one,
    // the same shape the tool service hands to real invocations.
    let toolContext: ToolContext = { [ToolContextStamp]: true };
    setOwner(toolContext, getOwner(this.#loaderService)!);

    let errors: ToolSchemaError[] = [];
    let enrichedTools: Record<string, any>[] = [];
    for (let entry of authoredTools) {
      let codeRef = entry?.codeRef as
        | { module?: unknown; name?: unknown }
        | undefined;
      if (
        typeof codeRef?.module !== 'string' ||
        typeof codeRef?.name !== 'string'
      ) {
        errors.push({
          module: typeof codeRef?.module === 'string' ? codeRef.module : '',
          name: typeof codeRef?.name === 'string' ? codeRef.name : '',
          message: 'tool entry is missing a codeRef module/name',
        });
        enrichedTools.push(entry);
        continue;
      }
      // Resolve in RRI space (no VirtualNetwork), matching how ToolField
      // computes `functionName` — so the stamped name and a host-side
      // recomputation from the stamped codeRef always agree. Package
      // specifiers pass through verbatim.
      let resolvedRef = codeRefWithAbsoluteIdentifier(
        { module: rri(codeRef.module), name: codeRef.name },
        new URL(this.#fileURL),
        undefined,
      ) as ResolvedCodeRef;
      try {
        let ToolClass = await getClass(resolvedRef, loader);
        if (typeof ToolClass !== 'function') {
          throw new Error(
            `module does not export a tool class named "${resolvedRef.name}"`,
          );
        }
        let tool = new ToolClass(toolContext);
        let functionName = buildToolFunctionNameFromResolvedRef(resolvedRef);
        let toolDefinition = {
          type: 'function' as LLMTool['type'],
          function: {
            name: functionName,
            description: tool.description,
            parameters: {
              type: 'object',
              properties: {
                description: {
                  type: 'string',
                },
                ...(await tool.getInputJsonSchema(cardApi, mappings)),
              },
              required: ['attributes', 'description'],
            },
          },
        };
        enrichedTools.push({
          ...entry,
          codeRef: resolvedRef,
          // Absent means "requires approval"; stamp that decision so
          // consumers don't each re-implement the default.
          requiresApproval: entry.requiresApproval !== false,
          functionName,
          tool: toolDefinition,
        });
      } catch (err) {
        console.warn(
          `[file-extract] tool schema generation failed for ${resolvedRef.module}#${resolvedRef.name} (skill ${this.#fileURL}):`,
          err,
        );
        errors.push({
          module: resolvedRef.module,
          name: resolvedRef.name,
          message: err instanceof Error ? err.message : String(err),
        });
        enrichedTools.push(entry);
      }
    }
    attributes.frontmatter = { ...frontmatter, tools: enrichedTools };
    return errors.length ? errors : undefined;
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
