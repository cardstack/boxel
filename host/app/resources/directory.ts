import { Resource, useResource } from 'ember-resources';
import { registerDestructor } from '@ember/destroyable';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import flatMap from 'lodash/flatMap';
import { DirectoryEntryRelationship } from '@cardstack/runtime-common';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import { Loader } from '@cardstack/runtime-common/loader';
import LocalRealm from '../services/local-realm';

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
  private realmPath: RealmPaths;

  @service declare localRealm: LocalRealm;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    registerDestructor(this, () => {
      clearInterval(this.interval);
    });
    this.interval = setInterval(() => taskFor(this.readdir).perform(), 1000);
    if (!this.localRealm.isAvailable) {
      throw new Error('Local realm is not available');
    }
    this.realmPath = new RealmPaths(this.localRealm.url);
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
    let entries = await getEntries(this.realmPath, this.url);
    entries.sort((a, b) => {
      // need to re-insert the leading and trailing /'s in order to get a sort
      // that can organize the paths correctly
      let pathA = `/${a.path}${a.kind === 'directory' ? '/' : ''}`;
      let pathB = `/${b.path}${b.kind === 'directory' ? '/' : ''}`;
      return pathA.localeCompare(pathB);
    });
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
async function getEntries(
  realmPath: RealmPaths,
  url: string
): Promise<Entry[]> {
  let response: Response | undefined;
  response = await Loader.fetch(url, {
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
      path: realmPath.local(new URL(info.links.related)),
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
    nestedEntries.push(...(await getEntries(realmPath, dir)));
  }
  return [...newEntries, ...nestedEntries];
}
