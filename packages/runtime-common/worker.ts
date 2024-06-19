import * as JSONTypes from 'json-typescript';
import {
  Indexer,
  Loader,
  readFileAsText,
  Deferred,
  reportError,
  type Queue,
  type LocalPath,
  type RealmAdapter,
  type TextFileRef,
} from '.';
import { Kind } from './realm';

export interface Stats extends JSONTypes.Object {
  instancesIndexed: number;
  instanceErrors: number;
  moduleErrors: number;
}

export interface IndexResults {
  ignoreData: Record<string, string>;
  stats: Stats;
  invalidations: string[];
}

export interface Reader {
  readFileAsText: (
    path: LocalPath,
    opts?: { withFallbacks?: true },
  ) => Promise<TextFileRef | undefined>;
  readdir: (
    path: string,
  ) => AsyncGenerator<{ name: string; path: string; kind: Kind }, void>;
}

export type RunnerRegistration = (
  fromScratch: (realmURL: URL) => Promise<IndexResults>,
  incremental: (
    url: URL,
    realmURL: URL,
    operation: 'update' | 'delete',
    ignoreData: Record<string, string>,
  ) => Promise<IndexResults>,
) => Promise<void>;

export interface RunnerOpts {
  _fetch: typeof fetch;
  reader: Reader;
  registerRunner: RunnerRegistration;
  indexer: Indexer;
}

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
export type IndexRunner = (optsId: number) => Promise<void>;

// This class is used to support concurrent index runs against the same fastboot
// instance. While each index run calls visit on the fastboot instance and has
// its own memory space, the globals that are passed into fastboot are shared.
// This global is what holds loader context (specifically the loader fetch) and
// index mutators for the fastboot instance. each index run will have a
// different loader fetch and its own index mutator. in order to keep these from
// colliding during concurrent indexing we hold each set of fastboot globals in
// a map that is unique for the index run. When the server visits fastboot it
// will provide the indexer route with the id for the fastboot global that is
// specific to the index run.
let optsId = 0;
export class RunnerOptionsManager {
  #opts = new Map<number, RunnerOpts>();
  setOptions(opts: RunnerOpts): number {
    let id = optsId++;
    this.#opts.set(id, opts);
    return id;
  }
  getOptions(id: number): RunnerOpts {
    let opts = this.#opts.get(id);
    if (!opts) {
      throw new Error(`No runner opts for id ${id}`);
    }
    return opts;
  }
  removeOptions(id: number) {
    this.#opts.delete(id);
  }
}

export class Worker {
  #realmURL: URL;
  #runner: IndexRunner;
  runnerOptsMgr: RunnerOptionsManager;
  #reader: Reader;
  #indexer: Indexer;
  #queue: Queue;
  #loader: Loader;
  #fromScratch:
    | ((realmURL: URL, boom?: true) => Promise<IndexResults>)
    | undefined;
  #realmAdapter: RealmAdapter;
  #incremental:
    | ((
        url: URL,
        realmURL: URL,
        operation: 'update' | 'delete',
        ignoreData: Record<string, string>,
      ) => Promise<IndexResults>)
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
  ): Promise<TextFileRef | undefined> {
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
      registerRunner: async (fromScratch, incremental) => {
        this.#fromScratch = fromScratch;
        this.#incremental = incremental;
        try {
          let result = await run();
          deferred.fulfill(result);
        } catch (e: any) {
          // this exception is _very_ difficult to thread thru fastboot (a
          // `deferred.reject(e)` doesn't do the thing you'd expect). Presumably
          // the only kind of exceptions that get raised at this level would be
          // indexer DB issues. Let's just log in sentry here and let developers
          // followup on the issue from the sentry logs. Likely if an exception
          // was raised to this level the fastboot instance is probably no
          // longer usable.
          reportError(e);
          console.error(
            `Error raised during indexing has likely stopped the indexer`,
            e,
          );
        }
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
      let { ignoreData, stats, invalidations } = await this.#incremental(
        new URL(args.url),
        new URL(args.realmURL),
        args.operation,
        { ...args.ignoreData },
      );
      return {
        ignoreData: { ...ignoreData },
        invalidations,
        stats,
      };
    });
  };
}
