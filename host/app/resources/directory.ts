import { Resource, useResource } from 'ember-resources';
import { registerDestructor } from '@ember/destroyable';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { ResourceObjectWithId } from '@cardstack/runtime-common';

interface Args {
  named: { url: string | undefined };
}

export interface Entry {
  name: string;
  kind: 'directory' | 'file';
  path: string;
  indent: number; // get rid of this once we have collapse-able directory trees
}

export class DirectoryResource extends Resource<Args> {
  @tracked entries: Entry[] = [];
  private interval: ReturnType<typeof setInterval>;
  private url: string | undefined;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    registerDestructor(this, () => {
      clearInterval(this.interval);
    });
    this.interval = setInterval(() => taskFor(this.readdir).perform(), 1000);
    if (args.named.url) {
      if (!args.named.url.endsWith('/')) {
        throw new Error(`A directory URL must end with a "/"`);
      }
      this.url = args.named.url;
      taskFor(this.readdir).perform();
    }
  }

  @restartableTask private async readdir() {
    if (!this.url) {
      return;
    }
    let response: Response | undefined;
    try {
      response = await fetch(this.url, {
        headers: { Accept: 'application/vnd.api+json' },
      });
    } catch (err: unknown) {
      clearInterval(this.interval);
      throw err;
    }
    if (!response.ok) {
      // the server takes a moment to become ready do be tolerant of errors at boot
      console.log(
        `Could not get directory listing ${this.url}, status ${
          response.status
        }: ${response.statusText} - ${await response.text()}`
      );
      return;
    }

    let {
      included,
    }: { data: ResourceObjectWithId; included: ResourceObjectWithId[] } =
      await response.json();
    let entries: Entry[] = [];
    entries.push(
      ...included.map((i) => ({
        name:
          i.id.replace(/\/$/, '').split('/').pop()! +
          (i.type === 'directory' ? '/' : ''),
        kind: i.type as 'directory' | 'file',
        path: new URL(i.id).pathname,
        indent: new URL(i.id).pathname.replace(/\/$/, '').split('/').length - 1,
      }))
    );

    this.entries = entries;
  }
}

export function directory(parent: object, url: () => string | undefined) {
  return useResource(parent, DirectoryResource, () => ({
    named: { url: url() },
  }));
}
