import { Resource, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';

export interface Module {
  [exportName: string]: any;
}

interface Args {
  named: { urlOrModule: URL | Module };
}

export class ImportResource extends Resource<Args> {
  @tracked module: Module | undefined;
  @tracked error: { type: 'runtime' | 'compile'; message: string } | undefined;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    this.load(args.named.urlOrModule);
  }

  private async load(urlOrModule: URL | Module) {
    if (!(urlOrModule instanceof URL)) {
      this.module = urlOrModule;
      return;
    }

    let url = urlOrModule;
    try {
      this.module = await import(/* webpackIgnore: true */ url.href);
    } catch (err) {
      let errResponse = await fetch(url.href, {
        headers: { 'content-type': 'text/javascript' },
      });
      if (!errResponse.ok) {
        this.error = { type: 'compile', message: await errResponse.text() };
      } else {
        this.error = {
          type: 'runtime',
          message: `Encountered error while evaluating
${url.href}:

${err}

Check console log for more details`,
        };
        console.error(err);
      }
    }
  }
}

export function importResource(
  parent: object,
  urlOrModule: () => URL | Module
) {
  return useResource(parent, ImportResource, () => ({
    named: {
      urlOrModule: urlOrModule(),
    },
  }));
}
