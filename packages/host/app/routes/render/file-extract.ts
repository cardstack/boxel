import { registerDestructor } from '@ember/destroyable';
import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import {
  baseFileRef,
  baseRealm,
  formattedError,
  snapshotRuntimeDependencies,
  trackRuntimeModuleDependency,
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
      // This route is the indexing path, so skill tool schemas are generated
      // here and persisted with the row.
      generateToolSchemas: true,
    });
    let fileApiURL = `${baseRealm.url}file-api`;
    let result: FileDefExtractResult;
    try {
      result = await withRuntimeDependencyTrackingContext(
        {
          mode: 'non-query',
          source: 'render:file-extract',
          consumer: id,
          consumerKind: 'file',
        },
        async () => {
          // `${baseRealm.url}file-api` is the public URL the indexer
          // uses to invalidate file extracts, but the FileDef class
          // physically lives in `card-api` (`baseFileRef.module`). The
          // extractor only imports `card-api`, so without this line
          // `file-api` never enters the tracker.
          //
          // Stamp the dep on the tracker directly rather than relying
          // on `loader.import(fileApiURL)` to do it. `loader.import`'s
          // synchronous `trackRuntimeModuleDependency` call sits behind
          // a moduleShims check, the resolveImport URL rewrite, and the
          // advanceToState machine — any of which can interpose if the
          // page's loader was replaced (e.g. after
          // `BrowserManager.restartBrowser()`), which is exactly the
          // condition the file-extract test flakes under. Stamping the
          // tracker directly here is one synchronous call with no
          // moving parts.
          trackRuntimeModuleDependency(fileApiURL);
          return extractor.extract();
        },
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
    // Belt-and-suspenders: if the tracker call above didn't land in
    // the snapshot for any reason (session ended, URL normalization
    // mismatch), explicitly stamp `file-api` into the merged deps.
    // The indexer's invalidation contract requires this URL to be
    // present for file extracts; missing it produces silent
    // never-invalidated rows.
    let mergedDeps = [
      ...new Set([...(result.deps ?? []), ...deps, fileApiURL]),
    ];
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
