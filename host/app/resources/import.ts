import { Resource, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';

interface Args {
  named: { url: URL };
}

export class ImportResource extends Resource<Args> {
  @tracked module: any;
  @tracked error: { type: 'runtime' | 'compile'; message: string } | undefined;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    this.load(args.named.url);
  }

  private async load(url: URL) {
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

${err}.

Check console log for more details`,
        };
        console.error(err);
      }
    }
  }
}

export function importResource(parent: object, url: () => URL) {
  return useResource(parent, ImportResource, () => ({ named: { url: url() } }));
}
