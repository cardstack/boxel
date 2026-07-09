import { service } from '@ember/service';

import { SupportedMimeType } from '@cardstack/runtime-common';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';
import {
  formatLintIssues,
  formatLintIssuesBySeverity,
} from '../utils/lint-formatting';

import type NetworkService from '../services/network';

export default class LintAndFixTool extends HostBaseTool<
  typeof BaseToolModule.LintAndFixInput,
  typeof BaseToolModule.LintAndFixResult
> {
  @service declare private network: NetworkService;
  description = `Pass file content through linting endpoint`;
  static actionVerb = 'Autofix';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { LintAndFixInput } = commandModule;
    return LintAndFixInput;
  }

  requireInputFields = ['fileContent', 'realm'];

  protected async run(
    input: BaseToolModule.LintAndFixInput,
  ): Promise<BaseToolModule.LintAndFixResult> {
    let commandModule = await this.loadToolModule();
    const { LintAndFixResult } = commandModule;
    let response = await this.network.authedFetch(`${input.realm}_lint`, {
      method: 'POST',
      body: input.fileContent,
      headers: {
        Accept: 'application/json',
        'Content-Type': SupportedMimeType.CardSource,
        'X-HTTP-Method-Override': 'QUERY',
        'X-Filename': input.filename || 'input.gts',
      },
    });
    if (response.status === 200) {
      let result = await response.json();
      let { errors, warnings } = formatLintIssuesBySeverity(result?.messages);
      return new LintAndFixResult({
        output: result.output,
        lintIssues: formatLintIssues(result?.messages),
        lintErrors: errors,
        lintWarnings: warnings,
      });
    }
    let result = await response.json();
    console.error(result);
    throw new Error(result.message);
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { LintAndFixTool as LintAndFixCommand };
