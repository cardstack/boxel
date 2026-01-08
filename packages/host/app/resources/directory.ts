import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import {
  logger,
  SupportedMimeType,
  type Relationship,
} from '@cardstack/runtime-common';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import type LoaderService from '../services/loader-service';
import type MessageService from '../services/message-service';
import type NetworkService from '../services/network';

const log = logger('resource:directory');

interface Args {
  named: {
    relativePath: string;
    realmURL: string;
  };
}

export interface Entry {
  name: string;
  kind: 'directory' | 'file';
  path: string;
}

export class DirectoryResource extends Resource<Args> {
  @tracked entries: Entry[] = [];
  private directoryURL: string | undefined;
  private subscription: { url: string; unsubscribe: () => void } | undefined;

  @service declare private loaderService: LoaderService;
  @service declare private messageService: MessageService;
  @service declare private network: NetworkService;

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
    let { relativePath, realmURL } = named;
    let directoryURL = new URL(relativePath, realmURL).href;
    if (this.directoryURL === directoryURL) {
      return;
    }
    this.directoryURL = directoryURL;
    this.readdir.perform();

    if (this.subscription && this.subscription.url !== realmURL) {
      this.subscription.unsubscribe();
      this.subscription = undefined;
    }

    if (!this.subscription) {
      this.subscription = {
        url: realmURL,
        unsubscribe: this.messageService.subscribe(
          realmURL,
          (event: RealmEventContent) => {
            if (!this.directoryURL) {
              return;
            }

            if (event.eventName !== 'index') {
              return;
            }

            if (!('updatedFile' in event)) {
              return;
            }

            let { updatedFile } = event as { updatedFile: string };
            let segments = updatedFile.split('/');
            segments.pop();
            let updatedDir = segments.join('/').replace(/([^/])$/, '$1/'); // directories always end in '/'
            if (updatedDir.startsWith(this.directoryURL)) {
              this.readdir.perform();
            }
          },
        ),
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

  private async getEntries(url: string): Promise<Entry[]> {
    let response: Response | undefined;
    response = await this.network.authedFetch(url, {
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
  realmURL: () => string,
) {
  return DirectoryResource.from(parent, () => ({
    relativePath: relativePath(),
    realmURL: realmURL(),
  })) as DirectoryResource;
}
