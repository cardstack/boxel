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
  type RenderError,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

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
  #buildError: (url: string, error: unknown) => RenderError;
  #streamsPromise: Promise<
    [
      ReadableStream<Uint8Array> | Uint8Array,
      ReadableStream<Uint8Array> | Uint8Array,
    ]
  > | null = null;
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
        let types = typeCodeRefs.map((type) => internalKeyFor(type, undefined));
        let adoptsFrom = typeCodeRefs[0] ?? this.#fileDefCodeRef;
        return {
          status: 'ready',
          searchDoc,
          resource: buildFileResource(this.#fileURL, searchDoc, adoptsFrom),
          types,
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

  #getStreamForAttempt = async () => {
    if (!this.#primaryUsed) {
      this.#primaryUsed = true;
      return this.#getPrimaryStream();
    }
    return this.#getRetryStream();
  };

  async #getStreams() {
    if (!this.#streamsPromise) {
      this.#streamsPromise = (async () => {
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
        return await this.#teeResponse(response);
      })();
    }
    return this.#streamsPromise;
  }

  async #getPrimaryStream() {
    return (await this.#getStreams())[0];
  }

  async #getFallbackStream() {
    return (await this.#getStreams())[1];
  }

  async #getRetryStream() {
    if (!this.#fallbackBytes) {
      this.#fallbackBytes = await this.#streamToBytes(
        await this.#getFallbackStream(),
      );
    }
    return this.#fallbackBytes;
  }

  async #teeResponse(
    response: Response,
  ): Promise<
    [
      ReadableStream<Uint8Array> | Uint8Array,
      ReadableStream<Uint8Array> | Uint8Array,
    ]
  > {
    if (response.body && 'tee' in response.body) {
      return response.body.tee();
    }
    let bytes = new Uint8Array(await response.arrayBuffer());
    return [bytes, bytes];
  }

  async #streamToBytes(
    stream: ReadableStream<Uint8Array> | Uint8Array,
  ): Promise<Uint8Array> {
    if (stream instanceof Uint8Array) {
      return stream;
    }
    return new Uint8Array(await new Response(stream).arrayBuffer());
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

export function buildFileResource(
  fileURL: string,
  attributes: Record<string, any>,
  adoptsFrom: CodeRef,
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
    id: fileURL,
    type: 'file-meta',
    attributes: mergedAttributes,
    meta: {
      adoptsFrom,
    },
    links: { self: fileURL },
  };
}
