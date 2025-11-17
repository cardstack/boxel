import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { parse } from 'date-fns';
import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import { SupportedMimeType, logger } from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type { SaveType } from '@cardstack/host/services/card-service';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import type LoaderService from '../services/loader-service';
import type MessageService from '../services/message-service';
import type NetworkService from '../services/network';

const log = logger('resource:file');
const realmEventsLogger = logger('realm:events');

type TextDecoderCtor = typeof TextDecoder;
type TextEncoderCtor = typeof TextEncoder;
type BufferLike = {
  from(
    input: ArrayBuffer | ArrayBufferView | string,
    encoding?: string,
  ): { toString(encoding?: string): string; length: number };
  byteLength?(input: string, encoding?: string): number;
};

const TextDecoderImpl = (
  globalThis as typeof globalThis & { TextDecoder?: TextDecoderCtor }
).TextDecoder;
const TextEncoderImpl = (
  globalThis as typeof globalThis & { TextEncoder?: TextEncoderCtor }
).TextEncoder;
const BufferImpl = (
  globalThis as typeof globalThis & {
    Buffer?: BufferLike;
  }
).Buffer;

const utf8Decoder = TextDecoderImpl ? new TextDecoderImpl() : undefined;
const utf8Encoder = TextEncoderImpl ? new TextEncoderImpl() : undefined;

function decodeUtf8(buffer: ArrayBuffer): string {
  if (utf8Decoder) {
    return utf8Decoder.decode(buffer);
  }
  if (BufferImpl) {
    // Buffer handles ArrayBuffer and ArrayBufferView inputs in Node environments
    return BufferImpl.from(buffer).toString('utf8');
  }
  throw new Error('No UTF-8 decoder available in this environment');
}

function utf8ByteLength(content: string): number {
  if (utf8Encoder) {
    return utf8Encoder.encode(content).byteLength;
  }
  if (BufferImpl) {
    if (typeof BufferImpl.byteLength === 'function') {
      return BufferImpl.byteLength(content, 'utf8');
    }
    return BufferImpl.from(content, 'utf8').length;
  }
  return content.length;
}

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
  write(
    content: string,
    opts?: {
      flushLoader?: boolean;
      saveType?: SaveType;
      clientRequestId?: string;
    },
  ): Promise<void>;
  lastModifiedAsDate?: Date;
  isBinary?: boolean;
  writing?: Promise<void>;
}

export type FileResource = Loading | ServerError | NotFound | Ready;

class _FileResource extends Resource<Args> {
  declare private _url: string;
  private onStateChange?: ((state: FileResource['state']) => void) | undefined;
  private onRedirect?: ((url: string) => void) | undefined;
  private subscription: { url: string; unsubscribe: () => void } | undefined;
  writing: Promise<void> | undefined;

  @tracked private innerState: FileResource = {
    state: 'loading',
  };

  @service declare private loaderService: LoaderService;
  @service declare private network: NetworkService;
  @service declare private messageService: MessageService;
  @service declare private cardService: CardService;
  @service declare private recentFilesService: RecentFilesService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  constructor(owner: Owner) {
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
    callback: (ev: RealmEventContent) => void,
  ) {
    if (this.subscription && this.subscription.url !== realmURL) {
      this.subscription.unsubscribe();
      this.subscription = undefined;
    }

    if (!this.subscription) {
      this.subscription = {
        url: realmURL,
        unsubscribe: this.messageService.subscribe(realmURL, callback),
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
        // For example, when inputting `experiments/author` will redirect to `experiments/author.gts`
        this.onRedirect(this.innerState.url);
      }
    }
  }

  private read = restartableTask(async () => {
    let response;
    try {
      response = await this.network.authedFetch(this._url, {
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
    } catch (err: any) {
      log.error(`Could not get file ${this._url}, err: ${err.message}`);
      this.updateState({ state: 'not-found', url: this._url });
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
    let content = decodeUtf8(buffer);

    let self = this;
    let rawName = response.url.split('/').pop();

    this.updateState({
      state: 'ready',
      lastModified,
      realmURL,
      content,
      name: rawName ? decodeURIComponent(rawName) : rawName!,
      size,
      url: response.url,
      write(
        content: string,
        opts?: {
          flushLoader?: boolean;
          saveType?: SaveType;
          clientRequestId?: string;
        },
      ) {
        self.writing = self.writeTask
          .unlinked() // If the component which performs this task from within another task is destroyed, for example the "add field" modal, we want this task to continue running
          .perform(this, content, opts);
        return self.writing;
      },
    });

    this.setSubscription(realmURL, (event: RealmEventContent) => {
      if (
        event.eventName !== 'index' ||
        // we wait specifically for the index complete event ("incremental") so
        // that the subsequent index read retrieves the latest contents of the file
        event.indexType !== 'incremental' ||
        !Array.isArray(event.invalidations)
      ) {
        return;
      }

      let { invalidations } = event as { invalidations: string[] };
      let normalizedURL = this.url.endsWith('.json')
        ? this.url.replace(/\.json$/, '')
        : this.url;

      if (invalidations.includes(normalizedURL)) {
        realmEventsLogger.trace(
          `file resource ${normalizedURL} processing invalidation`,
          event,
        );

        let clientRequestId = event.clientRequestId;
        let reloadFile = false;

        if (!clientRequestId || clientRequestId.startsWith('instance:')) {
          reloadFile = true;
          realmEventsLogger.debug(
            `reloading file resource ${normalizedURL} because realm event has ${!clientRequestId ? 'no clientRequestId' : 'clientRequestId from instance editor'}`,
          );
        } else if (
          clientRequestId.startsWith('editor:') ||
          clientRequestId.startsWith('editor-with-instance:')
        ) {
          if (this.cardService.clientRequestIds.has(clientRequestId)) {
            realmEventsLogger.debug(
              `ignoring because request id is contained in known clientRequestIds`,
              event.clientRequestId,
            );
          } else {
            reloadFile = true;
            realmEventsLogger.debug(
              `reloading file resource ${normalizedURL} because request id is ${clientRequestId}, not contained within known clientRequestIds`,
              Object.keys(this.cardService.clientRequestIds),
            );
          }
        } else if (clientRequestId.startsWith('bot-patch:')) {
          reloadFile = true;
          realmEventsLogger.debug(
            `reloading file resource ${normalizedURL} because request id is ${clientRequestId}`,
          );
        }

        if (reloadFile) {
          this.read.perform();
        }
      }
    });
  });

  writeTask = restartableTask(
    async (
      state: Ready,
      content: string,
      opts?: {
        flushLoader?: boolean;
        saveType?: SaveType;
        clientRequestId?: string;
      },
    ) => {
      let response = await this.cardService.saveSource(
        new URL(this._url),
        content,
        opts?.saveType ?? 'editor',
        {
          resetLoader: opts?.flushLoader,
          clientRequestId: opts?.clientRequestId,
        },
      );
      if (this.innerState.state === 'not-found') {
        // TODO think about the "unauthorized" scenario
        throw new Error(
          'this should be impossible--we are creating the specified path',
        );
      }
      let size = utf8ByteLength(content);

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
