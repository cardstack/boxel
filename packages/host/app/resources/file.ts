import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { next } from '@ember/runloop';
import { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { parse } from 'date-fns';
import {
  enqueueTask,
  keepLatestTask,
  restartableTask,
  timeout,
} from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import {
  SupportedMimeType,
  hasExecutableExtension,
  logger,
  rri,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type { SaveType } from '@cardstack/host/services/card-service';
import type CodeSourceCacheService from '@cardstack/host/services/code-source-cache';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';
import type StoreService from '@cardstack/host/services/store';

import type LoaderService from '../services/loader-service';
import type MessageService from '../services/message-service';
import type NetworkService from '../services/network';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

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
    initial?: InitialFileContent;
    onInitialSettled?: () => void;
    onStateChange?: (state: FileResource['state']) => void;
    onRedirect?: (url: string) => void;
  };
}

export interface InitialFileContent {
  content: string;
  lastModified?: string;
  realmURL: string;
}

export interface Loading {
  state: 'loading';
}

export interface ServerError {
  state: 'server-error';
  url: RealmResourceIdentifier;
}

export interface NotFound {
  state: 'not-found';
  url: RealmResourceIdentifier;
}

export interface Ready {
  state: 'ready';
  isCanonical?: boolean;
  // The source POST succeeded, but a hosted realm's executable route may not
  // yet be visible on every serving node. Module analysis uses this narrowly
  // scoped marker to retry transient 404s without hiding real missing imports.
  isNewlyCreated?: boolean;
  content: string;
  name: string;
  url: RealmResourceIdentifier;
  lastModified: string | undefined;
  realmURL: string;
  size: number; // size in bytes
  write(
    content: string,
    opts?: {
      flushLoader?: boolean;
      deferStoreRefresh?: () => boolean;
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
  private onInitialSettled?: (() => void) | undefined;
  private subscription: { url: string; unsubscribe: () => void } | undefined;
  private appliedInitial: InitialFileContent | undefined;
  private appliedCached: InitialFileContent | undefined;
  private validatingCachedURL: string | undefined;
  private awaitingInitialInvalidation = false;
  private recordedRecentURL: string | undefined;
  writing: Promise<void> | undefined;

  @tracked private innerState: FileResource = {
    state: 'loading',
  };

  @service declare private loaderService: LoaderService;
  @service declare private network: NetworkService;
  @service declare private messageService: MessageService;
  @service declare private cardService: CardService;
  @service declare private codeSourceCache: CodeSourceCacheService;
  @service declare private recentFilesService: RecentFilesService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private realmSandbox: RealmSandboxService;
  @service declare private store: StoreService;

  constructor(owner: Owner) {
    super(owner);
    registerDestructor(this, () => {
      if (this.subscription) {
        this.subscription.unsubscribe();
        this.subscription = undefined;
      }
    });
  }

  private readyState({
    content,
    isCanonical = true,
    isNewlyCreated = false,
    lastModified,
    realmURL,
    url,
  }: InitialFileContent & {
    url: string;
    isCanonical?: boolean;
    isNewlyCreated?: boolean;
  }): Ready {
    let self = this;
    let rawName = url.split('/').pop();
    let ready: Ready = {
      state: 'ready',
      isCanonical,
      isNewlyCreated,
      lastModified,
      realmURL,
      content,
      name: rawName ? decodeURIComponent(rawName) : rawName!,
      size: utf8ByteLength(content),
      url: rri(url),
      write(
        nextContent: string,
        opts?: {
          flushLoader?: boolean;
          deferStoreRefresh?: () => boolean;
          saveType?: SaveType;
          clientRequestId?: string;
        },
      ) {
        let currentState = self.innerState;
        if (currentState.state !== 'ready') {
          return Promise.reject(
            new Error(`Cannot write ${self._url} before it is ready`),
          );
        }
        // Stage the new buffer synchronously. Monaco, the code-preview
        // sandbox, and a following streamed patch block must all observe the
        // same newest generation without waiting for the realm round trip.
        // Writes are persisted in generation order below, so an older realm
        // response can never land after and overwrite a newer streamed block.
        let stagedState: Ready = {
          ...currentState,
          content: nextContent,
          size: utf8ByteLength(nextContent),
        };
        self.updateState(stagedState);
        self.writing = self.writeTask
          .unlinked() // Keep the write alive if its initiating UI is destroyed.
          .perform(stagedState, nextContent, opts);
        return self.writing;
      },
    };
    return ready;
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
    let { url, initial, onInitialSettled, onStateChange, onRedirect } = named;

    if (this._url !== url) {
      this.recordedRecentURL = undefined;
      this.appliedCached = undefined;
      this.validatingCachedURL = undefined;
    }
    this._url = url;
    this.onStateChange = onStateChange;
    this.onRedirect = onRedirect;
    this.onInitialSettled = onInitialSettled;

    // Subscribe to realm events BEFORE the first fetch so a 404 result
    // (e.g. the AI assistant navigates code-submode to a file it just
    // created, before realm indexing has caught up) can still be recovered
    // when the realm subsequently broadcasts an `index/incremental` event
    // for this URL. Without this, the success-branch `setSubscription`
    // below at the end of `read` is never reached on the 404 path, leaving
    // the resource permanently in `not-found` despite the realm having
    // since delivered the file.
    let realmId = this.realm.realmOf(rri(url));
    if (realmId) {
      this.setSubscription(realmId, this.onRealmInvalidation);
    } else {
      // No early subscription possible — the realm service hasn't yet
      // discovered the realm that owns this URL. Recovery from an initial
      // 404 then depends on the success-branch `setSubscription` inside
      // `read`, which only fires if the fetch eventually succeeds.
      log.debug(
        `FileResource: no known realm for ${url} at modify-time; deferring subscription to read-success branch`,
      );
    }

    // New-file creation already has an acknowledged source write. Starting
    // from that receipt avoids an unnecessary cross-node GET that can briefly
    // observe a 404 in hosted realms even though the POST is durable. Realm
    // invalidation remains subscribed above and reconciles canonical state.
    if (initial) {
      if (this.appliedInitial !== initial) {
        // Remember the receipt before scheduling the state update. Updating
        // Ready invalidates consumers and re-runs modify; without this guard,
        // the same receipt would continuously schedule another update.
        this.appliedInitial = initial;
        this.awaitingInitialInvalidation = true;
        this.seed.perform(url, initial);
      }
      return;
    }

    this.appliedInitial = undefined;
    this.awaitingInitialInvalidation = false;

    let cached = this.codeSourceCache.sourceFor(url);
    if (cached && this.appliedCached !== cached) {
      this.appliedCached = cached;
      this.seedCached.perform(url, cached);
      return;
    }
    if (this.validatingCachedURL === url) {
      return;
    }

    this.read.perform({ url });
  }

  private seedCached = restartableTask(
    async (url: string, cached: InitialFileContent) => {
      await new Promise<void>((resolve) => next(resolve));
      if (this._url !== url) {
        return;
      }
      this.validatingCachedURL = url;
      this.updateState(this.readyState({ ...cached, url }));
      try {
        // Cached bytes lead the UI, but the server remains canonical. Force
        // the body read because Last-Modified is only second precision.
        await this.read.perform({ url, force: true });
      } finally {
        if (this.validatingCachedURL === url) {
          this.validatingCachedURL = undefined;
        }
      }
    },
  );

  private seed = restartableTask(
    async (url: string, initial: InitialFileContent) => {
      // Resource.modify runs inside a reactive computation. Cross an async
      // boundary before updating tracked state so the acknowledged source can
      // become Ready without mutating a value consumed by that computation.
      await new Promise<void>((resolve) => next(resolve));
      if (this._url !== url) {
        return;
      }
      this.updateState(
        this.readyState({
          ...this.codeSourceCache.remember(url, initial),
          url,
          isCanonical: false,
          isNewlyCreated: true,
        }),
      );
      this.setSubscription(initial.realmURL, this.onRealmInvalidation);
    },
  );

  private settleInitial = restartableTask(async (url: string) => {
    let retryDelay = 50;

    while (this.awaitingInitialInvalidation && this._url === url) {
      let response: Response;
      try {
        // The index event says the write is durable, but in a hosted realm it
        // can reach the browser before every serving node can materialize the
        // executable representation. Probe the same representation that the
        // Loader will request; a source-only GET is not a sufficient boundary.
        response = await this.network.authedFetch(url, {
          headers: { Accept: SupportedMimeType.All },
        });
      } catch (err: any) {
        log.debug(
          `waiting for newly-created module ${url} after fetch failed: ${err.message}`,
        );
        await timeout(retryDelay);
        retryDelay = Math.min(retryDelay * 2, 1000);
        continue;
      }

      if (!this.awaitingInitialInvalidation || this._url !== url) {
        return;
      }

      if (response.status === 404) {
        await response.body?.cancel();
        log.debug(
          `waiting for newly-created module ${url} to become visible on this serving node`,
        );
        await timeout(retryDelay);
        retryDelay = Math.min(retryDelay * 2, 1000);
        continue;
      }

      // Any non-404 response proves that the executable route now exists.
      // ModuleContents owns classification of real compile/runtime failures;
      // settling here lets those errors surface without confusing a transient
      // cross-node visibility race with authored syntax.
      this.awaitingInitialInvalidation = false;
      let currentState = this.innerState;
      if (currentState.state === 'ready') {
        this.updateState({ ...currentState, isCanonical: true });
      }
      this.onInitialSettled?.();
      realmEventsLogger.debug(
        `newly-created module ${url} is visible to the executable loader`,
      );
      return;
    }
  });

  private updateState(newState: FileResource): void {
    let prevState = this.innerState;
    this.innerState = newState;
    if (this.onStateChange && this.innerState.state !== prevState.state) {
      this.onStateChange(this.innerState.state);
    }
    if (
      this.innerState.state === 'ready' &&
      this.recordedRecentURL !== this.innerState.url
    ) {
      this.recordedRecentURL = this.innerState.url;
      this.recentFilesService.addRecentFileUrl(this.innerState.url);
    }
    if (this.innerState.state === 'ready') {
      if (this.onRedirect && this._url != this.innerState.url) {
        // code below handles redirect returned by the realm server
        // this updates code path to be in-sync with the file.url
        // For example, when inputting `experiments/author` will redirect to `experiments/author.gts`
        this.onRedirect(this.innerState.url);
      }
    }
  }

  // `keepLatestTask`, not `restartableTask`: when an invalidation event
  // arrives while a read is in flight, we want the in-flight read to
  // complete and the event-driven reload to run AFTER it. Restarting
  // here would cancel the in-flight task, and the cancelled task's
  // awaited fetch would later throw TaskCancelation at the `await` —
  // catching that as a real fetch failure would overwrite the fresh
  // task's `state: 'ready'` with `state: 'not-found'` whenever the
  // cancelled response happened to land after the restart's response.
  // Queuing the latest extra perform keeps state writes sequential.
  private read = keepLatestTask(
    async (opts: { url: string; force?: boolean }) => {
      let requestedURL = opts.url;
      let response;
      try {
        response = await this.network.authedFetch(requestedURL, {
          headers: { Accept: SupportedMimeType.CardSource },
        });

        // `modify` can select another file while this request is in flight.
        // A response for the previous file must never update state or invoke
        // `onRedirect` for the newly selected path. Doing so bounces the route
        // between the old and new files and can create an unbounded render /
        // navigation loop. `keepLatestTask` will run the newest queued request;
        // this completion is simply obsolete.
        if (this._url !== requestedURL) {
          return;
        }

        if (!response.ok) {
          log.error(
            `Could not get file ${requestedURL}, status ${response.status}: ${
              response.statusText
            } - ${await response.text()}`,
          );
          if (this._url !== requestedURL) {
            return;
          }
          if (response.status === 404) {
            this.updateState({ state: 'not-found', url: rri(requestedURL) });
          } else {
            this.updateState({ state: 'server-error', url: rri(requestedURL) });
          }
          return;
        }
      } catch (err: any) {
        if (this._url !== requestedURL) {
          return;
        }
        log.error(`Could not get file ${requestedURL}, err: ${err.message}`);
        this.updateState({ state: 'not-found', url: rri(requestedURL) });
        return;
      }

      let lastModified = response.headers.get('last-modified') || undefined;

      // The short-circuit skips a no-op state update when nothing has changed.
      // Two guards both have to hold:
      //   1. Same URL as the prior state. Last-Modified is only unix-second
      //      precision (formatRFC7231(fileRef.lastModified * 1000) where
      //      fileRef.lastModified is unixTime(Date.now()) in both the
      //      node-realm and in-memory test adapters), so two DIFFERENT files
      //      written within the same wall-clock second carry identical
      //      headers — without the URL guard, navigating between such files
      //      would leave innerState pointing at the prior file.
      //   2. force !== true. An invalidation-driven read passes force: true
      //      because the realm has authoritatively told us the file changed,
      //      which outranks our cached timestamp — same reason same-second
      //      rewrites of the SAME file would otherwise be skipped.
      if (
        !opts?.force &&
        lastModified &&
        this.innerState.state === 'ready' &&
        this.innerState.url === rri(response.url) &&
        this.innerState.lastModified === lastModified
      ) {
        return;
      }

      let realmURL = response.headers.get('x-boxel-realm-url');

      if (!realmURL) {
        throw new Error('Missing x-boxel-realm-url header in response.');
      }

      let buffer = await response.arrayBuffer();
      if (this._url !== requestedURL) {
        return;
      }
      let content = decodeUtf8(buffer);

      let cached = this.codeSourceCache.remember(response.url, {
        lastModified,
        realmURL,
        content,
      });
      if (response.url !== requestedURL) {
        this.codeSourceCache.remember(requestedURL, cached);
      }
      this.appliedCached = cached;
      this.updateState(this.readyState({ ...cached, url: response.url }));

      this.setSubscription(realmURL, this.onRealmInvalidation);
    },
  );

  private onRealmInvalidation = (event: RealmEventContent): void => {
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
    // Match invalidations against both the currently-requested URL
    // (`this._url`, kept current by `modify`) and the URL the resource
    // most recently loaded into `innerState`. Both are necessary
    // because:
    //   - `innerState.url` may be a realm-canonicalized form of `_url`
    //     (e.g. `experiments/author` redirects to `experiments/author.gts`)
    //     and the realm emits invalidations for the canonical form.
    //   - During a transition (modify called with a new URL while
    //     innerState still holds a prior file), `innerState.url` is
    //     stale; only `_url` reflects what the caller is asking for —
    //     dropping the event here would orphan the new file.
    let normalize = (raw: string) =>
      raw.endsWith('.json') ? raw.replace(/\.json$/, '') : raw;
    let candidates = new Set<string>([normalize(this._url)]);
    if (this.innerState.state !== 'loading') {
      candidates.add(normalize(this.innerState.url));
    }
    let normalizedURL = invalidations.find((inv) => candidates.has(inv));

    if (normalizedURL) {
      realmEventsLogger.trace(
        `file resource ${normalizedURL} processing invalidation`,
        event,
      );

      let clientRequestId = event.clientRequestId;
      let reloadFile = false;

      // The source POST that supplied `appliedInitial` is already reflected
      // locally. Its index event confirms durability, but a hosted follow-up
      // GET can still race cross-node visibility and return 404. Consume that
      // one acknowledgement without replacing the authoritative local bytes;
      // later external invalidations continue through the normal reload path.
      //
      // This must run before the ordinary code-preview acknowledgement below.
      // A create-file commit can also be registered as an already-rendered
      // preview generation, but its FileResource still has `isCanonical:
      // false`. Swallowing the echo before this probe leaves module analysis
      // permanently gated even though an instance using the CardDef can load.
      if (
        this.awaitingInitialInvalidation &&
        clientRequestId?.startsWith('create-file:')
      ) {
        realmEventsLogger.debug(
          `verifying executable visibility for acknowledged source ${normalizedURL}`,
        );
        this.settleInitial.perform(this._url);
        return;
      }

      // Monaco/AI already published and rendered the exact source attached to
      // this write. The incremental index event is durability acknowledgement,
      // not another source generation. FileResource is a separate realm-event
      // subscriber from Store/search, so it must make the same decision or it
      // will fetch the canonical file and flash the preview after Store has
      // correctly stayed put.
      if (
        this.realmSandbox.isCodePreviewCommitAcknowledgement(
          clientRequestId ?? undefined,
          invalidations,
        )
      ) {
        realmEventsLogger.debug(
          `acknowledging locally rendered source ${normalizedURL} without reloading`,
        );
        return;
      }

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
      } else if (
        clientRequestId.startsWith('bot-patch:') ||
        // create-file writes originate from this host (cardService.saveSource
        // with saveType 'create-file' — the path WriteTextFileTool uses)
        // but the FileResource may not yet have any content because its first
        // fetch raced indexing and 404'd. The clientRequestId being in
        // cardService.clientRequestIds does NOT imply we already have the
        // content (unlike the editor: case), so we still need to reload.
        clientRequestId.startsWith('create-file:')
      ) {
        reloadFile = true;
        realmEventsLogger.debug(
          `reloading file resource ${normalizedURL} because request id is ${clientRequestId}`,
        );
      }

      if (reloadFile) {
        let handledByDisplayedPreview =
          (!clientRequestId ||
            !this.cardService.clientRequestIds.has(clientRequestId)) &&
          hasExecutableExtension(normalizedURL) &&
          this.realmSandbox.handleExternalModuleInvalidations([normalizedURL]);
        // Mirrors the store's invalidation path: only invalidate an ordinary
        // loader module when the rewritten module has actually been imported
        // (which includes entries cached as `state: 'broken'`). The targeted
        // eviction keeps Base, trusted realm, and unrelated user modules warm.
        // Clearing this URL's fetch-cache variants is required because
        // the module endpoint's ETag is keyed on unix-second-granularity
        // `lastModified`; without it, a write landing in the same second
        // as the prior fetch can be served as a 304 with the old broken
        // body. The store only covers realms it subscribed to (i.e. ones
        // it loaded a card instance from), so code-mode-only browsing of
        // a .gts whose realm has no loaded instance relies on this path.
        if (
          !handledByDisplayedPreview &&
          hasExecutableExtension(normalizedURL) &&
          this.loaderService.isModuleLoaded(normalizedURL)
        ) {
          this.loaderService.invalidateModule(normalizedURL, {
            clearFetchCache: true,
          });
        }
        this.read.perform({ url: this._url, force: true });
      }
    }
  };

  writeTask = enqueueTask(
    async (
      state: Ready,
      content: string,
      opts?: {
        flushLoader?: boolean;
        deferStoreRefresh?: () => boolean;
        saveType?: SaveType;
        clientRequestId?: string;
      },
    ) => {
      // Capture before saveSource invalidates this module and its known
      // dependants in place.
      let moduleWasLoaded =
        opts?.flushLoader && this.loaderService.isModuleLoaded(state.url);
      let response = await this.cardService.saveSource(
        new URL(state.url),
        content,
        opts?.saveType ?? 'editor',
        {
          resetLoader: opts?.flushLoader,
          clientRequestId: opts?.clientRequestId,
        },
      );
      // A rendered card only picks up new code when the store re-establishes
      // it: a card resource reads the store, not the loader, so flushing the
      // loader alone leaves an open preview on the superseded class. The
      // realm's index event drives a second, later pass, but waiting for it
      // would hold the preview stale until indexing completes — and gating
      // this pass on the store's realm subscription would withhold it exactly
      // when a preview is on screen, since an open playground is itself what
      // subscribes the realm. The moduleWasLoaded gate is the one that
      // belongs here: a write to a module nothing imported has no rendered
      // consumers to refresh.
      if (moduleWasLoaded && !opts?.deferStoreRefresh?.()) {
        if (this.realmSandbox.isSandboxedUserModule(state.url)) {
          // User CardDefs are opaque Store records. Their data identity does
          // not depend on the executable class generation, so update only the
          // canonical SES module/template cache.
          this.realmSandbox.invalidateCanonicalSandboxModule(state.url);
        } else {
          this.store.refreshReferencesForCodeChange('trusted file write', {
            triggerModule: this._url,
            realm: state.realmURL,
          });
        }
      }
      if (this.innerState.state === 'not-found') {
        // TODO think about the "unauthorized" scenario
        throw new Error(
          'this should be impossible--we are creating the specified path',
        );
      }
      let size = utf8ByteLength(content);

      let cached = this.codeSourceCache.remember(state.url, {
        content,
        lastModified: response.headers.get('last-modified') || undefined,
        realmURL: state.realmURL,
      });
      this.appliedCached = cached;
      this.updateState({
        state: 'ready',
        isCanonical: state.isCanonical,
        isNewlyCreated: state.isNewlyCreated,
        content: cached.content,
        lastModified: cached.lastModified,
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

  get isCanonical() {
    return (this.innerState as Ready).isCanonical;
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
