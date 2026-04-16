import { service } from '@ember/service';

import type { AtomicOperation } from '@cardstack/runtime-common/atomic-document';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';

export default class ExecuteAtomicOperationsCommand extends HostBaseCommand<
  typeof BaseCommandModule.ExecuteAtomicOperationsInput,
  typeof BaseCommandModule.ExecuteAtomicOperationsResult
> {
  @service declare private cardService: CardService;

  description = 'Execute atomic operations against a realm';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ExecuteAtomicOperationsInput } = commandModule;
    return ExecuteAtomicOperationsInput;
  }

  requireInputFields = ['realmUrl', 'operations'];

  protected async run(
    input: BaseCommandModule.ExecuteAtomicOperationsInput,
  ): Promise<BaseCommandModule.ExecuteAtomicOperationsResult> {
    let commandModule = await this.loadCommandModule();
    const { ExecuteAtomicOperationsResult } = commandModule;
    const results = await this.cardService.executeAtomicOperations(
      input.operations as AtomicOperation[],
      new URL(input.realmUrl),
    );
    const atomicResults = results['atomic:results'];
    if (!Array.isArray(atomicResults)) {
      const detail = (results as { errors?: Array<{ detail?: string }> })
        .errors?.[0]?.detail;
      throw new Error(detail ?? 'Atomic operations failed');
    }
    return new ExecuteAtomicOperationsResult({ results: atomicResults });
  }
}
