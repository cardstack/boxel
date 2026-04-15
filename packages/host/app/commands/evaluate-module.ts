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

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

export default class EvaluateModuleCommand extends HostBaseCommand<
  typeof BaseCommandModule.EvaluateModuleInput,
  typeof BaseCommandModule.EvaluateModuleResult
> {
  description = 'Evaluate a .gts module via the Loader in the prerenderer';
  static actionVerb = 'Evaluate';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    return commandModule.EvaluateModuleInput;
  }

  requireInputFields = ['moduleUrl'];

  protected async run(
    input: BaseCommandModule.EvaluateModuleInput,
  ): Promise<BaseCommandModule.EvaluateModuleResult> {
    let moduleUrl = input.moduleUrl;

    if (!moduleUrl) {
      throw new Error('moduleUrl is required');
    }

    let commandModule = await this.loadCommandModule();

    try {
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
