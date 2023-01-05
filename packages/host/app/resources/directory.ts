import { Resource } from 'ember-resources/core';
import { registerDestructor } from '@ember/destroyable';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import flatMap from 'lodash/flatMap';
import {
  DirectoryEntryRelationship,
  type Relationship,
} from '@cardstack/runtime-common';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import LoaderService from '../services/loader-service';

interface Args {
  named: { url: string | undefined; polling: 'off' | undefined };
}

export interface Entry {
  name: string;
  kind: 'directory' | 'file';
  path: string;
  indent: number; // get rid of this once we have collapse-able directory trees
}

export class DirectoryResource extends Resource<Args> {
  @tracked entries: Entry[] = [];
  private interval: ReturnType<typeof setInterval> | undefined;
  private url: string | undefined;
  private declare realmPath: RealmPaths;

  @service declare loaderService: LoaderService;

  modify(_positional: never[], named: Args['named']) {
    if (named.url) {
      this.realmPath = new RealmPaths(named.url);
      if (!named.url.endsWith('/')) {
        throw new Error(`A directory URL must end with a "/"`);
      }
      this.url = named.url;
      taskFor(this.readdir).perform();
    }
    if (named.polling !== 'off') {
      this.interval = setInterval(() => taskFor(this.readdir).perform(), 1000);
      registerDestructor(this, () => clearInterval(this.interval!));
    } else if (this.interval) {
      clearInterval(this.interval);
    }
  }

  @restartableTask private async readdir() {
    if (!this.url) {
      return;
    }
    let entries = await this.getEntries(this.realmPath, this.url);
    entries.sort((a, b) => {
      // need to re-insert the leading and trailing /'s in order to get a sort
      // that can organize the paths correctly
      let pathA = `/${a.path}${a.kind === 'directory' ? '/' : ''}`;
      let pathB = `/${b.path}${b.kind === 'directory' ? '/' : ''}`;
      return pathA.localeCompare(pathB);
    });
    this.entries = entries;
  }

  // TODO when we want to include actual real file-tree behavior, let's stop
  // recursing blindly into directories
  private async getEntries(
    realmPath: RealmPaths,
    url: string
  ): Promise<Entry[]> {
    let response: Response | undefined;
    response = await this.loaderService.loader.fetch(url, {
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
      data: { relationships: _relationships },
    } = await response.json();
    let relationships = _relationships as Record<string, Relationship>;
    let newEntries: Entry[] = Object.entries(relationships).map(
      ([name, info]) => ({
        name,
        kind: info.meta!.kind,
        path: realmPath.local(new URL(info.links!.related!)),
        indent:
          new URL(info.links!.related!).pathname.replace(/\/$/, '').split('/')
            .length - 1,
      })
    );
    let nestedDirs = flatMap(
      Object.values(relationships) as unknown[] as DirectoryEntryRelationship[],
      (rel) => (rel.meta.kind === 'directory' ? [rel.links.related] : [])
    );
    let nestedEntries: Entry[] = [];
    for (let dir of nestedDirs) {
      nestedEntries.push(...(await this.getEntries(realmPath, dir)));
    }
    return [...newEntries, ...nestedEntries];
  }
}

export function directory(
  parent: object,
  url: () => string | undefined,
  polling: () => 'off' | undefined
) {
  return DirectoryResource.from(parent, () => ({
    named: { url: url(), polling: polling() },
  })) as DirectoryResource;
}
