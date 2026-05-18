import { registerDestructor } from '@ember/destroyable';
import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import {
  baseFileRef,
  baseRealm,
  formattedError,
  logger,
  snapshotRuntimeDependencies,
  withRuntimeDependencyTrackingContext,
  type RenderError,
} from '@cardstack/runtime-common';

import { errorJsonApiToErrorEntry } from '../../lib/window-error-handler';
import { createAuthErrorGuard } from '../../utils/auth-error-guard';
import {
  FileDefAttributesExtractor,
  type FileDefExtractResult,
} from '../../utils/file-def-attributes-extractor';

import type LoaderService from '../../services/loader-service';
import type NetworkService from '../../services/network';
import type RealmService from '../../services/realm';
import type { Model as RenderModel } from '../render';

const log = logger('render-route:file-extract');

export type Model = { id: string; nonce: string } & FileDefExtractResult;

export default class RenderFileExtractRoute extends Route<Model> {
  @service declare loaderService: LoaderService;
  @service declare network: NetworkService;
  @service declare realm: RealmService;
  #authGuard = createAuthErrorGuard();

  deactivate() {
    if (isTesting()) {
      (globalThis as any).__boxelRenderContext = undefined;
    }
    this.#authGuard.unregister();
  }

  async beforeModel(transition: Transition) {
    await super.beforeModel?.(transition);
    (globalThis as any).__boxelRenderContext = true;
    registerDestructor(this, () => {
      if (isTesting()) {
        (globalThis as any).__boxelRenderContext = undefined;
      }
    });
    this.#authGuard.register();
    if (!isTesting()) {
      this.realm.restoreSessionsFromStorage();
    }
  }

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

    let fileDefCodeRef = parsedOptions.fileDefCodeRef ?? baseFileRef;
    let contentHash: string | undefined = parsedOptions.fileContentHash;
    let contentSize: number | undefined = parsedOptions.fileContentSize;
    let extractor = new FileDefAttributesExtractor({
      loaderService: this.loaderService,
      network: this.network,
      authGuard: this.#authGuard,
      fileURL: id,
      fileDefCodeRef,
      baseFileDefCodeRef: baseFileRef,
      contentHash,
      contentSize,
      buildError: this.#buildError.bind(this),
    });
    let result: FileDefExtractResult;
    try {
      result = await withRuntimeDependencyTrackingContext(
        {
          mode: 'non-query',
          source: 'render:file-extract',
          consumer: id,
          consumerKind: 'file',
        },
        async () => await extractor.extract(),
      );
    } catch (error) {
      result = {
        status: 'error',
        searchDoc: null,
        deps: [fileDefCodeRef.module],
        error: this.#buildError(id, error),
      };
    }
    let { deps } = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    // `baseFileRef.module` points at `card-api` (where FileDef is implemented),
    // but the indexer references `file-api` — the canonical public re-export —
    // when invalidating file extracts. Pin it as a static dep so the contract
    // doesn't ride on whether the runtime tracker happened to observe an
    // import of file-api during the active session window.
    let baseFileApiModule = `${baseRealm.url}file-api`;
    let resultDeps = result.deps ?? [];
    if (
      !deps.includes(baseFileApiModule) &&
      !resultDeps.includes(baseFileApiModule)
    ) {
      // If this fires repeatedly the static merge below is masking a real
      // regression in the tracking-session lifecycle — worth investigating
      // rather than treating as a permanent fallback.
      log.warn(
        `runtime tracker missed canonical file-api module for ${id} ` +
          `(nonce=${nonce}); falling back to static dep. ` +
          `extractor deps=${JSON.stringify(resultDeps)} ` +
          `tracker deps=${JSON.stringify(deps)}`,
      );
    }
    let mergedDeps = [...new Set([baseFileApiModule, ...resultDeps, ...deps])];
    return {
      id,
      nonce,
      ...result,
      deps: mergedDeps,
    };
  }

  #buildError(url: string, error: any): RenderError {
    let errorJSONAPI = formattedError(url, error).errors[0];
    return errorJsonApiToErrorEntry(errorJSONAPI) as RenderError;
  }
}
