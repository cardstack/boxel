import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import type {
  CardErrorJSONAPI,
  CardErrorsJSONAPI,
} from '@cardstack/runtime-common';
import { logger, CardError } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';

interface Args {
  named: { url: string };
}

export type LoadResult =
  | { module: object }
  | { error: { type: 'runtime' | 'compile'; message: string } };

export async function loadModule(
  url: string,
  loader: Loader,
  fetch: (url: string, options?: RequestInit) => Promise<Response>,
): Promise<LoadResult> {
  try {
    let m = await loader.import<object>(url);
    return { module: m };
  } catch (err: any) {
    let errResponse = await fetch(url, {
      headers: { 'content-type': 'text/javascript' },
    });
    if (!errResponse.ok) {
      let message = await errResponse.text();
      let cardError: CardError | undefined;
      try {
        let errorJSON: CardErrorJSONAPI = (
          JSON.parse(message) as CardErrorsJSONAPI
        ).errors[0];
        cardError = CardError.fromCardErrorJsonAPI(errorJSON);
        message = JSON.stringify(cardError, null, 2);
      } catch {
        // just use text of response
      }
      return {
        error: {
          type: 'compile',
          message,
        },
      };
    } else {
      log.error(err);
      return {
        error: {
          type: 'runtime',
          message: `Encountered error while evaluating
${url}:

${err}

Check console log for more details`,
        },
      };
    }
  }
}

const log = logger('resource:import');

export class ImportResource extends Resource<Args> {
  @service declare private network: NetworkService;
  @service declare private loaderService: LoaderService;
  @tracked module: object | undefined;
  @tracked error: { type: 'runtime' | 'compile'; message: string } | undefined;
  #loaded!: Promise<void>; // modifier runs at init so we will always have a value

  modify(_positional: never[], named: Args['named']) {
    let { url } = named;
    // The loader service is shared between the realm server and the host. this
    // resource can interfere with indexing in the browser by caching modules in
    // the loader that we are trying to change in our index. you can use the
    // `withoutLoaderMonitoring()` test helper to temporarily disable this
    // resource in scenarios that it is interfering with the tests.
    if (isTesting() && (globalThis as any).__disableLoaderMonitoring) {
      return;
    }
    this.#loaded = this.load.perform(url, this.loaderService.loader);
  }

  get loaded() {
    return this.#loaded;
  }

  private load = task(async (url: string, loader: Loader) => {
    const result = await loadModule(url, loader, this.network.authedFetch);
    if ('module' in result) {
      this.module = result.module;
    } else {
      this.error = result.error;
    }
  });
}

export function importResource(parent: object, url: () => string) {
  return ImportResource.from(parent, () => ({
    named: {
      url: url(),
    },
  })) as ImportResource;
}
