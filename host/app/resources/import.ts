import { Resource, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';

interface Args {
  named: { url: string };
}

const moduleURLs = new WeakMap<any, string>();

export function moduleURL(module: any): string | undefined {
  return moduleURLs.get(module);
}

export class ImportResource extends Resource<Args> {
  @tracked module: Record<string, any> | undefined;
  @tracked error: { type: 'runtime' | 'compile'; message: string } | undefined;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    this.load(args.named.url);
  }

  private async load(url: string) {
    try {
      let m = await import(/* webpackIgnore: true */ url);
      moduleURLs.set(m, url);
      this.module = m;
    } catch (err) {
      let errResponse = await fetch(url, {
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
}

export function importResource(parent: object, url: () => string) {
  return useResource(parent, ImportResource, () => ({
    named: {
      url: url(),
    },
  }));
}
