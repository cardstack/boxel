import { Resource, useResource } from 'ember-resources';
import { registerDestructor } from '@ember/destroyable';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import flatMap from 'lodash/flatMap';
import { DirectoryEntryRelationship } from '@cardstack/runtime-common';

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
    let entries = await getEntries(this.url);
    entries.sort((a, b) => a.path.localeCompare(b.path));

    this.entries = entries;
  }
}

export function directory(parent: object, url: () => string | undefined) {
  return useResource(parent, DirectoryResource, () => ({
    named: { url: url() },
  }));
}

// TODO when we want to include actual real file-tree behavior, let's stop
// recursing blindly into directories
async function getEntries(url: string): Promise<Entry[]> {
  let response: Response | undefined;
  response = await fetch(url, {
    headers: { Accept: 'application/vnd.api+json' },
  });
  if (!response.ok) {
    // the server takes a moment to become ready do be tolerant of errors at boot
    console.log(
      `Could not get directory listing ${url}, status ${response.status}: ${
        response.statusText
      } - ${await response.text()}`
    );
    return [];
  }
  let {
    data: { relationships },
  } = await response.json();

  let newEntries: Entry[] = Object.entries(relationships).map(
    ([name, info]: [string, DirectoryEntryRelationship]) => ({
      name,
      kind: info.meta.kind,
      path: new URL(info.links.related).pathname,
      indent:
        new URL(info.links.related).pathname.replace(/\/$/, '').split('/')
          .length - 1,
    })
  );
  let nestedDirs = flatMap(
    Object.values(relationships) as DirectoryEntryRelationship[],
    (rel) => (rel.meta.kind === 'directory' ? [rel.links.related] : [])
  );
  let nestedEntries: Entry[] = [];
  for (let dir of nestedDirs) {
    nestedEntries.push(...(await getEntries(dir)));
  }
  return [...newEntries, ...nestedEntries];
}
