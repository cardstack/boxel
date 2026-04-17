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

import { cardIdToURL } from '@cardstack/runtime-common';

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
    let realmUrl = input.realmUrl;

    if (!moduleUrl) {
      throw new Error('moduleUrl is required');
    }

    if (realmUrl) {
      this.validateModuleUrl(moduleUrl, realmUrl);
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

  // ---------------------------------------------------------------------------
  // URL validation helpers (SSRF prevention)
  // ---------------------------------------------------------------------------

  /**
   * Ensures moduleUrl is an http(s) URL that lives under the given realmUrl.
   * Throws if validation fails.
   */
  private validateModuleUrl(moduleUrl: string, realmUrl: string): void {
    moduleUrl = cardIdToURL(moduleUrl).href;
    realmUrl = cardIdToURL(realmUrl).href;
    this.assertHttpOrHttpsUrl(moduleUrl, 'moduleUrl');
    this.assertHttpOrHttpsUrl(realmUrl, 'realmUrl');

    let mod = new URL(moduleUrl);
    let realm = new URL(realmUrl);

    if (mod.origin !== realm.origin) {
      throw new Error(
        `moduleUrl origin (${mod.origin}) does not match realmUrl origin (${realm.origin})`,
      );
    }

    let realmPath = this.normalizeRealmPathname(realm.pathname);
    if (!mod.pathname.startsWith(realmPath)) {
      throw new Error(
        `moduleUrl path (${mod.pathname}) is not under realmUrl path (${realmPath})`,
      );
    }
  }

  private assertHttpOrHttpsUrl(value: string, label: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${label} is not a valid URL: ${value}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(
        `${label} must use http or https scheme, got ${url.protocol}`,
      );
    }
  }

  private normalizeRealmPathname(pathname: string): string {
    return pathname.endsWith('/') ? pathname : `${pathname}/`;
  }
}
