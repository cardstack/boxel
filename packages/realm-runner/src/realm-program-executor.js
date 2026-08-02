import { BxlAdapter } from './bxl-adapter.js';
import { BoxelHttpAdapter } from './http-adapter.js';
import { RealmNotebookCoordinator } from './notebook.js';
import { runRealmScript } from './runner.js';

export class QuickJSRealmProgramExecutor {
  constructor({
    fetch = globalThis.fetch,
    bxl,
    realmServerUrl,
    notebookEncryptionKey,
    notebookStorage,
    now,
  } = {}) {
    this.fetch = fetch;
    this.bxl = bxl;
    this.realmServerUrl = realmServerUrl;
    this.notebook = new RealmNotebookCoordinator({
      encryptionKey: notebookEncryptionKey,
      ephemeralStorage: notebookStorage,
      now,
    });
  }

  async execute({
    code,
    mode,
    realmURL,
    authorization,
    input,
    notebook,
    onActivity,
  }) {
    let realmServerUrl = this.realmServerUrl ?? new URL('/', realmURL).href;
    let adapter = new BoxelHttpAdapter({
      fetch: this.fetch,
      authorization,
      realmServerUrl,
    });
    let run = (resolvedInput, resolvedCode = code, notebookContext = null) =>
      runRealmScript({
        code: resolvedCode,
        realm: realmURL,
        mode,
        input: resolvedInput,
        notebook: notebookContext,
        adapter,
        bxl: this.bxl,
        onActivity,
      });
    if (notebook === undefined) return run(input ?? {});
    return this.notebook.execute({
      notebook,
      input,
      code,
      mode,
      realmURL,
      authorization,
      adapter,
      run,
    });
  }
}

export async function createRealmProgramExecutor(options = {}) {
  let bxl = options.bxl;
  if (bxl === undefined) {
    try {
      bxl = await BxlAdapter.create();
    } catch (error) {
      options.onBxlUnavailable?.(error);
    }
  }
  return new QuickJSRealmProgramExecutor({ ...options, bxl });
}
