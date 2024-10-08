import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import { logger } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import NetworkService from '../services/network';

import type LoaderService from '../services/loader-service';

interface Args {
  named: { url: string; loader: Loader };
}

const log = logger('resource:import');

export class ImportResource extends Resource<Args> {
  @service private declare network: NetworkService;
  @tracked module: object | undefined;
  @tracked error: { type: 'runtime' | 'compile'; message: string } | undefined;
  #loaded!: Promise<void>; // modifier runs at init so we will always have a value

  modify(_positional: never[], named: Args['named']) {
    let { url, loader } = named;
    this.#loaded = this.load.perform(url, loader);
  }

  get loaded() {
    return this.#loaded;
  }

  private load = task(async (url: string, loader: Loader) => {
    try {
      let m = await loader.import<object>(url);
      this.module = m;
    } catch (err: any) {
      let errResponse = await this.network.authedFetch(url, {
        headers: { 'content-type': 'text/javascript' },
      });
      if (!errResponse.ok) {
        this.error = {
          type: 'compile',
          message: err.responseText ?? (await errResponse.text()),
        };
      } else {
        this.error = {
          type: 'runtime',
          message: `Encountered error while evaluating
${url}:

${err}

Check console log for more details`,
        };
        log.error(err);
      }
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
