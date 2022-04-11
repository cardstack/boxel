import { Resource, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';

interface Args {
  named: { url: URL };
}

export class ImportResource extends Resource<Args> {
  @tracked module: any;
  @tracked error: string | undefined;

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
      this.error = errResponse.ok
        ? `cannot obtain error message for failed import of ${url.href}`
        : await errResponse.text();
    }
  }
}

export function importResource(parent: object, url: () => URL) {
  return useResource(parent, ImportResource, () => ({ named: { url: url() } }));
}
