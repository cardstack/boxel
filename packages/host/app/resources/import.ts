import { Resource, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { taskFor } from 'ember-concurrency-ts';
import { task, timeout } from 'ember-concurrency';
import { Loader } from '@cardstack/runtime-common/loader';
import { getOwner } from '@ember/application';
import type LoaderService from '../services/loader-service';
import type { Constructable } from '../lib/types';

interface Args {
  named: { url: string; loader: Loader };
}

export class ImportResource extends Resource<Args> {
  @tracked module: object | undefined;
  @tracked error: { type: 'runtime' | 'compile'; message: string } | undefined;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    let { url, loader } = args.named;
    taskFor(this.load).perform(url, loader);
  }

  @task private async load(url: string, loader: Loader): Promise<void> {
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
        console.error(err);
      }
    }
  }

  get loaded(): Promise<void> {
    // TODO probably there is a more elegant way to express this in EC
    return (async () => {
      while (taskFor(this.load).isRunning) {
        await timeout(10);
      }
    })();
  }
}

export function importResource(parent: object, url: () => string) {
  return useResource(parent, ImportResource as Constructable<Resource>, () => ({
    named: {
      url: url(),
      loader: (
        (getOwner(parent) as any).lookup(
          'service:loader-service'
        ) as LoaderService
      ).loader,
    },
  }));
}
