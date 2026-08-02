import { service } from '@ember/service';

import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import HostBaseTool from '../lib/host-base-tool';

import type NetworkService from '../services/network';
import type * as BaseToolModule from '@cardstack/base/command';

type RealmScriptMode = 'preview' | 'commit';

export default class RunRealmScriptTool extends HostBaseTool<
  typeof BaseToolModule.RunRealmScriptInput,
  typeof BaseToolModule.RunRealmScriptResult
> {
  @service declare private network: NetworkService;

  static actionVerb = 'Run Realm Script';
  description =
    'Run one capability-scoped QuickJS program against Boxel. It supports federated index search, cross-Realm reads, BXL/jq, staged Realm file operations, and the authenticated Realm/server API. For long scripts, insert awaited realm.activity messages before semantic phases; describe only the action and never interpolate code, paths, queries, arguments, or results. Pass input for ad-hoc realm.input data, or notebook { sessionId, cellId, persistence?, ttlMs?, inputs?, runSaved?, force? } for an interleaved notebook. Each result includes notebook.snapshot: inspect it for ordered saved source, run status, output references, and stale dependencies before writing the next cell. Bind earlier outputs through inputs, edit a later cell by supplying new code with the same cellId, use runSaved to load its saved code, and force to create a fresh revision; an exact retry otherwise reuses its result. Ephemeral notebooks expire; realm notebooks are encrypted durable workspace files. Preview mode is read-only apart from explicit notebook persistence and returns staged diffs. Commit mode applies staged text changes atomically and permits immediate raw API mutations, which are reported in output.effects.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.RunRealmScriptInput;
  }

  requireInputFields = ['realmIdentifier', 'mode'];

  protected async run(
    input: BaseToolModule.RunRealmScriptInput,
  ): Promise<BaseToolModule.RunRealmScriptResult> {
    let mode = input.mode as RealmScriptMode;
    if (mode !== 'preview' && mode !== 'commit') {
      throw new Error('Realm Script mode must be "preview" or "commit"');
    }
    let runSaved =
      input.notebook &&
      typeof input.notebook === 'object' &&
      'runSaved' in input.notebook &&
      input.notebook.runSaved === true;
    if (!runSaved && (!input.code || input.code.trim().length === 0)) {
      throw new Error(
        'Realm Script code is required unless notebook.runSaved is true',
      );
    }

    let endpoint = new URL(
      '_realm-program',
      ensureTrailingSlash(input.realmIdentifier),
    ).href;
    let response = await this.network.authedFetch(endpoint, {
      method: mode === 'preview' ? 'QUERY' : 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...(input.code === undefined ? {} : { code: input.code }),
        mode,
        ...(input.input === undefined ? {} : { input: input.input }),
        ...(input.notebook === undefined ? {} : { notebook: input.notebook }),
      }),
    });
    let text = await response.text();
    let output: unknown;
    try {
      output = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      throw new Error(
        `Realm Script returned a non-JSON response (HTTP ${response.status})`,
      );
    }

    if (!response.ok) {
      let message =
        output &&
        typeof output === 'object' &&
        'error' in output &&
        output.error &&
        typeof output.error === 'object' &&
        'message' in output.error &&
        typeof output.error.message === 'string'
          ? output.error.message
          : `Realm Script failed (HTTP ${response.status})`;
      let effects =
        output &&
        typeof output === 'object' &&
        'error' in output &&
        output.error &&
        typeof output.error === 'object' &&
        'details' in output.error &&
        output.error.details &&
        typeof output.error.details === 'object' &&
        'effects' in output.error.details &&
        Array.isArray(output.error.details.effects)
          ? output.error.details.effects
          : undefined;
      let notebook =
        output &&
        typeof output === 'object' &&
        'error' in output &&
        output.error &&
        typeof output.error === 'object' &&
        'details' in output.error &&
        output.error.details &&
        typeof output.error.details === 'object' &&
        'notebook' in output.error.details
          ? output.error.details.notebook
          : undefined;
      if (effects?.length) {
        message += `; raw API effects before failure: ${JSON.stringify(effects)}`;
      }
      if (notebook !== undefined) {
        message += `; notebook state: ${JSON.stringify(notebook)}`;
      }
      throw new Error(message);
    }

    let commandModule = await this.loadToolModule();
    return new commandModule.RunRealmScriptResult({ output });
  }
}

export { RunRealmScriptTool as RunRealmScriptCommand };
