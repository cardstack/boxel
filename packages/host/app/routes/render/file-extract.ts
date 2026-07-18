import { registerDestructor } from '@ember/destroyable';
import { getOwner } from '@ember/owner';
import Route from '@ember/routing/route';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import type { RenderError } from '@cardstack/runtime-common';

import { createAuthErrorGuard } from '../../utils/auth-error-guard';

import {
  buildFileExtractError,
  runFileExtract,
} from '../../utils/file-extract-runner';

import type LoaderService from '../../services/loader-service';
import type NetworkService from '../../services/network';
import type RealmService from '../../services/realm';
import type { FileDefExtractResult } from '../../utils/file-def-attributes-extractor';
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

    let result = await runFileExtract({
      fileURL: id,
      renderOptions: parsedOptions,
      loaderService: this.loaderService,
      network: this.network,
      authGuard: this.#authGuard,
      owner: getOwner(this)!,
    });
    return {
      id,
      nonce,
      ...result,
    };
  }

  #buildError(url: string, error: any): RenderError {
    return buildFileExtractError(url, error);
  }
}
