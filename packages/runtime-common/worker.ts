import * as JSONTypes from 'json-typescript';
import ignore, { type Ignore } from 'ignore';
import {
  Indexer,
  Loader,
  readFileAsText,
  Deferred,
  type Queue,
  type LocalPath,
  type RealmAdapter,
} from '.';
import {
  type IndexRunner,
  type RunnerOptionsManager,
  type RunState,
  type Stats,
  type Reader, // TODO move this type here
} from './search-index';
import { URLMap } from './url-map';

export interface FromScratchArgs extends JSONTypes.Object {
  realmURL: string;
}

export interface FromScratchResult extends JSONTypes.Object {
  ignoreData: Record<string, string>;
  stats: Stats;
}

export interface IncrementalArgs extends JSONTypes.Object {
  url: string;
  operation: 'update' | 'delete';
  realmURL: string;
  ignoreData: Record<string, string>;
}

export interface IncrementalResult {
  invalidations: string[];
  ignoreData: Record<string, string>;
  stats: Stats;
}

export class Worker {
  #realmURL: URL;
  #runner: IndexRunner;
  runnerOptsMgr: RunnerOptionsManager;
  #reader: Reader;
  #indexer: Indexer;
  #queue: Queue;
  #loader: Loader;
  #fromScratch: ((realmURL: URL) => Promise<RunState>) | undefined;
  #realmAdapter: RealmAdapter;
  #incremental:
    | ((
        prev: RunState,
        url: URL,
        operation: 'update' | 'delete',
        onInvalidation?: (invalidatedURLs: URL[]) => void,
      ) => Promise<RunState>)
    | undefined;

  constructor({
    realmURL,
    indexer,
    queue,
    indexRunner,
    runnerOptsManager,
    realmAdapter,
    loader,
  }: {
    realmURL: URL;
    indexer: Indexer;
    queue: Queue;
    indexRunner: IndexRunner;
    runnerOptsManager: RunnerOptionsManager;
    loader: Loader; // this should be analogous to the realm's loader template
    realmAdapter: RealmAdapter;
  }) {
    this.#realmURL = realmURL;
    this.#queue = queue;
    this.#indexer = indexer;
    this.#realmAdapter = realmAdapter;
    this.#reader = {
      readdir: this.#realmAdapter.readdir.bind(this.#realmAdapter),
      readFileAsText: this.readFileAsText.bind(this),
    };
    this.runnerOptsMgr = runnerOptsManager;
    this.#runner = indexRunner;
    this.#loader = Loader.cloneLoader(loader);
    this.#realmAdapter.setLoader?.(this.#loader);
  }

  async run() {
    await this.#queue.start();
    await this.#indexer.ready();

    await this.#queue.register(
      `from-scratch-index:${this.#realmURL}`,
      this.fromScratch,
    );
    await this.#queue.register(
      `incremental-index:${this.#realmURL}`,
      this.incremental,
    );
  }

  private async readFileAsText(
    path: LocalPath,
    opts: { withFallbacks?: true } = {},
  ): Promise<{ content: string; lastModified: number } | undefined> {
    return readFileAsText(
      path,
      this.#realmAdapter.openFile.bind(this.#realmAdapter),
      opts,
    );
  }

  private async prepareAndRunJob<T>(run: () => Promise<T>): Promise<T> {
    let deferred = new Deferred<T>();
    let optsId = this.runnerOptsMgr.setOptions({
      _fetch: this.#loader.fetch.bind(this.#loader),
      reader: this.#reader,
      indexer: this.#indexer,
      entrySetter: () => {
        throw new Error(
          `entrySetter is deprecated. remove this after feature flag removed`,
        );
      },
      registerRunner: async (fromScratch, incremental) => {
        this.#fromScratch = fromScratch;
        this.#incremental = incremental;
        let result = await run();
        deferred.fulfill(result);
      },
    });
    await this.#runner(optsId);
    let result = await deferred.promise;
    this.runnerOptsMgr.removeOptions(optsId);
    return result;
  }

  private fromScratch = async (args: FromScratchArgs) => {
    return await this.prepareAndRunJob<FromScratchResult>(async () => {
      if (!this.#fromScratch) {
        throw new Error(`Index runner has not been registered`);
      }
      let { ignoreData, stats } = await this.#fromScratch(
        new URL(args.realmURL),
      );
      return {
        ignoreData: { ...ignoreData },
        stats,
      };
    });
  };

  private incremental = async (args: IncrementalArgs) => {
    return await this.prepareAndRunJob<IncrementalResult>(async () => {
      if (!this.#incremental) {
        throw new Error(`Index runner has not been registered`);
      }
      let ignoreMap = new URLMap<Ignore>();
      for (let [url, contents] of Object.entries(args.ignoreData)) {
        ignoreMap.set(new URL(url), ignore().add(contents));
      }
      let { ignoreData, stats, invalidations } = await this.#incremental(
        // TODO clean this up after we remove feature flag. For now I'm just
        // including the bare minimum to keep this from blowing up using the old APIs
        {
          realmURL: new URL(args.realmURL),
          ignoreMap,
          ignoreData: { ...args.ignoreData },
          instances: new URLMap(),
          modules: new Map(),
        } as unknown as RunState,
        new URL(args.url),
        args.operation,
      );
      return {
        ignoreData: { ...ignoreData },
        invalidations,
        stats,
      };
    });
  };
}
