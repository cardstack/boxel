import { inject as service } from '@ember/service';

import { SupportedMimeType } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';
import { formatLintIssues } from '../utils/lint-formatting';

import type NetworkService from '../services/network';

export default class LintAndFixCommand extends HostBaseCommand<
  typeof BaseCommandModule.LintAndFixInput,
  typeof BaseCommandModule.LintAndFixResult
> {
  @service declare private network: NetworkService;
  description = `Pass file content through linting endpoint`;
  static actionVerb = 'Autofix';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { LintAndFixInput } = commandModule;
    return LintAndFixInput;
  }

  requireInputFields = ['fileContent', 'realm'];

  protected async run(
    input: BaseCommandModule.LintAndFixInput,
  ): Promise<BaseCommandModule.LintAndFixResult> {
    let commandModule = await this.loadCommandModule();
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
      return new LintAndFixResult({
        output: result.output,
        lintIssues: formatLintIssues(result?.messages),
      });
    }
    let result = await response.json();
    console.error(result);
    throw new Error(result.message);
  }
}
