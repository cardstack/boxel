/**
 * Host command that evaluates a .gts module by importing it via the Loader.
 * Runs in the prerenderer's headless Chrome — the sandbox for untrusted code.
 *
 * Uses `loader.import()` to load the module. If the module or any of its
 * dependencies fail to load, the Loader throws (the module transitions to
 * 'broken' state). This catches compile errors, runtime evaluation crashes,
 * strict-mode template errors, and broken imports (when the import is consumed).
 *
 * Used by the software-factory's EvalValidationStep via `_run-command`.
 */

import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';
import { assertModuleInRealm } from '../utils/assert-module-in-realm';

import type NetworkService from '../services/network';
import type * as BaseToolModule from '@cardstack/base/command';

export default class EvaluateModuleTool extends HostBaseTool<
  typeof BaseToolModule.EvaluateModuleInput,
  typeof BaseToolModule.EvaluateModuleResult
> {
  description = 'Evaluate a .gts module via the Loader in the prerenderer';
  static actionVerb = 'Evaluate';

  @service declare private network: NetworkService;

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.EvaluateModuleInput;
  }

  requireInputFields = ['moduleIdentifier'];

  protected async run(
    input: BaseToolModule.EvaluateModuleInput,
  ): Promise<BaseToolModule.EvaluateModuleResult> {
    let moduleUrl = input.moduleIdentifier;
    let realmUrl = input.realmIdentifier;

    if (!moduleUrl) {
      throw new Error('moduleUrl is required');
    }

    if (realmUrl) {
      assertModuleInRealm(moduleUrl, realmUrl, this.network.virtualNetwork);
    }

    let commandModule = await this.loadToolModule();

    try {
      // Reset the loader to clear cached modules from prior eval runs.
      // Without this, the Loader's internal module Map retains the old
      // compiled bytecode and `loader.import()` returns the cached
      // (stale) result — so edits the factory agent makes between
      // validation turns are invisible to the eval step.
      this.loaderService.resetLoader({
        clearFetchCache: true,
        reason: 'evaluate-module: fresh eval requires uncached loader',
      });
      let loader = this.loaderService.loader;
      await loader.import(moduleUrl);

      return new commandModule.EvaluateModuleResult({ passed: true });
    } catch (error: any) {
      let message = error?.message ?? String(error);
      let stack = error?.stack;

      return new commandModule.EvaluateModuleResult({
        passed: false,
        error: message,
        stackTrace: stack,
      });
    }
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { EvaluateModuleTool as EvaluateModuleCommand };
