import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { parse } from 'date-fns';
import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import { SupportedMimeType, logger } from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import LoaderService from '../services/loader-service';

import type MessageService from '../services/message-service';

const log = logger('resource:file');
const utf8 = new TextDecoder();
const encoder = new TextEncoder();

interface Args {
  named: {
    url: string;
    onStateChange?: (state: FileResource['state']) => void;
    onRedirect?: (url: string) => void;
  };
}

export interface Loading {
  state: 'loading';
}

export interface ServerError {
  state: 'server-error';
  url: string;
}

export interface NotFound {
  state: 'not-found';
  url: string;
}

export interface Ready {
  state: 'ready';
  content: string;
  name: string;
  url: string;
  lastModified: string | undefined;
  realmURL: string;
  size: number; // size in bytes
  write(content: string, flushLoader?: boolean): Promise<void>;
  lastModifiedAsDate?: Date;
  isBinary?: boolean;
  writing?: Promise<void>;
}

export type FileResource = Loading | ServerError | NotFound | Ready;

class _FileResource extends Resource<Args> {
  private declare _url: string;
  private onStateChange?: ((state: FileResource['state']) => void) | undefined;
  private onRedirect?: ((url: string) => void) | undefined;
  private subscription: { url: string; unsubscribe: () => void } | undefined;
  writing: Promise<void> | undefined;

  @tracked private innerState: FileResource = {
    state: 'loading',
  };

  @service declare loaderService: LoaderService;
  @service declare messageService: MessageService;
  @service declare cardService: CardService;
  @service declare recentFilesService: RecentFilesService;
  @service declare operatorModeStateService: OperatorModeStateService;

  constructor(owner: unknown) {
    super(owner);
    registerDestructor(this, () => {
      if (this.subscription) {
        this.subscription.unsubscribe();
        this.subscription = undefined;
      }
    });
  }

  private setSubscription(
    realmURL: string,
    callback: (ev: { type: string }) => void,
  ) {
    let messageServiceUrl = `${realmURL}_message`;
    if (this.subscription && this.subscription.url !== messageServiceUrl) {
      this.subscription.unsubscribe();
      this.subscription = undefined;
    }

    if (!this.subscription) {
      this.subscription = {
        url: messageServiceUrl,
        unsubscribe: this.messageService.subscribe(messageServiceUrl, callback),
      };
    }
  }

  modify(_positional: never[], named: Args['named']) {
    let { url, onStateChange, onRedirect } = named;

    this._url = url;
    this.onStateChange = onStateChange;
    this.onRedirect = onRedirect;
    this.read.perform();
  }

  private updateState(newState: FileResource): void {
    let prevState = this.innerState;
    this.innerState = newState;
    if (this.onStateChange && this.innerState.state !== prevState.state) {
      this.onStateChange(this.innerState.state);
    }
    if (this.innerState.state === 'ready') {
      this.recentFilesService.addRecentFileUrl(this.innerState.url);
      if (this.onRedirect && this._url != this.innerState.url) {
        // code below handles redirect returned by the realm server
        // this updates code path to be in-sync with the file.url
        // For example, when inputting `drafts/author` will redirect to `drafts/author.gts`
        this.onRedirect(this.innerState.url);
      }
    }
  }

  private read = restartableTask(async () => {
    let response = await this.loaderService.loader.fetch(this._url, {
      headers: { Accept: SupportedMimeType.CardSource },
    });

    if (!response.ok) {
      log.error(
        `Could not get file ${this._url}, status ${response.status}: ${
          response.statusText
        } - ${await response.text()}`,
      );
      if (response.status === 404) {
        this.updateState({ state: 'not-found', url: this._url });
      } else {
        this.updateState({ state: 'server-error', url: this._url });
      }
      return;
    }

    let lastModified = response.headers.get('last-modified') || undefined;

    if (
      lastModified &&
      this.innerState.state === 'ready' &&
      this.innerState.lastModified === lastModified
    ) {
      return;
    }

    let realmURL = response.headers.get('x-boxel-realm-url');

    if (!realmURL) {
      throw new Error('Missing x-boxel-realm-url header in response.');
    }

    let buffer = await response.arrayBuffer();
    let size = buffer.byteLength;
    let content = utf8.decode(buffer);

    let self = this;

    this.updateState({
      state: 'ready',
      lastModified,
      realmURL,
      content,
      name: response.url.split('/').pop()!,
      size,
      url: response.url,
      write(content: string, flushLoader?: true) {
        self.writing = self.writeTask
          .unlinked() // If the component which performs this task from within another task is destroyed, for example the "add field" modal, we want this task to continue running
          .perform(this, content, flushLoader);
        return self.writing;
      },
    });

    this.setSubscription(realmURL, () => this.read.perform());
  });

  writeTask = restartableTask(
    async (state: Ready, content: string, flushLoader?: true) => {
      let response = await this.cardService.saveSource(
        new URL(this._url),
        content,
      );
      if (this.innerState.state === 'not-found') {
        // TODO think about the "unauthorized" scenario
        throw new Error(
          'this should be impossible--we are creating the specified path',
        );
      }
      let size = encoder.encode(content).byteLength;

      this.updateState({
        state: 'ready',
        content,
        lastModified: response.headers.get('last-modified') || undefined,
        url: state.url,
        name: state.name,
        size,
        write: state.write,
        realmURL: state.realmURL,
      });

      if (flushLoader) {
        this.loaderService.reset();
      }
    },
  );

  get state() {
    return this.innerState.state;
  }

  get content() {
    return (this.innerState as Ready).content;
  }

  get name() {
    return (this.innerState as Ready).name;
  }

  get url() {
    return (this.innerState as Ready).url;
  }

  get size() {
    return (this.innerState as Ready).size;
  }

  get isBinary() {
    return isBinary(this.content);
  }

  get lastModified() {
    return (this.innerState as Ready).lastModified;
  }

  get lastModifiedAsDate() {
    let rfc7321Date = (this.innerState as Ready).lastModified;
    if (!rfc7321Date) {
      return;
    }
    // This is RFC-7321 format which is the last modified date format used in HTTP headers
    return parse(
      rfc7321Date.replace(/ GMT$/, 'Z'),
      'EEE, dd MMM yyyy HH:mm:ssX',
      new Date(),
    );
  }

  get realmURL() {
    return (this.innerState as Ready).realmURL;
  }

  get write() {
    return (this.innerState as Ready).write;
  }
}

export function file(parent: object, args: () => Args['named']): FileResource {
  return _FileResource.from(parent, () => ({
    named: args(),
  })) as unknown as FileResource;
}

export function isReady(f: FileResource | undefined): f is Ready {
  return f?.state === 'ready';
}

// This is a neat trick to test if a binary file was decoded as a string that
// works pretty well: https://stackoverflow.com/a/49773659. \ufffd is a special
// character called a "replacement character" that will appear when you try to
// decode a binary file as a string in javascript.
function isBinary(content: string) {
  return /\ufffd/.test(content);
}
