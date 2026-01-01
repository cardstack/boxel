import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import {
  baseRealm,
  formattedError,
  parseRenderRouteOptions,
  SupportedMimeType,
  type FileExtractResponse,
  type RenderError,
} from '@cardstack/runtime-common';

import { errorJsonApiToErrorEntry } from '../../lib/window-error-handler';

import type LoaderService from '../../services/loader-service';
import type NetworkService from '../../services/network';

export type Model = FileExtractResponse;

export default class RenderFileExtractRoute extends Route<Model> {
  @service declare loaderService: LoaderService;
  @service declare network: NetworkService;

  async model(_: unknown, transition: Transition): Promise<Model> {
    let { id, nonce, options } = this.paramsFor('render') as {
      id: string;
      nonce: string;
      options?: string;
    };
    let parsedOptions = parseRenderRouteOptions(options);
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

    let fileDefModule =
      parsedOptions.fileDefModule ?? `${baseRealm.url}file-api`;
    let fileURL = this.#decodeURL(id);
    let response = await this.network.authedFetch(fileURL, {
      method: 'GET',
      headers: {
        Accept: SupportedMimeType.CardSource,
      },
    });
    if (!response.ok) {
      return {
        id: fileURL,
        nonce,
        status: 'error',
        searchDoc: null,
        deps: [fileURL, fileDefModule],
        error: this.#buildError(
          fileURL,
          new Error(`Failed to fetch file (${response.status})`),
        ),
      };
    }

    let [primaryStream, fallbackStream] = await this.#teeResponse(response);
    let { FileDef } = await this.loaderService.loader.import<{
      FileDef?: {
        extractAttributes: (url: string, stream: unknown) => Promise<any>;
      };
    }>(fileDefModule);
    if (!FileDef?.extractAttributes) {
      return {
        id: fileURL,
        nonce,
        status: 'error',
        searchDoc: null,
        deps: [fileURL, fileDefModule],
        error: this.#buildError(
          fileURL,
          new Error('FileDef module did not export extractAttributes'),
        ),
      };
    }
    let baseModule = `${baseRealm.url}file-api`;
    let { FileDef: BaseFileDef } = await this.loaderService.loader.import<{
      FileDef?: {
        extractAttributes: (url: string, stream: unknown) => Promise<any>;
      };
    }>(baseModule);
    if (!BaseFileDef?.extractAttributes) {
      return {
        id: fileURL,
        nonce,
        status: 'error',
        searchDoc: null,
        deps: [fileURL, fileDefModule, baseModule],
        error: this.#buildError(
          fileURL,
          new Error('Base FileDef module did not export extractAttributes'),
        ),
      };
    }

    let deps = [fileURL, fileDefModule];
    let error: RenderError | undefined;
    let mismatch = false;

    try {
      let searchDoc = await FileDef.extractAttributes(fileURL, primaryStream);
      return {
        id: fileURL,
        nonce,
        status: 'ready',
        searchDoc,
        deps,
      };
    } catch (err: any) {
      error = this.#buildError(fileURL, err);
      mismatch = err?.name === 'FileSignatureMismatchError';
    }

    if (fileDefModule !== baseModule) {
      deps.push(baseModule);
    }

    try {
      let searchDoc = await BaseFileDef.extractAttributes(
        fileURL,
        fallbackStream,
      );
      return {
        id: fileURL,
        nonce,
        status: 'ready',
        searchDoc,
        deps,
        ...(error ? { error } : {}),
        ...(mismatch ? { mismatch: true } : {}),
      };
    } catch (fallbackError: any) {
      let fallbackEntry = this.#buildError(fileURL, fallbackError);
      return {
        id: fileURL,
        nonce,
        status: 'error',
        searchDoc: null,
        deps,
        error: fallbackEntry,
      };
    }
  }

  async #teeResponse(
    response: Response,
  ): Promise<[ReadableStream<Uint8Array> | Uint8Array, ReadableStream<Uint8Array> | Uint8Array]> {
    if (response.body && 'tee' in response.body) {
      return response.body.tee();
    }
    let bytes = new Uint8Array(await response.arrayBuffer());
    return [bytes, bytes];
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
