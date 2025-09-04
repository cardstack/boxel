import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import { logger } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import NetworkService from '../services/network';

import type LoaderService from '../services/loader-service';

interface Args {
  named: { url: string; loader: Loader };
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
      return {
        error: {
          type: 'compile',
          message: err.responseText ?? (await errResponse.text()),
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
  @tracked module: object | undefined;
  @tracked error: { type: 'runtime' | 'compile'; message: string } | undefined;
  #loaded!: Promise<void>; // modifier runs at init so we will always have a value

  modify(_positional: never[], named: Args['named']) {
    let { url, loader } = named;
    // The loader service is shared between the realm server and the host. this
    // resource can interfere with indexing in the browser by caching modules in
    // the loader that we are trying to change in our index. you can use the
    // `withoutLoaderMonitoring()` test helper to temporarily disable this
    // resource in scenarios that it is interfering with the tests.
    if (isTesting() && (globalThis as any).__disableLoaderMonitoring) {
      return;
    }
    this.#loaded = this.load.perform(url, loader);
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

export function importResource(
  parent: object,
  url: () => string,
  loader?: () => Loader,
) {
  return ImportResource.from(parent, () => ({
    named: {
      url: url(),
      loader: loader
        ? loader()
        : (
            (getOwner(parent) as any).lookup(
              'service:loader-service',
            ) as LoaderService
          ).loader,
    },
  })) as ImportResource;
}
