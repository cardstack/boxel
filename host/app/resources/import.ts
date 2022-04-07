import { Resource, useResource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';

interface Args {
  named: { url: URL };
}

export class ImportResource extends Resource<Args> {
  @tracked module: any;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    this.load(args.named.url);
  }

  private async load(url: URL) {
    this.module = await import(/* webpackIgnore: true */ url.href);
  }
}

export function importResource(parent: object, url: () => URL) {
  return useResource(parent, ImportResource, () => ({ named: { url: url() } }));
}
