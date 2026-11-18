import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type * as BaseToolModule from '@cardstack/base/command';

// Opens a realm's automations console: every automation in the realm, with
// its triggers, next run, payer, monthly cap and spend, last result, and the
// milestone a running automation is in. The console reads the realm's
// `_automations` route, which answers only the realm's direct writers, so
// anyone else sees that the console is for them.
export default class OpenAutomationsConsoleTool extends HostBaseTool<
  typeof BaseToolModule.AutomationsConsoleInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  static actionVerb = 'Open';

  description =
    "Open a workspace's (realm) automations console, which lists each automation with its triggers, next run, payer, monthly limit and spending, last result, and the milestone a running automation is in. Only the workspace's direct writers see the automations.";

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { AutomationsConsoleInput } = commandModule;
    return AutomationsConsoleInput;
  }

  requireInputFields = ['realm'];

  protected async run(
    input: BaseToolModule.AutomationsConsoleInput,
  ): Promise<undefined> {
    this.operatorModeStateService.showAutomationsConsole({
      realm: input.realm,
    });
  }
}
