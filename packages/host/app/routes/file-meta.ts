import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import {
  baseRealm,
  internalKeyFor,
  maybeRelativeURL,
  realmURL,
  type FilePrerenderMeta,
} from '@cardstack/runtime-common';

import type * as FileAPI from 'https://cardstack.com/base/file-api';
import type { BaseDef } from 'https://cardstack.com/base/card-api';

import { registerBoxelTransitionTo } from '../utils/register-boxel-transition';
import { friendlyCardType } from '../utils/render-error';
import {
  directModuleDeps,
  recursiveModuleDeps,
} from '../lib/prerender-util';

import { getDisplayNames, getTypes } from './render/meta';

import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';

export type Model = {
  id: string;
  nonce: string;
  status: 'ready' | 'error';
  payload: FilePrerenderMeta;
};

type FileMetaOptions = {
  fileDef?: {
    module: string;
    name: string;
  };
};

type FileMetaParams = {
  id: string;
  nonce: string;
  options?: string;
};

export type FileMetaModelContext = {
  router: RouterService;
  loaderService: LoaderService;
  cardService: CardService;
  network: NetworkService;
};

function parseFileMetaOptions(raw: string | undefined): FileMetaOptions {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as FileMetaOptions;
  } catch {
    return {};
  }
}

function defaultFileDefRef() {
  return { module: `${baseRealm.url}file-api`, name: 'FileDef' };
}

function buildErrorPayload(
  message: string,
  err?: unknown,
  isMismatch?: boolean,
): FilePrerenderMeta {
  let error = {
    message,
    name: (err as Error | undefined)?.name,
    stack: (err as Error | undefined)?.stack,
    isMismatch,
  };
  return {
    serialized: null,
    searchDoc: null,
    displayNames: null,
    deps: null,
    types: null,
    error,
  };
}

function fileNameFromURL(url: string): string {
  try {
    let name = new URL(url).pathname.split('/').pop();
    return name && name.length > 0 ? name : url;
  } catch {
    return url;
  }
}

async function buildFileStream(
  response: Response,
): Promise<ReadableStream<Uint8Array>> {
  if (response.body) {
    return response.body;
  }
  let buffer = new Uint8Array(await response.arrayBuffer());
  return new ReadableStream({
    start(controller) {
      controller.enqueue(buffer);
      controller.close();
    },
  });
}

export async function buildFileMetaModel(
  { id, nonce, options }: FileMetaParams,
  context: FileMetaModelContext,
): Promise<Model> {
  registerBoxelTransitionTo(context.router);

  let parsedOptions = parseFileMetaOptions(options);
  let fileDefRef = parsedOptions.fileDef ?? defaultFileDefRef();

  let fileDefModule: Record<string, unknown>;
  try {
    fileDefModule = await context.loaderService.loader.import<
      Record<string, unknown>
    >(fileDefRef.module);
  } catch (err: any) {
    return {
      id,
      nonce,
      status: 'error',
      payload: buildErrorPayload(
        `Unable to load file def module ${fileDefRef.module}`,
        err,
      ),
    };
  }

  let FileDefClass = fileDefModule[fileDefRef.name] as
    | (typeof BaseDef & {
        extractAttributes?: (
          url: string,
          stream: ReadableStream<Uint8Array>,
        ) => Promise<Record<string, unknown>>;
      })
    | undefined;
  if (!FileDefClass) {
    return {
      id,
      nonce,
      status: 'error',
      payload: buildErrorPayload(
        `File def ${fileDefRef.name} not found in ${fileDefRef.module}`,
      ),
    };
  }

  let response: Response;
  try {
    response = await context.network.authedFetch(id);
  } catch (err: any) {
    return {
      id,
      nonce,
      status: 'error',
      payload: buildErrorPayload(`Failed to fetch ${id}`, err),
    };
  }
  if (!response.ok) {
    return {
      id,
      nonce,
      status: 'error',
      payload: buildErrorPayload(
        `Failed to fetch ${id}: ${response.status} ${response.statusText}`,
      ),
    };
  }

  let stream = await buildFileStream(response);
  let extractedAttributes: Record<string, unknown> = {};
  if (typeof FileDefClass.extractAttributes === 'function') {
    try {
      extractedAttributes = await FileDefClass.extractAttributes(id, stream);
    } catch (err: any) {
      let mismatch =
        err?.name === 'FileTypeMismatchError' ||
        ((fileDefModule as FileAPI).FileTypeMismatchError instanceof Function &&
          err instanceof (fileDefModule as FileAPI).FileTypeMismatchError);
      return {
        id,
        nonce,
        status: 'error',
        payload: buildErrorPayload(
          err?.message ?? `File metadata extraction failed for ${id}`,
          err,
          mismatch,
        ),
      };
    }
  }

  let api = await context.cardService.getAPI();
  let contentType =
    response.headers.get('content-type') ?? 'application/octet-stream';
  let baseAttributes = {
    sourceUrl: id,
    url: id,
    name: fileNameFromURL(id),
    contentType,
  };
  let instance = new (FileDefClass as typeof BaseDef)({
    ...baseAttributes,
    ...extractedAttributes,
  });
  api.setId(instance as any, id);

  let serialized = await context.cardService.serializeCard(instance as any, {
    includeComputeds: true,
    maybeRelativeURL: (url: string) =>
      maybeRelativeURL(new URL(url), new URL(id), (instance as any)[realmURL]),
  });
  for (let relationship of Object.values(
    serialized.data.relationships ?? {},
  )) {
    delete relationship.data;
  }

  let moduleDeps = directModuleDeps(serialized.data, new URL(id));
  let deps = [
    ...(await recursiveModuleDeps(
      moduleDeps,
      context.loaderService.loader,
    )),
  ];

  let types = getTypes(FileDefClass as unknown as typeof BaseDef);
  let displayNames = getDisplayNames(FileDefClass as unknown as typeof BaseDef);
  let searchDoc = api.searchDoc(instance as any);
  searchDoc._cardType = friendlyCardType(FileDefClass as any);

  return {
    id,
    nonce,
    status: 'ready',
    payload: {
      serialized,
      searchDoc,
      displayNames,
      deps,
      types: types.map((t) => internalKeyFor(t, undefined)),
    },
  };
}

export default class FileMetaRoute extends Route<Model> {
  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @service declare network: NetworkService;

  async model(params: FileMetaParams, _transition: Transition) {
    return await buildFileMetaModel(params, {
      router: this.router,
      loaderService: this.loaderService,
      cardService: this.cardService,
      network: this.network,
    });
  }
}
