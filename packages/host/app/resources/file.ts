import { Resource } from 'ember-resources';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { registerDestructor } from '@ember/destroyable';
import { SupportedMimeType, logger } from '@cardstack/runtime-common';
import LoaderService from '../services/loader-service';
import type MessageService from '../services/message-service';
import type CodeService from '@cardstack/host/services/code-service';

const log = logger('resource:file');

interface Args {
  named: {
    url: string;
    onStateChange?: (state: FileResource['state']) => void;
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
  realmURL: string | undefined;
  write(content: string, flushLoader?: boolean): void;
}

export type FileResource = Loading | ServerError | NotFound | Ready;

class _FileResource extends Resource<Args> {
  private declare _url: string;
  private onStateChange?: ((state: FileResource['state']) => void) | undefined;
  private subscription: { url: string; unsubscribe: () => void } | undefined;

  @tracked private innerState: FileResource = {
    state: 'loading',
  };

  @service declare loaderService: LoaderService;
  @service declare messageService: MessageService;
  @service declare codeService: CodeService;

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
    let { url, onStateChange } = named;

    this._url = url;
    this.onStateChange = onStateChange;
    this.read.perform();
  }

  private updateState(newState: FileResource): void {
    let prevState = this.innerState;
    this.innerState = newState;
    if (this.onStateChange && this.innerState.state !== prevState.state) {
      this.onStateChange(this.innerState.state);
    }

    if (newState.state === 'ready') {
      this.codeService.addRecentFile(newState.url);
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

    let content = await response.text();
    let self = this;

    this.updateState({
      state: 'ready',
      lastModified,
      realmURL,
      content,
      name: this._url.split('/').pop()!,
      url: this._url,
      write(content: string, flushLoader?: true) {
        self.writeTask.perform(this, content, flushLoader);
      },
    });

    this.setSubscription(realmURL, () => this.read.perform());
  });

  writeTask = restartableTask(
    async (state: Ready, content: string, flushLoader?: true) => {
      let response = await this.loaderService.loader.fetch(this._url, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.card+source',
        },
        body: content,
      });

      if (!response.ok) {
        let errorMessage = `Could not write file ${this._url}, status ${
          response.status
        }: ${response.statusText} - ${await response.text()}`;
        log.error(errorMessage);
        throw new Error(errorMessage);
      }
      if (this.innerState.state === 'not-found') {
        // TODO think about the "unauthorized" scenario
        throw new Error(
          'this should be impossible--we are creating the specified path',
        );
      }

      this.updateState({
        state: 'ready',
        content,
        lastModified: response.headers.get('last-modified') || undefined,
        url: state.url,
        name: state.name,
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

  get lastModified() {
    return (this.innerState as Ready).lastModified;
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
