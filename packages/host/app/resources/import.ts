import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import { logger } from '@cardstack/runtime-common';

import type LoaderService from '../services/loader-service';

interface Args {
  named: { url: string };
}

const log = logger('resource:import');

export class ImportResource extends Resource<Args> {
  @tracked module: object | undefined;
  @tracked error: { type: 'runtime' | 'compile'; message: string } | undefined;
  @service declare loaderService: LoaderService;
  #loaded!: Promise<void>; // modifier runs at init so we will always have a value

  modify(_positional: never[], named: Args['named']) {
    let { url } = named;
    this.#loaded = this.load.perform(url);
  }

  get loaded() {
    return this.#loaded;
  }

  private load = task(async (url: string) => {
    try {
      let m = await this.loaderService.loader.import<object>(url);
      this.module = m;
    } catch (err) {
      let errResponse = await this.loaderService.fetchWithAuth(url, {
        headers: { 'content-type': 'text/javascript' },
      });
      if (!errResponse.ok) {
        this.error = { type: 'compile', message: await errResponse.text() };
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

export function importResource(parent: object, url: () => string) {
  return ImportResource.from(parent, () => ({
    named: {
      url: url(),
    },
  })) as ImportResource;
}
