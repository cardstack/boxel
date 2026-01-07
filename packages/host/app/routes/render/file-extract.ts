import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import {
  baseRealm,
  formattedError,
  SupportedMimeType,
  type FileExtractResponse,
  type RenderError,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { errorJsonApiToErrorEntry } from '../../lib/window-error-handler';

import type LoaderService from '../../services/loader-service';
import type NetworkService from '../../services/network';
import type { Model as RenderModel } from '../render';
export type Model = FileExtractResponse;
const BASE_FILE_DEF_CODE_REF: ResolvedCodeRef = {
  module: `${baseRealm.url}file-api`,
  name: 'FileDef',
};
type FileDefExport = {
  extractAttributes: (
    url: string,
    getStream: () => Promise<unknown>,
    options?: { contentHash?: string },
  ) => Promise<any>;
};
type FileDefModule = Record<string, FileDefExport | undefined>;
type FileDefConstructor = {
  extractAttributes?: FileDefExport['extractAttributes'];
};
type FileDefExtractResult = {
  status: 'ready' | 'error';
  searchDoc: Record<string, any> | null;
  deps: string[];
  error?: RenderError;
  mismatch?: true;
};

export default class RenderFileExtractRoute extends Route<Model> {
  @service declare loaderService: LoaderService;
  @service declare network: NetworkService;

  async model(_: unknown, transition: Transition): Promise<Model> {
    let renderModel =
      (this.modelFor('render') as RenderModel | undefined) ??
      ((globalThis as any).__renderModel as RenderModel | undefined);
    if (!renderModel) {
      return {
        id: 'unknown',
        nonce: 'unknown',
        status: 'error',
        searchDoc: null,
        deps: [],
        error: this.#buildError(
          'unknown',
          new Error('missing render route params'),
        ),
      };
    }
    let { cardId: id, nonce, renderOptions: parsedOptions } = renderModel;
    if (!parsedOptions.fileExtract) {
      transition.abort();
      return {
        id,
        nonce,
        status: 'error',
        searchDoc: null,
        deps: [],
        error: this.#buildError(id, new Error('file extract mode required')),
      };
    }

    let fileDefCodeRef = parsedOptions.fileDefCodeRef ?? BASE_FILE_DEF_CODE_REF;
    let fileURL = this.#decodeURL(id);
    let contentHash: string | undefined = parsedOptions.fileContentHash;
    let extractor = new FileDefAttributesExtractor({
      loaderService: this.loaderService,
      network: this.network,
      fileURL,
      fileDefCodeRef,
      baseFileDefCodeRef: BASE_FILE_DEF_CODE_REF,
      contentHash,
      buildError: this.#buildError.bind(this),
    });
    let result = await extractor.extract();
    return {
      id: fileURL,
      nonce,
      ...result,
    };
  }

  #decodeURL(id: string): string {
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  }

  #buildError(url: string, error: any): RenderError {
    let errorJSONAPI = formattedError(url, error).errors[0];
    return errorJsonApiToErrorEntry(errorJSONAPI) as RenderError;
  }
}

class FileDefAttributesExtractor {
  #loaderService: LoaderService;
  #network: NetworkService;
  #fileURL: string;
  #fileDefCodeRef: ResolvedCodeRef;
  #baseFileDefCodeRef: ResolvedCodeRef;
  #contentHash: string | undefined;
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
    fileURL,
    fileDefCodeRef,
    baseFileDefCodeRef,
    contentHash,
    buildError,
  }: {
    loaderService: LoaderService;
    network: NetworkService;
    fileURL: string;
    fileDefCodeRef: ResolvedCodeRef;
    baseFileDefCodeRef: ResolvedCodeRef;
    contentHash: string | undefined;
    buildError: (url: string, error: unknown) => RenderError;
  }) {
    this.#loaderService = loaderService;
    this.#network = network;
    this.#fileURL = fileURL;
    this.#fileDefCodeRef = fileDefCodeRef;
    this.#baseFileDefCodeRef = baseFileDefCodeRef;
    this.#contentHash = contentHash;
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
        deps: [
          this.#fileURL,
          this.#fileDefCodeRef.module,
          this.#baseFileDefCodeRef.module,
        ],
        error: this.#buildError(
          this.#fileURL,
          new Error('Base FileDef module did not export extractAttributes'),
        ),
      };
    }

    let deps = [this.#fileURL, this.#fileDefCodeRef.module];
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
          { contentHash: this.#contentHash },
        );
      } catch (err) {
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
        return {
          status: 'ready',
          searchDoc,
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
          response = await this.#network.authedFetch(this.#fileURL, {
            method: 'GET',
            headers: {
              Accept: SupportedMimeType.CardSource,
            },
          });
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
          throw new Error(`Failed to fetch file (${response.status})`);
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
