import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import {
  logger,
  Relationship,
  SupportedMimeType,
} from '@cardstack/runtime-common';

import type LoaderService from '../services/loader-service';
import type MessageService from '../services/message-service';

const log = logger('resource:directory');

interface Args {
  named: {
    relativePath: string;
    realmURL: URL;
  };
}

export interface Entry {
  name: string;
  kind: 'directory' | 'file';
  path: string;
}

export class DirectoryResource extends Resource<Args> {
  @tracked entries: Entry[] = [];
  private directoryURL: URL | undefined;
  private subscription: { url: string; unsubscribe: () => void } | undefined;

  @service declare loaderService: LoaderService;
  @service declare messageService: MessageService;

  constructor(owner: Owner) {
    super(owner);
    registerDestructor(this, () => {
      if (this.subscription) {
        this.subscription.unsubscribe();
        this.subscription = undefined;
      }
    });
  }

  modify(_positional: never[], named: Args['named']) {
    this.directoryURL = new URL(named.relativePath, named.realmURL);
    this.readdir.perform();

    let path = `${named.realmURL}_message`;

    if (this.subscription && this.subscription.url !== path) {
      this.subscription.unsubscribe();
      this.subscription = undefined;
    }

    if (!this.subscription) {
      this.subscription = {
        url: path,
        unsubscribe: this.messageService.subscribe(path, ({ type }) => {
          // we are only interested in the filesystem based events
          if (type === 'update') {
            this.readdir.perform();
          }
        }),
      };
    }
  }

  private readdir = restartableTask(async () => {
    if (!this.directoryURL) {
      return;
    }
    let entries = await this.getEntries(this.directoryURL);

    entries.sort((a, b) => {
      // need to re-insert the leading and trailing /'s in order to get a sort
      // that can organize the paths correctly
      let pathA = `/${a.path}${a.kind === 'directory' ? '/' : ''}`;
      let pathB = `/${b.path}${b.kind === 'directory' ? '/' : ''}`;
      return pathA.localeCompare(pathB);
    });
    this.entries = entries;
  });

  private async getEntries(url: URL): Promise<Entry[]> {
    let response: Response | undefined;
    response = await this.loaderService.loader.fetch(url, {
      headers: { Accept: SupportedMimeType.DirectoryListing },
    });
    if (!response.ok) {
      // the server takes a moment to become ready do be tolerant of errors at boot

      log.error(
        `Could not get directory listing ${url}, status ${response.status}: ${
          response.statusText
        } - ${await response.text()}`,
      );
      return [];
    }

    let {
      data: { relationships: _relationships },
    } = await response.json();
    let relationships = _relationships as Record<string, Relationship>;
    return Object.entries(relationships).map(([name, info]) => ({
      name,
      kind: info.meta!.kind,
      path: info.links!.related!,
    }));
  }
}

export function directory(
  parent: object,
  relativePath: () => string,
  realmURL: () => URL,
) {
  return DirectoryResource.from(parent, () => ({
    relativePath: relativePath(),
    realmURL: realmURL(),
  })) as DirectoryResource;
}
