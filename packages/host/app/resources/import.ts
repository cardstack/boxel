import { Resource } from 'ember-resources/core';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { task } from 'ember-concurrency';
import { Loader } from '@cardstack/runtime-common/loader';
import { getOwner } from '@ember/application';
import type LoaderService from '../services/loader-service';
import type LogService from '../services/log';

interface Args {
  named: { url: string; loader: Loader };
}

export class ImportResource extends Resource<Args> {
  @service declare log: LogService;
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
    } catch (err) {
      let errResponse = await loader.fetch(url, {
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
        this.log.logger('host:resource:import').error(err);
      }
    }
  });
}

export function importResource(parent: object, url: () => string) {
  return ImportResource.from(parent, () => ({
    named: {
      url: url(),
      loader: (
        (getOwner(parent) as any).lookup(
          'service:loader-service'
        ) as LoaderService
      ).loader,
    },
  })) as ImportResource;
}
